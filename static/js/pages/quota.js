/**
 * Quota Page Module
 * Handles quota display for provider auth files (Antigravity, Codex, Gemini CLI)
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, hideModal } from '../core/modal.js';

// Module state
let quotaData = new Map();
let autoRefreshInterval = null;
const AUTO_REFRESH_DELAY = 5 * 60 * 1000; // 5 minutes

// Supported providers for quota checking
const SUPPORTED_PROVIDERS = ['antigravity', 'codex', 'gemini-cli'];

/**
 * Load the quota page
 */
export async function loadQuotaPage() {
  // TODO: Implement in Phase 4
  console.log('Quota page loading...');
}

/**
 * Call external quota API through the proxy endpoint
 * @param {string} authIndex - Auth file index
 * @param {string} url - External API URL
 * @param {string} method - HTTP method
 * @param {object|null} headers - Request headers
 * @param {object|null} data - Request body
 * @returns {Promise<object>} API response with status_code, header, body
 */
export async function callQuotaAPI(authIndex, url, method, headers = null, data = null) {
  const requestBody = {
    auth_index: authIndex,
    method: method,
    url: url
  };

  if (headers) {
    requestBody.header = headers;
  }

  if (data) {
    requestBody.data = typeof data === 'string' ? data : JSON.stringify(data);
  }

  const response = await api('POST', '/api-call', requestBody);
  return response;
}

/**
 * Fetch quota for Antigravity provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchAntigravityQuota(authFile) {
  const primaryUrl = 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
  const fallbackUrl = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
  
  const headers = {
    'Authorization': 'Bearer $TOKEN$',
    'Content-Type': 'application/json'
  };

  let response;
  try {
    response = await callQuotaAPI(authFile.auth_index, primaryUrl, 'POST', headers, {});
  } catch (e) {
    response = await callQuotaAPI(authFile.auth_index, fallbackUrl, 'POST', headers, {});
  }

  if (response.status_code !== 200) {
    throw new Error(`HTTP ${response.status_code}: ${response.body || 'Unknown error'}`);
  }

  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  
  const quotaGroups = [];
  let resetTime = null;

  if (data.quotas && Array.isArray(data.quotas)) {
    for (const quota of data.quotas) {
      const label = quota.quotaGroupName || quota.quotaGroup || 'Unknown';
      const remainingFraction = quota.remainingFraction ?? quota.remaining_fraction ?? 1;
      const percentage = Math.round(remainingFraction * 100);
      
      quotaGroups.push({
        name: label,
        percentage: percentage,
        remainingFraction: remainingFraction
      });

      if (quota.resetTime || quota.reset_time) {
        resetTime = quota.resetTime || quota.reset_time;
      }
    }
  }

  return {
    provider: 'antigravity',
    quotaGroups: quotaGroups,
    resetTime: resetTime,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Fetch quota for Codex provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchCodexQuota(authFile) {
  const url = 'https://chatgpt.com/backend-api/wham/usage';
  
  const headers = {
    'Authorization': 'Bearer $TOKEN$',
    'Content-Type': 'application/json'
  };

  const response = await callQuotaAPI(authFile.auth_index, url, 'GET', headers);

  if (response.status_code !== 200) {
    throw new Error(`HTTP ${response.status_code}: ${response.body || 'Unknown error'}`);
  }

  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  
  let planType = 'free';
  const rateLimitWindows = [];

  if (data.plan_type || data.planType) {
    planType = (data.plan_type || data.planType).toLowerCase();
  }

  if (data.rate_limit_windows || data.rateLimitWindows) {
    const windows = data.rate_limit_windows || data.rateLimitWindows;
    for (const window of Object.values(windows)) {
      const name = window.name || window.windowName || 'Unknown';
      const used = window.used || window.current || 0;
      const limit = window.limit || window.max || 100;
      const remaining = limit - used;
      const percentage = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
      const resetTime = window.reset_time || window.resetTime || null;

      rateLimitWindows.push({
        name: name,
        used: used,
        limit: limit,
        remaining: remaining,
        percentage: percentage,
        resetTime: resetTime
      });
    }
  }

  return {
    provider: 'codex',
    planType: planType,
    rateLimitWindows: rateLimitWindows,
    isFreePlan: planType === 'free',
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Fetch quota for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchGeminiCliQuota(authFile) {
  const url = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
  
  const headers = {
    'Authorization': 'Bearer $TOKEN$',
    'Content-Type': 'application/json'
  };

  const requestData = {};
  if (authFile.attributes?.project) {
    requestData.project = authFile.attributes.project;
  }

  const response = await callQuotaAPI(authFile.auth_index, url, 'POST', headers, requestData);

  if (response.status_code !== 200) {
    throw new Error(`HTTP ${response.status_code}: ${response.body || 'Unknown error'}`);
  }

  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  
  const quotaGroups = [];
  let resetTime = null;

  if (data.quotas && Array.isArray(data.quotas)) {
    for (const quota of data.quotas) {
      const label = quota.quotaGroupName || quota.quotaGroup || quota.modelGroup || 'Unknown';
      const remainingFraction = quota.remainingFraction ?? quota.remaining_fraction ?? 1;
      const remainingAmount = quota.remainingAmount ?? quota.remaining_amount ?? null;
      const percentage = Math.round(remainingFraction * 100);
      const tokenType = quota.tokenType || quota.token_type || null;
      
      quotaGroups.push({
        name: label,
        percentage: percentage,
        remainingFraction: remainingFraction,
        remainingAmount: remainingAmount,
        tokenType: tokenType
      });

      if (quota.resetTime || quota.reset_time) {
        resetTime = quota.resetTime || quota.reset_time;
      }
    }
  }

  return {
    provider: 'gemini-cli',
    quotaGroups: quotaGroups,
    resetTime: resetTime,
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Render quota card for Antigravity provider
 * @param {object} authFile - Auth file object
 * @param {object} quotaData - Quota data
 * @returns {string} HTML string
 */
