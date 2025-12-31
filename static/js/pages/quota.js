/**
 * Quota Page Module
 * Handles quota display for provider auth files (Antigravity, Codex, Gemini CLI)
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, hideModal } from '../core/modal.js';

// Module state
let quotaData = new Map();
let authFiles = [];
let filteredAuthFiles = [];
let currentFilter = 'all';
let currentPage = 1;
let pageSize = 9;
let autoRefreshInterval = null;
const AUTO_REFRESH_DELAY = 5 * 60 * 1000; // 5 minutes

// Supported providers for quota checking
const SUPPORTED_PROVIDERS = ['antigravity', 'codex', 'gemini-cli'];

/**
 * Load the quota page
 */
export async function loadQuotaPage() {
  const container = document.getElementById('quotaContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="quota-empty-state">
      <div class="quota-loading-spinner"></div>
      <p>Loading quota information...</p>
    </div>
  `;

  try {
    const response = await api('GET', '/auth-files');
    authFiles = response.files || [];
    
    applyFilter();
    renderQuotaPage();
    
    await fetchVisibleQuotas();
    
    startAutoRefresh();
    
    updateLastUpdated();
  } catch (e) {
    toast('Failed to load auth files: ' + e.message, 'error');
    container.innerHTML = `
      <div class="quota-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <p>Failed to load auth files</p>
      </div>
    `;
  }
}

/**
 * Apply current filter to auth files
 */
function applyFilter() {
  if (currentFilter === 'all') {
    filteredAuthFiles = [...authFiles];
  } else {
    filteredAuthFiles = authFiles.filter(f => 
      f.provider?.toLowerCase() === currentFilter
    );
  }
  currentPage = 1;
}

/**
 * Get auth files for current page
 * @returns {Array} Paginated auth files
 */
function getPagedAuthFiles() {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return filteredAuthFiles.slice(start, end);
}

/**
 * Render the quota page with cards
 */
function renderQuotaPage() {
  const container = document.getElementById('quotaContainer');
  if (!container) return;

  const pagedFiles = getPagedAuthFiles();
  
  if (pagedFiles.length === 0) {
    container.innerHTML = `
      <div class="quota-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
        <p>No auth files found${currentFilter !== 'all' ? ' for ' + currentFilter : ''}</p>
      </div>
    `;
    renderPagination();
    return;
  }

  const cardsHtml = pagedFiles.map(authFile => {
    const data = quotaData.get(authFile.auth_index);
    
    if (data?.error) {
      return renderQuotaErrorCard(authFile, data.error);
    }
    
    if (!isQuotaSupported(authFile.provider)) {
      return renderQuotaUnavailableCard(authFile);
    }
    
    if (!data) {
      return renderLoadingCard(authFile);
    }
    
    switch (authFile.provider?.toLowerCase()) {
      case 'antigravity':
        return renderAntigravityQuotaCard(authFile, data);
      case 'codex':
        return renderCodexQuotaCard(authFile, data);
      case 'gemini-cli':
        return renderGeminiCliQuotaCard(authFile, data);
      default:
        return renderQuotaUnavailableCard(authFile);
    }
  }).join('');

  container.innerHTML = cardsHtml;
  renderPagination();
}

/**
 * Render loading card for auth file
 * @param {object} authFile - Auth file object
 * @returns {string} HTML string
 */
function renderLoadingCard(authFile) {
  return `
    <div class="quota-card loading" data-auth-index="${authFile.auth_index}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name">${escapeHtml(authFile.file_name || authFile.name)}</div>
          <span class="quota-card-provider ${authFile.provider?.toLowerCase()}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
      </div>
      <div class="quota-loading-overlay">
        <div class="quota-loading-spinner"></div>
      </div>
    </div>
  `;
}

/**
 * Render pagination controls
 */
function renderPagination() {
  const container = document.getElementById('quotaPageControls');
  if (!container) return;

  const totalPages = Math.ceil(filteredAuthFiles.length / pageSize);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  
  html += `<button class="quota-page-btn" onclick="setQuotaPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;
  
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="quota-page-btn ${i === currentPage ? 'active' : ''}" onclick="setQuotaPage(${i})">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += '<span style="padding: 0 4px;">...</span>';
    }
  }
  
  html += `<button class="quota-page-btn" onclick="setQuotaPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
  
  container.innerHTML = html;
}

/**
 * Fetch quota for visible auth files
 */
async function fetchVisibleQuotas() {
  const pagedFiles = getPagedAuthFiles();
  const supportedFiles = pagedFiles.filter(f => isQuotaSupported(f.provider));
  
  await Promise.all(supportedFiles.map(async (authFile) => {
    await fetchQuotaForAuth(authFile);
  }));
  
  renderQuotaPage();
}

/**
 * Fetch quota for a single auth file
 * @param {object} authFile - Auth file object
 */
async function fetchQuotaForAuth(authFile) {
  try {
    let data;
    switch (authFile.provider?.toLowerCase()) {
      case 'antigravity':
        data = await fetchAntigravityQuota(authFile);
        break;
      case 'codex':
        data = await fetchCodexQuota(authFile);
        break;
      case 'gemini-cli':
        data = await fetchGeminiCliQuota(authFile);
        break;
      default:
        return;
    }
    quotaData.set(authFile.auth_index, data);
  } catch (e) {
    quotaData.set(authFile.auth_index, { error: e });
  }
}

/**
 * Update the last updated timestamp
 */
function updateLastUpdated() {
  const el = document.getElementById('quotaUpdateTime');
  if (el) {
    el.textContent = 'Updated ' + new Date().toLocaleTimeString();
  }
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
 * @param {object} data - Quota data
 * @returns {string} HTML string
 */
export function renderAntigravityQuotaCard(authFile, data) {
  const groupsHtml = (data.quotaGroups || []).map(group => {
    const colorClass = getQuotaColorClass(group.percentage);
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name">${escapeHtml(group.name)}</span>
          <span class="quota-group-value ${colorClass}">${group.percentage}%</span>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${group.percentage}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const resetTimeHtml = data.resetTime ? `
    <div class="quota-reset-time">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>Resets: ${formatResetTime(data.resetTime)}</span>
    </div>
  ` : '';

  return renderQuotaCardWrapper(authFile, 'antigravity', `
    <div class="quota-groups">
      ${groupsHtml || '<div class="quota-empty-state"><p>No quota data available</p></div>'}
    </div>
    ${resetTimeHtml}
  `, data.fetchedAt);
}

/**
 * Render quota card for Codex provider
 * @param {object} authFile - Auth file object
 * @param {object} data - Quota data
 * @returns {string} HTML string
 */
export function renderCodexQuotaCard(authFile, data) {
  const planBadgeClass = data.planType === 'plus' ? 'plus' : data.planType === 'team' ? 'team' : 'free';
  const planBadge = `<span class="quota-plan-badge ${planBadgeClass}">${escapeHtml(data.planType || 'Free')}</span>`;

  const windowsHtml = (data.rateLimitWindows || []).map(window => {
    const colorClass = getQuotaColorClass(window.percentage);
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name">${escapeHtml(window.name)}</span>
          <span class="quota-group-value ${colorClass}">${window.remaining}/${window.limit}</span>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${window.percentage}%"></div>
        </div>
        ${window.resetTime ? `<div class="quota-reset-time"><span>Resets: ${formatResetTime(window.resetTime)}</span></div>` : ''}
      </div>
    `;
  }).join('');

  const freeWarningHtml = data.isFreePlan ? `
    <div class="quota-free-warning">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
      <span>Free plan has limited quota</span>
    </div>
  ` : '';

  return renderQuotaCardWrapper(authFile, 'codex', `
    <div style="margin-bottom: 12px;">${planBadge}</div>
    <div class="quota-groups">
      ${windowsHtml || '<div class="quota-empty-state"><p>No rate limit data available</p></div>'}
    </div>
    ${freeWarningHtml}
  `, data.fetchedAt);
}

