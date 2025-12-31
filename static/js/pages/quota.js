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
 * @param {number} authIndex - Auth file index
 * @param {string} provider - Provider name
 * @param {string} url - External API URL
 * @param {string} method - HTTP method
 * @param {object|null} data - Request body
 * @returns {Promise<object>} API response
 */
export async function callQuotaAPI(authIndex, provider, url, method, data = null) {
  // TODO: Implement in Phase 2
  return {};
}

/**
 * Fetch quota for Antigravity provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchAntigravityQuota(authFile) {
  // TODO: Implement in Phase 2
  return {};
}

/**
 * Fetch quota for Codex provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchCodexQuota(authFile) {
  // TODO: Implement in Phase 2
  return {};
}

/**
 * Fetch quota for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchGeminiCliQuota(authFile) {
  // TODO: Implement in Phase 2
  return {};
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