export function renderAntigravityQuotaCard(authFile, quotaData) {
  // TODO: Implement in Phase 3
  return '';
}

/**
 * Render quota card for Codex provider
 * @param {object} authFile - Auth file object
 * @param {object} quotaData - Quota data
 * @returns {string} HTML string
 */
export function renderCodexQuotaCard(authFile, quotaData) {
  // TODO: Implement in Phase 3
  return '';
}

/**
 * Render quota card for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @param {object} quotaData - Quota data
 * @returns {string} HTML string
 */
export function renderGeminiCliQuotaCard(authFile, quotaData) {
  // TODO: Implement in Phase 3
  return '';
}

/**
 * Render error card for failed quota fetch
 * @param {object} authFile - Auth file object
 * @param {Error} error - Error object
 * @returns {string} HTML string
 */
export function renderQuotaErrorCard(authFile, error) {
  // TODO: Implement in Phase 3
  return '';
}

/**
 * Render unavailable card for unsupported providers
 * @param {object} authFile - Auth file object
 * @returns {string} HTML string
 */
export function renderQuotaUnavailableCard(authFile) {
  // TODO: Implement in Phase 3
  return '';
}

/**
 * Refresh quota for a single auth file
 * @param {string} authFileName - Auth file name
 */
export async function refreshQuota(authFileName) {
  // TODO: Implement in Phase 4
}

/**
 * Fetch all quotas for current page
 */
export async function fetchAllQuotas() {
  // TODO: Implement in Phase 4
}

/**
 * Start auto-refresh interval
 */
export function startAutoRefresh() {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(() => {
    fetchAllQuotas();
  }, AUTO_REFRESH_DELAY);
}

/**
 * Stop auto-refresh interval
 */
export function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/**
 * Check if a provider supports quota checking
 * @param {string} provider - Provider name
 * @returns {boolean} True if supported
 */
export function isQuotaSupported(provider) {
  return SUPPORTED_PROVIDERS.includes(provider?.toLowerCase());
}

/**
 * Get color class based on remaining percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} CSS color class
 */
export function getQuotaColorClass(percentage) {
  if (percentage > 60) return 'quota-green';
  if (percentage >= 20) return 'quota-yellow';
  return 'quota-red';
}

/**
 * Format reset time as local date/time
 * @param {string|number} resetTime - Reset timestamp
 * @returns {string} Formatted date string
 */
export function formatResetTime(resetTime) {
  if (!resetTime) return 'N/A';
  const date = new Date(resetTime);
  return date.toLocaleString();
}

// Expose functions to window for HTML onclick handlers
window.loadQuotaPage = loadQuotaPage;
window.refreshQuota = refreshQuota;
window.fetchAllQuotas = fetchAllQuotas;