/**
 * Render quota card for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @param {object} data - Quota data
 * @returns {string} HTML string
 */
export function renderGeminiCliQuotaCard(authFile, data) {
  const groupsHtml = (data.quotaGroups || []).map(group => {
    const colorClass = getQuotaColorClass(group.percentage);
    const amountInfo = group.remainingAmount !== null ? ` (${group.remainingAmount} remaining)` : '';
    const tokenInfo = group.tokenType ? ` [${group.tokenType}]` : '';
    
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name">${escapeHtml(group.name)}${tokenInfo}</span>
          <span class="quota-group-value ${colorClass}">${group.percentage}%${amountInfo}</span>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${group.percentage}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const resetTimeHtml = data.resetTime ? `
    <div class="quota-reset-time">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>Resets: ${formatResetTime(data.resetTime)}</span>
    </div>
  ` : '';

  return renderQuotaCardWrapper(authFile, 'gemini-cli', `
    <div class="quota-groups">
      ${groupsHtml || '<div class="quota-empty-state"><p>No quota data available</p></div>'}
    </div>
    ${resetTimeHtml}
  `, data.fetchedAt);
}

/**
 * Render error card for failed quota fetch
 * @param {object} authFile - Auth file object
 * @param {Error} error - Error object
 * @returns {string} HTML string
 */
export function renderQuotaErrorCard(authFile, error) {
  const statusMatch = error.message?.match(/HTTP (\d+)/);
  const statusCode = statusMatch ? statusMatch[1] : 'Error';
  const errorMessage = error.message || 'Unknown error occurred';

  return `
    <div class="quota-card error" data-auth-index="${authFile.auth_index}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name">${escapeHtml(authFile.file_name || authFile.name)}</div>
          <span class="quota-card-provider ${authFile.provider?.toLowerCase()}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          <button class="quota-refresh-btn" onclick="refreshQuota('${authFile.auth_index}')" title="Retry">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="quota-error-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        <div class="quota-error-message">
          <span class="quota-error-status">${statusCode}</span> - ${escapeHtml(errorMessage)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render unavailable card for unsupported providers
 * @param {object} authFile - Auth file object
 * @returns {string} HTML string
 */
export function renderQuotaUnavailableCard(authFile) {
  return `
    <div class="quota-card unavailable" data-auth-index="${authFile.auth_index}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name">${escapeHtml(authFile.file_name || authFile.name)}</div>
          <span class="quota-card-provider">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
      </div>
      <div class="quota-unavailable-content">
        <span class="quota-na-badge">Quota N/A</span>
        <span>Quota checking not supported for this provider</span>
      </div>
    </div>
  `;
}

/**
 * Wrapper function to create consistent card structure
 * @param {object} authFile - Auth file object
 * @param {string} providerClass - CSS class for provider styling
 * @param {string} contentHtml - Inner content HTML
 * @param {string} fetchedAt - Timestamp when data was fetched
 * @returns {string} HTML string
 */
function renderQuotaCardWrapper(authFile, providerClass, contentHtml, fetchedAt) {
  const updatedAgo = fetchedAt ? getTimeAgo(fetchedAt) : '';
  const isStale = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) > 10 * 60 * 1000 : false;

  return `
    <div class="quota-card" data-auth-index="${authFile.auth_index}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name">${escapeHtml(authFile.file_name || authFile.name)}</div>
          <span class="quota-card-provider ${providerClass}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          <button class="quota-refresh-btn" onclick="refreshQuota('${authFile.auth_index}')" title="Refresh">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      </div>
      ${contentHtml}
      ${updatedAgo ? `<div class="quota-card-updated ${isStale ? 'stale' : ''}">Last updated: ${updatedAgo}</div>` : ''}
    </div>
  `;
}

/**
 * Get time ago string from timestamp
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Time ago string
 */
function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Refresh quota for a single auth file
 * @param {string} authIndex - Auth index
 */
export async function refreshQuota(authIndex) {
  const authFile = authFiles.find(f => f.auth_index === authIndex);
  if (!authFile) return;

  const card = document.querySelector(`[data-auth-index="${authIndex}"]`);
  const refreshBtn = card?.querySelector('.quota-refresh-btn');
  
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
  }

  try {
    quotaData.delete(authIndex);
    await fetchQuotaForAuth(authFile);
    renderQuotaPage();
    updateLastUpdated();
    toast('Quota refreshed', 'success');
  } catch (e) {
    toast('Failed to refresh: ' + e.message, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
    }
  }
}

/**
 * Fetch all quotas for current page
 */
export async function fetchAllQuotas() {
  const btn = document.getElementById('quotaFetchAllBtn');
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }

  try {
    const pagedFiles = getPagedAuthFiles();
    const supportedFiles = pagedFiles.filter(f => isQuotaSupported(f.provider));
    
    for (const authFile of supportedFiles) {
      quotaData.delete(authFile.auth_index);
    }
    
    await Promise.all(supportedFiles.map(authFile => fetchQuotaForAuth(authFile)));
    
    renderQuotaPage();
    updateLastUpdated();
    toast(`Refreshed ${supportedFiles.length} quota(s)`, 'success');
  } catch (e) {
    toast('Failed to fetch all: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
}

/**
 * Set quota filter
 * @param {string} filter - Filter value (all, antigravity, codex, gemini-cli)
 */
export function setQuotaFilter(filter) {
  currentFilter = filter;
  
  document.querySelectorAll('.quota-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
    btn.setAttribute('aria-pressed', btn.dataset.filter === filter);
  });
  
  applyFilter();
  renderQuotaPage();
  fetchVisibleQuotas();
}

/**
 * Set page size
 * @param {number|string} size - Page size
 */
export function setQuotaPageSize(size) {
  pageSize = parseInt(size, 10);
  currentPage = 1;
  renderQuotaPage();
  fetchVisibleQuotas();
}

/**
 * Set current page
 * @param {number} page - Page number
 */
export function setQuotaPage(page) {
  const totalPages = Math.ceil(filteredAuthFiles.length / pageSize);
  if (page < 1 || page > totalPages) return;
  
  currentPage = page;
  renderQuotaPage();
  fetchVisibleQuotas();
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
window.setQuotaFilter = setQuotaFilter;
window.setQuotaPageSize = setQuotaPageSize;
window.setQuotaPage = setQuotaPage;
