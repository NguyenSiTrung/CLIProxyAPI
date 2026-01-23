/**
 * Quota Page Module
 * Handles quota display for provider auth files (Antigravity, Codex, Gemini CLI)
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';

// Module state
let quotaData = new Map();
let authFiles = [];
let filteredAuthFiles = [];
let currentFilter = 'all';
let currentStatusFilter = null; // 'critical' | 'warning' | 'healthy' | 'not-fetched' | 'error' | null
let currentViewMode = 'detailed'; // 'compact' | 'detailed'
let currentPage = 1;
let pageSize = 9;
let autoRefreshInterval = null;
let quotaSearchQuery = '';
let lastFetchStatus = { start: null, end: null, success: null, count: 0 };
const AUTO_REFRESH_DELAY = 5 * 60 * 1000; // 5 minutes

// Favorites feature
const FAVORITES_STORAGE_KEY = 'quota_favorites';
let showFavoritesOnly = false;

// Request tracking for race condition prevention
const pendingRequests = new Map(); // auth_index -> { requestId, abortController }
let currentRequestId = 0;

// Search debounce timer
let searchDebounceTimer = null;
const SEARCH_DEBOUNCE_MS = 300;

// Supported providers for quota checking
const SUPPORTED_PROVIDERS = ['antigravity', 'codex', 'gemini-cli'];

// Antigravity quota configuration (matching original management center)
const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
];

const ANTIGRAVITY_REQUEST_HEADERS = {
  'Authorization': 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/1.11.5 windows/amd64'
};

const ANTIGRAVITY_QUOTA_GROUPS = [
  { id: 'claude-gpt', label: 'Claude/GPT', identifiers: ['claude-sonnet-4-5-thinking', 'claude-opus-4-5-thinking', 'claude-sonnet-4-5', 'gpt-oss-120b-medium'] },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', identifiers: ['gemini-3-pro-high', 'gemini-3-pro-low'] },
  { id: 'gemini-2-5-flash', label: 'Gemini 2.5 Flash', identifiers: ['gemini-2.5-flash', 'gemini-2.5-flash-thinking'] },
  { id: 'gemini-2-5-flash-lite', label: 'Gemini 2.5 Flash Lite', identifiers: ['gemini-2.5-flash-lite'] },
  { id: 'gemini-2-5-cu', label: 'Gemini 2.5 CU', identifiers: ['rev19-uic3-1p'] },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash', identifiers: ['gemini-3-flash'] },
  { id: 'gemini-image', label: 'gemini-3-pro-image', identifiers: ['gemini-3-pro-image'], labelFromModel: true }
];

// Codex quota configuration
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const CODEX_REQUEST_HEADERS = {
  'Authorization': 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal'
};

// Gemini CLI quota configuration
const GEMINI_CLI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

const GEMINI_CLI_REQUEST_HEADERS = {
  'Authorization': 'Bearer $TOKEN$',
  'Content-Type': 'application/json'
};

const GEMINI_CLI_QUOTA_GROUPS = [
  { id: 'gemini-2-5-flash-series', label: 'Gemini 2.5 Flash Series', modelIds: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  { id: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro', modelIds: ['gemini-2.5-pro'] },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', modelIds: ['gemini-3-pro-preview'] },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', modelIds: ['gemini-3-flash-preview'] }
];

const GEMINI_CLI_IGNORED_MODEL_PREFIXES = ['gemini-2.0-flash'];

// ============================================================================
// Security Helpers - XSS prevention
// ============================================================================

/**
 * Escape HTML special characters (for text content)
 * @param {any} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Escape string for use in HTML attributes (handles quotes)
 * @param {any} str - String to escape for attribute context
 * @returns {string} Escaped string safe for HTML attributes
 */
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Safe text conversion - coerces to string and escapes
 * @param {any} value - Value to convert to safe text
 * @returns {string} Escaped string
 */
function safeText(value) {
  return escapeHtml(value ?? '');
}

/**
 * Safe JSON parse with error context
 * @param {string} body - JSON string to parse
 * @param {string} context - Context for error messages
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
function safeJsonParse(body, context = 'JSON parse') {
  if (typeof body !== 'string') {
    if (body && typeof body === 'object') {
      return { ok: true, value: body };
    }
    return { ok: false, error: `${context}: Invalid input type` };
  }
  try {
    const value = JSON.parse(body);
    return { ok: true, value };
  } catch (e) {
    const snippet = body.substring(0, 100);
    return { ok: false, error: `${context}: ${e.message} (near: "${snippet}...")` };
  }
}

// ============================================================================
// Favorites Management
// ============================================================================

/**
 * Load favorites from localStorage
 * @returns {Object} Favorites map { authIndex: { label: string, addedAt: string } }
 */
function loadFavorites() {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.warn('Failed to load favorites:', e);
    return {};
  }
}

/**
 * Save favorites to localStorage
 * @param {Object} favorites - Favorites map
 */
function saveFavorites(favorites) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.warn('Failed to save favorites:', e);
  }
}

/**
 * Check if an auth file is favorited
 * @param {string} authIndex - Auth index
 * @returns {boolean} True if favorited
 */
function isFavorite(authIndex) {
  const favorites = loadFavorites();
  return !!favorites[authIndex];
}

/**
 * Get favorite label for an auth file
 * @param {string} authIndex - Auth index
 * @returns {string|null} Custom label or null
 */
function getFavoriteLabel(authIndex) {
  const favorites = loadFavorites();
  return favorites[authIndex]?.label || null;
}

/**
 * Toggle favorite status for an auth file
 * @param {string} authIndex - Auth index
 * @param {string} defaultLabel - Default label if adding
 */
export function toggleFavorite(authIndex, defaultLabel = '') {
  const favorites = loadFavorites();
  if (favorites[authIndex]) {
    delete favorites[authIndex];
    toast('Removed from favorites', 'info');
  } else {
    favorites[authIndex] = {
      label: defaultLabel,
      addedAt: new Date().toISOString()
    };
    toast('Added to favorites', 'success');
  }
  saveFavorites(favorites);
  renderQuotaPage();
  renderFavoritesFilterButton();
}

/**
 * Update favorite label
 * @param {string} authIndex - Auth index
 * @param {string} label - New label
 */
export function updateFavoriteLabel(authIndex, label) {
  const favorites = loadFavorites();
  if (favorites[authIndex]) {
    favorites[authIndex].label = label;
    saveFavorites(favorites);
  }
}

/**
 * Remove from favorites
 * @param {string} authIndex - Auth index
 */
export function removeFavorite(authIndex) {
  const favorites = loadFavorites();
  delete favorites[authIndex];
  saveFavorites(favorites);
  renderQuotaPage();
  renderFavoritesFilterButton();
  renderManageFavoritesModal();
}

/**
 * Toggle favorites-only filter
 */
export function toggleFavoritesFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  applyFilter();
  renderQuotaPage();
  renderFavoritesFilterButton();
}

/**
 * Render favorites filter button state
 */
function renderFavoritesFilterButton() {
  const btn = document.getElementById('quotaFavoritesFilter');
  if (!btn) return;
  
  const favorites = loadFavorites();
  const count = Object.keys(favorites).length;
  
  btn.classList.toggle('active', showFavoritesOnly);
  btn.setAttribute('aria-pressed', showFavoritesOnly.toString());
  
  const countSpan = btn.querySelector('.favorites-count');
  if (countSpan) {
    countSpan.textContent = count > 0 ? `(${count})` : '';
  }
}

/**
 * Open manage favorites modal
 */
export function openManageFavoritesModal() {
  const modal = document.getElementById('manageFavoritesModal');
  if (modal) {
    modal.classList.add('active');
    renderManageFavoritesModal();
  }
}

/**
 * Close manage favorites modal
 */
export function closeManageFavoritesModal() {
  const modal = document.getElementById('manageFavoritesModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Render manage favorites modal content
 */
function renderManageFavoritesModal() {
  const container = document.getElementById('manageFavoritesContent');
  if (!container) return;
  
  const favorites = loadFavorites();
  const entries = Object.entries(favorites);
  
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="favorites-empty">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <p>No favorites yet</p>
        <span>Click the star icon on any auth file to add it to favorites</span>
      </div>
    `;
    return;
  }
  
  const itemsHtml = entries.map(([authIndex, data]) => {
    const authFile = authFiles.find(f => f.auth_index === authIndex);
    const displayName = authFile?.file_name || authFile?.name || authIndex;
    const provider = authFile?.provider || 'Unknown';
    
    return `
      <div class="favorites-item" data-auth-index="${escapeAttr(authIndex)}">
        <div class="favorites-item-info">
          <div class="favorites-item-name">${escapeHtml(displayName)}</div>
          <span class="favorites-item-provider ${escapeAttr(provider.toLowerCase())}">${escapeHtml(provider)}</span>
        </div>
        <div class="favorites-item-label">
          <input type="text" 
                 class="favorites-label-input" 
                 placeholder="Custom label (optional)"
                 value="${escapeAttr(data.label || '')}"
                 onchange="updateFavoriteLabelFromInput('${escapeAttr(authIndex)}', this.value)">
        </div>
        <div class="favorites-item-actions">
          <button class="favorites-remove-btn" onclick="removeFavorite('${escapeAttr(authIndex)}')" title="Remove from favorites">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = `
    <div class="favorites-list">
      ${itemsHtml}
    </div>
  `;
}

/**
 * Update favorite label from input field
 * @param {string} authIndex - Auth index
 * @param {string} value - New label value
 */
export function updateFavoriteLabelFromInput(authIndex, value) {
  updateFavoriteLabel(authIndex, value);
  toast('Label updated', 'success');
}

/**
 * Get count of favorites
 * @returns {number} Number of favorites
 */
function getFavoritesCount() {
  return Object.keys(loadFavorites()).length;
}

/**
 * Render favorite star button for a card
 * @param {string} authIndex - Auth index
 * @param {string} defaultLabel - Default label for new favorite
 * @returns {string} HTML string for star button
 */
function renderFavoriteButton(authIndex, defaultLabel = '') {
  const favorited = isFavorite(authIndex);
  const safeIndex = escapeAttr(authIndex);
  const safeLabel = escapeAttr(defaultLabel);
  
  return `
    <button class="quota-favorite-btn ${favorited ? 'active' : ''}" 
            onclick="event.stopPropagation(); toggleFavorite('${safeIndex}', '${safeLabel}')" 
            title="${favorited ? 'Remove from favorites' : 'Add to favorites'}"
            aria-pressed="${favorited}">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" 
           fill="${favorited ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    </button>
  `;
}

/**
 * Render favorite label badge if exists
 * @param {string} authIndex - Auth index
 * @returns {string} HTML string for label badge or empty
 */
function renderFavoriteLabel(authIndex) {
  const label = getFavoriteLabel(authIndex);
  if (!label) return '';
  return `<span class="quota-favorite-label">${escapeHtml(label)}</span>`;
}

// ============================================================================
// Request Management - Race condition prevention
// ============================================================================

/**
 * Generate a unique request ID
 * @returns {number} Unique request ID
 */
function generateRequestId() {
  return ++currentRequestId;
}

/**
 * Cancel pending request for an auth file
 * @param {string} authIndex - Auth index to cancel
 */
function cancelPendingRequest(authIndex) {
  const pending = pendingRequests.get(authIndex);
  if (pending?.abortController) {
    try {
      pending.abortController.abort();
    } catch (e) {
      // Ignore abort errors
    }
  }
  pendingRequests.delete(authIndex);
}

/**
 * Cancel all pending requests
 */
function cancelAllPendingRequests() {
  for (const authIndex of pendingRequests.keys()) {
    cancelPendingRequest(authIndex);
  }
}

/**
 * Check if request is still valid (not superseded by a newer request)
 * @param {string} authIndex - Auth index
 * @param {number} requestId - Request ID to check
 * @returns {boolean} True if request is still valid
 */
function isRequestValid(authIndex, requestId) {
  const pending = pendingRequests.get(authIndex);
  return pending?.requestId === requestId;
}

/**
 * Load the quota page
 */
export async function loadQuotaPage() {
  const container = document.getElementById('quotaContainer');
  if (!container) return;

  currentViewMode = localStorage.getItem('quotaViewMode') || 'detailed';
  
  container.innerHTML = `
    <div class="quota-empty-state">
      <div class="quota-loading-spinner"></div>
      <p>Loading auth files...</p>
    </div>
  `;

  try {
    const response = await api('GET', '/auth-files');
    authFiles = response.files || [];
    
    // Clean up stale quotaData entries for auth files that no longer exist
    const validIndices = new Set(authFiles.map(f => f.auth_index));
    for (const key of quotaData.keys()) {
      if (!validIndices.has(key)) {
        quotaData.delete(key);
      }
    }
    
    applyFilter();
    renderQuotaPage();
    renderViewToggle();
    
    // Don't auto-fetch quotas - user must click "Fetch All" or individual refresh
    // Show a hint message
    updateLastUpdated('Click "Fetch All" to load quota data');
  } catch (e) {
    toast('Failed to load auth files: ' + safeText(e.message), 'error');
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
 * Cleanup function - call when leaving the quota page
 * Prevents memory leaks and stale state
 */
export function unloadQuotaPage() {
  // Cancel all pending requests
  cancelAllPendingRequests();
  
  // Stop auto-refresh if running
  stopAutoRefresh();
  
  // Clear search debounce timer
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

/**
 * Apply current filter to auth files (provider + status + favorites)
 */
function applyFilter() {
  if (currentFilter === 'all') {
    filteredAuthFiles = [...authFiles];
  } else {
    filteredAuthFiles = authFiles.filter(f => 
      f.provider?.toLowerCase() === currentFilter
    );
  }

  // Apply favorites filter
  if (showFavoritesOnly) {
    const favorites = loadFavorites();
    filteredAuthFiles = filteredAuthFiles.filter(f => !!favorites[f.auth_index]);
  }

  const query = quotaSearchQuery.trim().toLowerCase();
  if (query) {
    filteredAuthFiles = filteredAuthFiles.filter(f => {
      // Also search in favorite labels
      const favoriteLabel = getFavoriteLabel(f.auth_index);
      const fields = [
        f.file_name,
        f.name,
        f.email,
        f.account,
        f.project,
        f.project_id,
        f.provider,
        favoriteLabel
      ];
      return fields.some(value => (value || '').toString().toLowerCase().includes(query));
    });
  }
  
  if (currentStatusFilter) {
    filteredAuthFiles = filteredAuthFiles.filter(f => {
      if (!isQuotaSupported(f.provider)) return false;
      
      const data = quotaData.get(f.auth_index);
      
      // Handle 'not-fetched' and 'error' status filters
      if (currentStatusFilter === 'not-fetched') {
        return !data || data.loading;
      }
      if (currentStatusFilter === 'error') {
        return data?.error;
      }
      
      // For quota status filters, need valid fetched data
      if (!data || data.error || data.loading) return false;
      
      const worstPercentage = getWorstQuotaPercentage(f, data);
      const status = getQuotaStatus(worstPercentage);
      return status === currentStatusFilter;
    });
  }
  
  currentPage = 1;
}

/**
 * Get auth files for current page (sorted by urgency)
 * @returns {Array} Paginated auth files
 */
function getPagedAuthFiles() {
  const sortedFiles = sortByQuotaUrgency(filteredAuthFiles);
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return sortedFiles.slice(start, end);
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
        <p>No auth files found${currentFilter !== 'all' ? ' for ' + currentFilter : ''}${quotaSearchQuery ? ' matching search' : ''}</p>
        <div class="quota-empty-actions">
          <button class="btn btn-secondary btn-sm" onclick="resetQuotaFilters()">Reset filters</button>
          <button class="btn btn-primary btn-sm" onclick="fetchAllQuotas()">Fetch all</button>
        </div>
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
      // Show idle card (not yet fetched) instead of loading card
      return renderIdleCard(authFile);
    }
    
    // Check if data is currently being fetched (has loading state)
    if (data.loading) {
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
  renderSummaryBar();
  updateFetchStatus();
}

/**
 * Render idle card for auth file (not yet fetched)
 * @param {object} authFile - Auth file object
 * @returns {string} HTML string
 */
function renderIdleCard(authFile) {
  const authIndex = escapeAttr(authFile.auth_index);
  const displayName = authFile.file_name || authFile.name;
  
  return `
    <div class="quota-card idle" data-auth-index="${authIndex}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name-row">
            <div class="quota-card-name">${escapeHtml(displayName)}</div>
            ${renderFavoriteLabel(authFile.auth_index)}
          </div>
          <span class="quota-card-provider ${escapeAttr(authFile.provider?.toLowerCase() || '')}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          ${renderFavoriteButton(authFile.auth_index, displayName)}
          <button class="quota-refresh-btn" onclick="refreshQuota('${authIndex}')" title="Fetch Quota">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="quota-idle-content">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 6v6l4 2"></path>
        </svg>
        <span>Click refresh to fetch quota</span>
      </div>
    </div>
  `;
}

/**
 * Render loading card for auth file
 * @param {object} authFile - Auth file object
 * @returns {string} HTML string
 */
function renderLoadingCard(authFile) {
  const authIndex = escapeAttr(authFile.auth_index);
  const displayName = authFile.file_name || authFile.name;
  
  return `
    <div class="quota-card loading" data-auth-index="${authIndex}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name-row">
            <div class="quota-card-name">${escapeHtml(displayName)}</div>
            ${renderFavoriteLabel(authFile.auth_index)}
          </div>
          <span class="quota-card-provider ${escapeAttr(authFile.provider?.toLowerCase() || '')}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
      </div>
      <div class="quota-loading-overlay" aria-busy="true" aria-label="Loading quota data">
        <div class="quota-loading-spinner"></div>
      </div>
    </div>
  `;
}

/**
 * Render pagination controls
 */
function renderPagination() {
  const controlsContainer = document.getElementById('quotaPageControls');
  const infoContainer = document.getElementById('quotaPageInfo');
  
  const totalPages = Math.ceil(filteredAuthFiles.length / pageSize);
  
  // Render page info
  if (infoContainer) {
    const start = filteredAuthFiles.length > 0 ? (currentPage - 1) * pageSize + 1 : 0;
    const end = Math.min(currentPage * pageSize, filteredAuthFiles.length);
    infoContainer.textContent = filteredAuthFiles.length > 0 
      ? `Showing ${start}-${end} of ${filteredAuthFiles.length}`
      : 'No results';
  }
  
  if (!controlsContainer) return;
  
  if (totalPages <= 1) {
    controlsContainer.innerHTML = '';
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
  
  controlsContainer.innerHTML = html;
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
 * Fetch quota for a single auth file with race condition protection
 * @param {object} authFile - Auth file object
 */
async function fetchQuotaForAuth(authFile) {
  const authIndex = authFile.auth_index;
  
  // Cancel any pending request for this auth file
  cancelPendingRequest(authIndex);
  
  // Generate unique request ID for this fetch
  const requestId = generateRequestId();
  const abortController = new AbortController();
  
  // Track this request
  pendingRequests.set(authIndex, { requestId, abortController });
  
  // Set loading state
  quotaData.set(authIndex, { loading: true, requestId });
  renderQuotaPage();
  
  try {
    let data;
    const fetchFn = async () => {
      // Check if request was superseded before each provider call
      if (!isRequestValid(authIndex, requestId)) {
        throw new Error('Request superseded');
      }
      
      switch (authFile.provider?.toLowerCase()) {
        case 'antigravity':
          return await fetchAntigravityQuota(authFile);
        case 'codex':
          return await fetchCodexQuota(authFile);
        case 'gemini-cli':
          return await fetchGeminiCliQuota(authFile);
        default:
          return null;
      }
    };
    
    data = await retryWithBackoff(fetchFn, 3, 1000);
    
    // Only update state if this request is still the latest
    if (!isRequestValid(authIndex, requestId)) {
      return; // Request was superseded, discard result
    }
    
    if (data) {
      quotaData.set(authIndex, data);
    } else {
      quotaData.delete(authIndex);
    }
  } catch (e) {
    // Only update error state if request is still valid
    if (isRequestValid(authIndex, requestId)) {
      // Don't show error for superseded requests
      if (e.message !== 'Request superseded') {
        quotaData.set(authIndex, { error: e });
      }
    }
  } finally {
    // Clean up pending request tracking
    if (isRequestValid(authIndex, requestId)) {
      pendingRequests.delete(authIndex);
    }
  }
}

/**
 * Update the last updated timestamp
 * @param {string} [customMessage] - Optional custom message to display
 */
function updateLastUpdated(customMessage) {
  const timeText = customMessage || ('Updated ' + new Date().toLocaleTimeString());
  
  // Update old UI element if exists
  const el = document.getElementById('quotaUpdateTime');
  if (el) {
    el.textContent = timeText;
  }
  
  // Update new sync status
  updateSyncStatus();
}

function updateFetchStatus() {
  updateSyncStatus();
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise<any>} Result of the function
 */
async function retryWithBackoff(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
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
 * Parse Antigravity models payload and build quota groups
 * @param {object} models - Models object from API response
 * @returns {Array} Quota groups with remaining fraction and reset time
 */
function buildAntigravityQuotaGroups(models) {
  if (!models || typeof models !== 'object') return [];
  
  const groups = [];
  let geminiProResetTime = null;

  for (const groupDef of ANTIGRAVITY_QUOTA_GROUPS) {
    const matches = groupDef.identifiers
      .map(id => {
        const entry = models[id];
        if (!entry) return null;
        const quotaInfo = entry.quotaInfo || entry.quota_info || {};
        const remainingValue = quotaInfo.remainingFraction ?? quotaInfo.remaining_fraction ?? quotaInfo.remaining;
        const remainingFraction = normalizeQuotaFraction(remainingValue);
        const resetTime = quotaInfo.resetTime || quotaInfo.reset_time;
        const displayName = entry.displayName;
        
        if (remainingFraction === null && !resetTime) return null;
        
        return {
          id: id,
          remainingFraction: remainingFraction ?? (resetTime ? 0 : null),
          resetTime: resetTime,
          displayName: displayName
        };
      })
      .filter(Boolean);

    if (matches.length === 0) continue;

    const remainingFraction = Math.min(...matches.map(m => m.remainingFraction));
    const resetTime = matches.find(m => m.resetTime)?.resetTime;
    const displayName = matches.find(m => m.displayName)?.displayName;
    const label = groupDef.labelFromModel && displayName ? displayName : groupDef.label;

    const group = {
      id: groupDef.id,
      label: label,
      models: matches.map(m => m.id),
      remainingFraction: remainingFraction,
      percentage: Math.round(Math.max(0, Math.min(1, remainingFraction)) * 100),
      resetTime: resetTime
    };

    groups.push(group);

    if (groupDef.id === 'gemini-3-pro') {
      geminiProResetTime = resetTime;
    }
  }

  return groups;
}

/**
 * Normalize quota fraction value to a number between 0 and 1
 * @param {any} value - Value to normalize
 * @returns {number|null} Normalized fraction or null
 */
function normalizeQuotaFraction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Fetch quota for Antigravity provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchAntigravityQuota(authFile) {
  let lastError = null;
  let lastStatusCode = null;
  let priorityStatus = null;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const response = await callQuotaAPI(authFile.auth_index, url, 'POST', ANTIGRAVITY_REQUEST_HEADERS, '{}');
      
      if (response.status_code < 200 || response.status_code >= 300) {
        lastError = getApiCallErrorMessage(response);
        lastStatusCode = response.status_code;
        if (response.status_code === 403 || response.status_code === 404) {
          priorityStatus = priorityStatus || response.status_code;
        }
        continue;
      }

      hadSuccess = true;
      const parsed = safeJsonParse(response.body, 'Antigravity quota');
      if (!parsed.ok) {
        lastError = parsed.error;
        continue;
      }
      const data = parsed.value;
      const models = data?.models;
      
      if (!models || typeof models !== 'object' || Array.isArray(models)) {
        lastError = 'Empty models response';
        continue;
      }

      const quotaGroups = buildAntigravityQuotaGroups(models);
      
      if (quotaGroups.length === 0) {
        lastError = 'No quota groups found';
        continue;
      }

      const resetTime = quotaGroups.find(g => g.resetTime)?.resetTime;

      return {
        provider: 'antigravity',
        quotaGroups: quotaGroups,
        resetTime: resetTime,
        fetchedAt: new Date().toISOString()
      };
    } catch (e) {
      lastError = e.message || 'Unknown error';
      lastStatusCode = e.status || null;
    }
  }

  if (hadSuccess) {
    return {
      provider: 'antigravity',
      quotaGroups: [],
      resetTime: null,
      fetchedAt: new Date().toISOString()
    };
  }

  const err = new Error(lastError || 'Unknown error');
  err.status = priorityStatus || lastStatusCode;
  throw err;
}

/**
 * Get error message from API call result
 * @param {object} result - API call result
 * @returns {string} Error message
 */
function getApiCallErrorMessage(result) {
  const status = result.status_code;
  const body = result.body;
  let message = '';
  
  if (body && typeof body === 'object') {
    message = body?.error?.message || body?.error || body?.message || '';
  } else if (typeof body === 'string') {
    message = body;
  }
  
  if (status && message) return `${status} ${message}`.trim();
  if (status) return `HTTP ${status}`;
  return message || 'Request failed';
}

/**
 * Decode base64url-encoded payload (JWT segment)
 * @param {string} value - Base64url encoded string
 * @returns {string|null} Decoded string or null
 */
function decodeBase64UrlPayload(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

/**
 * Extract chatgpt_account_id from id_token
 * @param {any} value - id_token value (can be JWT string or object)
 * @returns {string|null} Account ID or null
 */
function extractCodexChatgptAccountId(value) {
  if (!value) return null;
  
  let payload = null;
  
  if (typeof value === 'object' && !Array.isArray(value)) {
    payload = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    
    try {
      payload = JSON.parse(trimmed);
    } catch {
      const segments = trimmed.split('.');
      if (segments.length >= 2) {
        const decoded = decodeBase64UrlPayload(segments[1]);
        if (decoded) {
          try {
            payload = JSON.parse(decoded);
          } catch {
            return null;
          }
        }
      }
    }
  }
  
  if (!payload) return null;
  return (payload.chatgpt_account_id || payload.chatgptAccountId || '').trim() || null;
}

/**
 * Resolve Codex chatgpt_account_id from auth file
 * @param {object} file - Auth file object
 * @returns {string|null} Account ID or null
 */
function resolveCodexChatgptAccountId(file) {
  const metadata = file?.metadata || {};
  const attributes = file?.attributes || {};
  
  const candidates = [
    file.id_token,
    metadata.id_token,
    attributes.id_token
  ];
  
  for (const candidate of candidates) {
    const id = extractCodexChatgptAccountId(candidate);
    if (id) return id;
  }
  
  return null;
}

/**
 * Resolve Codex plan type from auth file
 * @param {object} file - Auth file object
 * @returns {string|null} Plan type or null
 */
function resolveCodexPlanType(file) {
  const metadata = file?.metadata || {};
  const attributes = file?.attributes || {};
  const idToken = typeof file?.id_token === 'object' ? file.id_token : {};
  const metadataIdToken = typeof metadata?.id_token === 'object' ? metadata.id_token : {};
  
  const candidates = [
    file.plan_type,
    file.planType,
    idToken?.plan_type,
    idToken?.planType,
    metadata?.plan_type,
    metadata?.planType,
    metadataIdToken?.plan_type,
    metadataIdToken?.planType,
    attributes?.plan_type,
    attributes?.planType
  ];
  
  for (const candidate of candidates) {
    const normalized = normalizePlanType(candidate);
    if (normalized) return normalized;
  }
  
  return null;
}

/**
 * Normalize plan type to lowercase
 * @param {any} value - Plan type value
 * @returns {string|null} Normalized plan type or null
 */
function normalizePlanType(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
  }
  return null;
}

/**
 * Format Codex reset time from window data
 * @param {object} window - Rate limit window
 * @returns {string} Formatted reset time
 */
function formatCodexResetLabel(window) {
  if (!window) return '-';
  
  const resetAt = normalizeNumberValue(window.reset_at || window.resetAt);
  if (resetAt !== null && resetAt > 0) {
    return formatUnixSeconds(resetAt);
  }
  
  const resetAfter = normalizeNumberValue(window.reset_after_seconds || window.resetAfterSeconds);
  if (resetAfter !== null && resetAfter > 0) {
    const targetSeconds = Math.floor(Date.now() / 1000 + resetAfter);
    return formatUnixSeconds(targetSeconds);
  }
  
  return '-';
}

/**
 * Format Unix timestamp (seconds) to local date/time
 * @param {number} value - Unix timestamp in seconds
 * @returns {string} Formatted date string
 */
function formatUnixSeconds(value) {
  if (!value) return '-';
  const date = new Date(value * 1000);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Normalize number value
 * @param {any} value - Value to normalize
 * @returns {number|null} Normalized number or null
 */
function normalizeNumberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Build Codex quota windows from rate limit data
 * @param {object} payload - Usage API response
 * @returns {Array} Rate limit windows
 */
function buildCodexQuotaWindows(payload) {
  const rateLimit = payload.rate_limit || payload.rateLimit || {};
  const codeReviewLimit = payload.code_review_rate_limit || payload.codeReviewRateLimit || {};
  const windows = [];
  
  const addWindow = (id, label, windowData, limitReached, allowed) => {
    if (!windowData) return;
    
    const resetLabel = formatCodexResetLabel(windowData);
    const usedPercentRaw = normalizeNumberValue(windowData.used_percent || windowData.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    
    windows.push({
      id: id,
      label: label,
      usedPercent: usedPercent,
      percentage: usedPercent !== null ? Math.max(0, 100 - usedPercent) : null,
      resetLabel: resetLabel
    });
  };
  
  addWindow(
    'primary',
    'Primary Window',
    rateLimit.primary_window || rateLimit.primaryWindow,
    rateLimit.limit_reached || rateLimit.limitReached,
    rateLimit.allowed
  );
  
  addWindow(
    'secondary',
    'Secondary Window',
    rateLimit.secondary_window || rateLimit.secondaryWindow,
    rateLimit.limit_reached || rateLimit.limitReached,
    rateLimit.allowed
  );
  
  addWindow(
    'code-review',
    'Code Review',
    codeReviewLimit.primary_window || codeReviewLimit.primaryWindow,
    codeReviewLimit.limit_reached || codeReviewLimit.limitReached,
    codeReviewLimit.allowed
  );
  
  return windows;
}

/**
 * Fetch quota for Codex provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchCodexQuota(authFile) {
  const planTypeFromFile = resolveCodexPlanType(authFile);
  const accountId = resolveCodexChatgptAccountId(authFile);
  
  if (!accountId) {
    throw new Error('Missing chatgpt_account_id - check id_token in auth file');
  }
  
  const headers = {
    ...CODEX_REQUEST_HEADERS,
    'Chatgpt-Account-Id': accountId
  };

  const response = await callQuotaAPI(authFile.auth_index, CODEX_USAGE_URL, 'GET', headers);

  if (response.status_code < 200 || response.status_code >= 300) {
    const err = new Error(getApiCallErrorMessage(response));
    err.status = response.status_code;
    throw err;
  }

  const parsed = safeJsonParse(response.body, 'Codex usage');
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const data = parsed.value;
  
  if (!data) {
    throw new Error('Empty response from usage API');
  }
  
  const planTypeFromUsage = normalizePlanType(data.plan_type || data.planType);
  const planType = planTypeFromUsage || planTypeFromFile || 'free';
  const rateLimitWindows = buildCodexQuotaWindows(data);

  return {
    provider: 'codex',
    planType: planType,
    rateLimitWindows: rateLimitWindows,
    isFreePlan: planType === 'free',
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Extract Gemini CLI project ID from account string
 * @param {any} value - Account value (e.g., "email (project-id)")
 * @returns {string|null} Project ID or null
 */
function extractGeminiCliProjectId(value) {
  if (typeof value !== 'string') return null;
  const matches = Array.from(value.matchAll(/\(([^()]+)\)/g));
  if (matches.length === 0) return null;
  const candidate = matches[matches.length - 1]?.[1]?.trim();
  return candidate || null;
}

/**
 * Resolve Gemini CLI project ID from auth file
 * @param {object} file - Auth file object
 * @returns {string|null} Project ID or null
 */
function resolveGeminiCliProjectId(file) {
  const metadata = file?.metadata || {};
  const attributes = file?.attributes || {};
  
  const candidates = [
    file.account,
    metadata?.account,
    attributes?.account
  ];
  
  for (const candidate of candidates) {
    const projectId = extractGeminiCliProjectId(candidate);
    if (projectId) return projectId;
  }
  
  return null;
}

/**
 * Check if a Gemini CLI model should be ignored
 * @param {string} modelId - Model ID
 * @returns {boolean} True if should be ignored
 */
function isIgnoredGeminiCliModel(modelId) {
  return GEMINI_CLI_IGNORED_MODEL_PREFIXES.some(
    prefix => modelId === prefix || modelId.startsWith(`${prefix}-`)
  );
}

/**
 * Get the earliest reset time between two values
 * @param {string|undefined} current - Current reset time
 * @param {string|undefined} next - Next reset time
 * @returns {string|undefined} Earlier reset time
 */
function pickEarlierResetTime(current, next) {
  if (!current) return next;
  if (!next) return current;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (isNaN(currentTime)) return next;
  if (isNaN(nextTime)) return current;
  return currentTime <= nextTime ? current : next;
}

/**
 * Get minimum of two nullable numbers
 * @param {number|null} current - Current value
 * @param {number|null} next - Next value
 * @returns {number|null} Minimum value
 */
function minNullableNumber(current, next) {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

/**
 * Build grouped Gemini CLI quota buckets
 * @param {Array} buckets - Parsed buckets
 * @returns {Array} Grouped buckets
 */
function buildGeminiCliQuotaBuckets(buckets) {
  if (buckets.length === 0) return [];
  
  const grouped = new Map();
  
  const groupLookup = new Map();
  for (const groupDef of GEMINI_CLI_QUOTA_GROUPS) {
    for (const modelId of groupDef.modelIds) {
      groupLookup.set(modelId, groupDef);
    }
  }
  
  buckets.forEach(bucket => {
    if (isIgnoredGeminiCliModel(bucket.modelId)) return;
    
    const groupDef = groupLookup.get(bucket.modelId);
    const groupId = groupDef?.id || bucket.modelId;
    const label = groupDef?.label || bucket.modelId;
    const tokenKey = bucket.tokenType || '';
    const mapKey = `${groupId}::${tokenKey}`;
    
    const existing = grouped.get(mapKey);
    
    if (!existing) {
      grouped.set(mapKey, {
        id: `${groupId}${tokenKey ? `-${tokenKey}` : ''}`,
        label: label,
        remainingFraction: bucket.remainingFraction,
        remainingAmount: bucket.remainingAmount,
        resetTime: bucket.resetTime,
        tokenType: bucket.tokenType,
        modelIds: [bucket.modelId],
        percentage: bucket.remainingFraction !== null 
          ? Math.round(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100) 
          : null
      });
      return;
    }
    
    existing.remainingFraction = minNullableNumber(existing.remainingFraction, bucket.remainingFraction);
    existing.remainingAmount = minNullableNumber(existing.remainingAmount, bucket.remainingAmount);
    existing.resetTime = pickEarlierResetTime(existing.resetTime, bucket.resetTime);
    existing.modelIds.push(bucket.modelId);
    existing.percentage = existing.remainingFraction !== null
      ? Math.round(Math.max(0, Math.min(1, existing.remainingFraction)) * 100)
      : null;
  });
  
  return Array.from(grouped.values()).map(bucket => ({
    ...bucket,
    modelIds: [...new Set(bucket.modelIds)]
  }));
}

/**
 * Fetch quota for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @returns {Promise<object>} Quota data
 */
export async function fetchGeminiCliQuota(authFile) {
  const projectId = resolveGeminiCliProjectId(authFile);
  
  if (!projectId) {
    throw new Error('Missing project ID - check account field in auth file');
  }

  const response = await callQuotaAPI(
    authFile.auth_index, 
    GEMINI_CLI_QUOTA_URL, 
    'POST', 
    GEMINI_CLI_REQUEST_HEADERS, 
    JSON.stringify({ project: projectId })
  );

  if (response.status_code < 200 || response.status_code >= 300) {
    const err = new Error(getApiCallErrorMessage(response));
    err.status = response.status_code;
    throw err;
  }

  const parsed = safeJsonParse(response.body, 'Gemini CLI quota');
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const data = parsed.value;
  const rawBuckets = Array.isArray(data?.buckets) ? data.buckets : [];
  
  if (rawBuckets.length === 0) {
    return {
      provider: 'gemini-cli',
      quotaGroups: [],
      resetTime: null,
      fetchedAt: new Date().toISOString()
    };
  }

  const parsedBuckets = rawBuckets
    .map(bucket => {
      const modelId = (bucket.modelId || bucket.model_id || '').trim();
      if (!modelId) return null;
      
      const tokenType = (bucket.tokenType || bucket.token_type || '').trim() || null;
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(
        bucket.remainingAmount ?? bucket.remaining_amount
      );
      const resetTime = (bucket.resetTime || bucket.reset_time || '').trim() || null;
      
      let fallbackFraction = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      
      const remainingFraction = remainingFractionRaw ?? fallbackFraction;
      
      return {
        modelId,
        tokenType,
        remainingFraction,
        remainingAmount,
        resetTime
      };
    })
    .filter(Boolean);

  const quotaGroups = buildGeminiCliQuotaBuckets(parsedBuckets);
  const resetTime = quotaGroups.find(g => g.resetTime)?.resetTime;

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
  const quotaGroups = data.quotaGroups || [];
  const { worstGroup, worstIndex } = getWorstQuotaGroup(quotaGroups, 'percentage');
  const worstPercentage = getWorstQuotaPercentage(authFile, data);
  const resetLabel = data.resetTime ? formatResetTime(data.resetTime) : '';
  
  const renderGroup = (group) => {
    const percentage = group.percentage ?? 0;
    const colorClass = getQuotaColorClass(percentage);
    const label = group.label || group.name || 'Unknown';
    const resetTimeFormatted = group.resetTime ? formatResetTime(group.resetTime) : '';
    
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name" title="${escapeHtml((group.models || []).join(', '))}">${escapeHtml(label)}</span>
          <div class="quota-group-meta">
            <span class="quota-group-value ${colorClass}">${percentage}%</span>
            ${resetTimeFormatted ? `<span class="quota-group-reset">${resetTimeFormatted}</span>` : ''}
          </div>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
  };
  
  let contentHtml = '';
  if (quotaGroups.length === 0) {
    contentHtml = '<div class="quota-empty-state"><p>No quota data available</p></div>';
  } else if (quotaGroups.length === 1) {
    contentHtml = `<div class="quota-groups">${renderGroup(quotaGroups[0])}</div>`;
  } else {
    const worstGroupHtml = worstGroup ? renderGroup(worstGroup) : '';
    const otherGroups = quotaGroups.filter((_, i) => i !== worstIndex);
    const otherGroupsHtml = otherGroups.map(renderGroup).join('');
    
    contentHtml = `
      <div class="quota-groups-collapsible">
        ${worstGroupHtml}
        ${otherGroups.length > 0 ? `
          <div class="quota-groups-collapsed" aria-hidden="true">
            ${otherGroupsHtml}
          </div>
          <button class="quota-show-more-btn" onclick="toggleQuotaGroups('${authFile.auth_index}')" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
            Show ${otherGroups.length} more
          </button>
        ` : ''}
      </div>
    `;
  }

  const metaHtml = renderQuotaMetaChips(resetLabel, 'Provider quota');
  return renderQuotaCardWrapper(authFile, 'antigravity', contentHtml, data.fetchedAt, worstPercentage, metaHtml);
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
  const quotaGroups = data.quotaGroups || data.rateLimitWindows || [];
  const worstPercentage = getWorstQuotaPercentage(authFile, data);
  const { worstGroup, worstIndex } = getWorstQuotaGroup(quotaGroups, 'remainingPercentage');
  const resetLabel = getCodexResetLabel(data.rateLimitWindows || quotaGroups);

  const renderWindow = (window) => {
    const percentage = window.remainingPercentage ?? window.percentage ?? (window.usedPercent !== null ? Math.max(0, 100 - window.usedPercent) : null);
    const percentLabel = percentage !== null ? `${Math.round(percentage)}%` : '--';
    const colorClass = percentage !== null ? getQuotaColorClass(percentage) : 'quota-yellow';
    const label = window.label || window.name || 'Unknown';
    const resetLabel = window.resetLabel || (window.resetTime ? formatResetTime(window.resetTime) : '');
    
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name">${escapeHtml(label)}</span>
          <div class="quota-group-meta">
            <span class="quota-group-value ${colorClass}">${percentLabel}</span>
            ${resetLabel && resetLabel !== '-' ? `<span class="quota-group-reset">${resetLabel}</span>` : ''}
          </div>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${percentage ?? 0}%"></div>
        </div>
      </div>
    `;
  };

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

  let groupsHtml = '';
  if (quotaGroups.length === 0) {
    groupsHtml = '<div class="quota-empty-state"><p>No rate limit data available</p></div>';
  } else if (quotaGroups.length === 1) {
    groupsHtml = `<div class="quota-groups">${renderWindow(quotaGroups[0])}</div>`;
  } else {
    const worstWindowHtml = worstGroup ? renderWindow(worstGroup) : '';
    const otherWindows = quotaGroups.filter((_, i) => i !== worstIndex);
    const otherWindowsHtml = otherWindows.map(renderWindow).join('');
    
    groupsHtml = `
      <div class="quota-groups-collapsible">
        ${worstWindowHtml}
        ${otherWindows.length > 0 ? `
          <div class="quota-groups-collapsed" aria-hidden="true">
            ${otherWindowsHtml}
          </div>
          <button class="quota-show-more-btn" onclick="toggleQuotaGroups('${authFile.auth_index}')" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
            Show ${otherWindows.length} more
          </button>
        ` : ''}
      </div>
    `;
  }

  const metaHtml = renderQuotaMetaChips(resetLabel, getCodexWindowLabel(data.rateLimitWindows || quotaGroups));
  return renderQuotaCardWrapper(authFile, 'codex', `
    <div style="margin-bottom: 12px;">${planBadge}</div>
    ${groupsHtml}
    ${freeWarningHtml}
  `, data.fetchedAt, worstPercentage, metaHtml);
}

/**
 * Render quota card for Gemini CLI provider
 * @param {object} authFile - Auth file object
 * @param {object} data - Quota data
 * @returns {string} HTML string
 */
export function renderGeminiCliQuotaCard(authFile, data) {
  const quotaGroups = data.quotaGroups || [];
  const { worstGroup, worstIndex } = getWorstQuotaGroup(quotaGroups, 'remainingPercentage');
  const worstPercentage = getWorstQuotaPercentage(authFile, data);
  const resetLabel = data.resetTime ? formatResetTime(data.resetTime) : '';
  
  const renderGroup = (group) => {
    const percentage = group.remainingPercentage ?? group.percentage ?? 0;
    const percentLabel = percentage !== null ? `${Math.round(percentage)}%` : '--';
    const colorClass = percentage !== null ? getQuotaColorClass(percentage) : 'quota-yellow';
    const label = group.label || group.name || 'Unknown';
    const amountInfo = group.remainingAmount !== null && group.remainingAmount !== undefined 
      ? ` (${group.remainingAmount})` 
      : '';
    const tokenInfo = group.tokenType ? ` [${group.tokenType}]` : '';
    const resetTimeFormatted = group.resetTime ? formatResetTime(group.resetTime) : '';
    const titleText = group.modelIds?.length > 0 
      ? (group.tokenType ? `${group.modelIds.join(', ')} (${group.tokenType})` : group.modelIds.join(', '))
      : label;
    
    return `
      <div class="quota-group">
        <div class="quota-group-header">
          <span class="quota-group-name" title="${escapeHtml(titleText)}">${escapeHtml(label)}${tokenInfo}</span>
          <div class="quota-group-meta">
            <span class="quota-group-value ${colorClass}">${percentLabel}${amountInfo}</span>
            ${resetTimeFormatted ? `<span class="quota-group-reset">${resetTimeFormatted}</span>` : ''}
          </div>
        </div>
        <div class="quota-progress-container">
          <div class="quota-progress-bar ${colorClass}" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;
  };

  let contentHtml = '';
  if (quotaGroups.length === 0) {
    contentHtml = '<div class="quota-empty-state"><p>No quota data available</p></div>';
  } else if (quotaGroups.length === 1) {
    contentHtml = `<div class="quota-groups">${renderGroup(quotaGroups[0])}</div>`;
  } else {
    const worstGroupHtml = worstGroup ? renderGroup(worstGroup) : '';
    const otherGroups = quotaGroups.filter((_, i) => i !== worstIndex);
    const otherGroupsHtml = otherGroups.map(renderGroup).join('');
    
    contentHtml = `
      <div class="quota-groups-collapsible">
        ${worstGroupHtml}
        ${otherGroups.length > 0 ? `
          <div class="quota-groups-collapsed" aria-hidden="true">
            ${otherGroupsHtml}
          </div>
          <button class="quota-show-more-btn" onclick="toggleQuotaGroups('${authFile.auth_index}')" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
            Show ${otherGroups.length} more
          </button>
        ` : ''}
      </div>
    `;
  }

  const metaHtml = renderQuotaMetaChips(resetLabel, 'Model buckets');
  return renderQuotaCardWrapper(authFile, 'gemini-cli', contentHtml, data.fetchedAt, worstPercentage, metaHtml);
}

/**
 * Render error card for failed quota fetch
 * @param {object} authFile - Auth file object
 * @param {Error} error - Error object
 * @returns {string} HTML string
 */
export function renderQuotaErrorCard(authFile, error) {
  const statusMatch = error.message?.match(/HTTP (\d+)/);
  const statusCode = statusMatch ? escapeHtml(statusMatch[1]) : 'Error';
  const errorMessage = error.message || 'Unknown error occurred';
  const authIndex = escapeAttr(authFile.auth_index);
  const displayName = authFile.file_name || authFile.name;

  return `
    <div class="quota-card error" data-auth-index="${authIndex}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name-row">
            <div class="quota-card-name">${escapeHtml(displayName)}</div>
            ${renderFavoriteLabel(authFile.auth_index)}
          </div>
          <span class="quota-card-provider ${escapeAttr(authFile.provider?.toLowerCase() || '')}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          ${renderFavoriteButton(authFile.auth_index, displayName)}
          <button class="quota-refresh-btn" onclick="refreshQuota('${authIndex}')" title="Retry">
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
  const authIndex = escapeAttr(authFile.auth_index);
  const displayName = authFile.file_name || authFile.name;
  
  return `
    <div class="quota-card unavailable" data-auth-index="${authIndex}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name-row">
            <div class="quota-card-name">${escapeHtml(displayName)}</div>
            ${renderFavoriteLabel(authFile.auth_index)}
          </div>
          <span class="quota-card-provider">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          ${renderFavoriteButton(authFile.auth_index, displayName)}
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
 * Wrapper function to create consistent card structure with circular progress and status border
 * @param {object} authFile - Auth file object
 * @param {string} providerClass - CSS class for provider styling
 * @param {string} contentHtml - Inner content HTML
 * @param {string} fetchedAt - Timestamp when data was fetched
 * @param {number} worstPercentage - Worst quota percentage for circular indicator
 * @returns {string} HTML string
 */
function renderQuotaCardWrapper(authFile, providerClass, contentHtml, fetchedAt, worstPercentage = null, metaHtml = '') {
  const updatedAgo = fetchedAt ? getTimeAgo(fetchedAt) : '';
  const isStale = fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) > 10 * 60 * 1000 : false;
  const status = worstPercentage !== null ? getQuotaStatus(worstPercentage) : '';
  const statusClass = status ? `status-${status}` : '';
  const circularHtml = worstPercentage !== null ? renderCircularProgress(worstPercentage, status) : '';
  const authIndex = escapeAttr(authFile.auth_index);
  const displayName = authFile.file_name || authFile.name;

  return `
    <div class="quota-card ${statusClass}" data-auth-index="${authIndex}">
      <div class="quota-card-header">
        <div class="quota-card-info">
          <div class="quota-card-name-row">
            <div class="quota-card-name">${escapeHtml(displayName)}</div>
            ${renderFavoriteLabel(authFile.auth_index)}
          </div>
          <span class="quota-card-provider ${escapeAttr(providerClass)}">${escapeHtml(authFile.provider || 'Unknown')}</span>
        </div>
        <div class="quota-card-actions">
          ${renderFavoriteButton(authFile.auth_index, displayName)}
          ${circularHtml}
          <button class="quota-refresh-btn" onclick="refreshQuota('${authIndex}')" title="Refresh">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>
      </div>
      ${metaHtml}
      ${contentHtml}
      ${updatedAgo ? `<div class="quota-card-updated ${isStale ? 'stale' : ''}">Last updated: ${escapeHtml(updatedAgo)}</div>` : ''}
    </div>
  `;
}

function renderQuotaMetaChips(resetLabel, windowLabel) {
  const chips = [];
  if (resetLabel && resetLabel !== 'N/A' && resetLabel !== '-') {
    chips.push(`
      <span class="quota-meta-chip">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Next reset: <strong>${escapeHtml(resetLabel)}</strong>
      </span>
    `);
  }
  if (windowLabel) {
    chips.push(`
      <span class="quota-meta-chip">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1"></rect>
        </svg>
        Usage window: <strong>${escapeHtml(windowLabel)}</strong>
      </span>
    `);
  }
  if (chips.length === 0) return '';
  return `<div class="quota-meta">${chips.join('')}</div>`;
}

function getCodexResetLabel(windows) {
  if (!Array.isArray(windows)) return '';
  for (const window of windows) {
    const label = window?.resetLabel || (window?.resetTime ? formatResetTime(window.resetTime) : '');
    if (label && label !== '-') return label;
  }
  return '';
}

function getCodexWindowLabel(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return '';
  const labels = windows
    .map(window => window?.label || window?.name)
    .filter(Boolean);
  if (labels.length === 0) return '';
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length === 1) return uniqueLabels[0];
  return uniqueLabels.join(', ');
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
 * Calculate quota summary from current quota data
 * @returns {{ critical: number, warning: number, healthy: number, notFetched: number, error: number, total: number }}
 */
function calculateQuotaSummary() {
  const summary = { critical: 0, warning: 0, healthy: 0, notFetched: 0, error: 0, total: 0 };
  
  for (const authFile of authFiles) {
    if (!isQuotaSupported(authFile.provider)) continue;
    
    summary.total++;
    const data = quotaData.get(authFile.auth_index);
    
    if (!data) {
      summary.notFetched++;
      continue;
    }
    
    if (data.error) {
      summary.error++;
      continue;
    }
    
    if (data.loading) {
      // Count loading as not-fetched for summary purposes
      summary.notFetched++;
      continue;
    }
    
    const worstPercentage = getWorstQuotaPercentage(authFile, data);
    const status = getQuotaStatus(worstPercentage);
    summary[status]++;
  }
  
  return summary;
}

/**
 * Get the worst (lowest) quota percentage for an auth file
 * @param {object} authFile - Auth file object
 * @param {object} data - Quota data
 * @returns {number} Worst percentage (0-100)
 */
function getWorstQuotaPercentage(authFile, data) {
  let worstPercentage = 100;
  
  switch (authFile.provider?.toLowerCase()) {
    case 'antigravity':
      if (data.quotaGroups) {
        for (const group of data.quotaGroups) {
          if (group.percentage !== undefined && group.percentage < worstPercentage) {
            worstPercentage = group.percentage;
          }
        }
      }
      break;
      
    case 'codex':
      if (data.quotaGroups) {
        for (const group of data.quotaGroups) {
          if (group.remainingPercentage !== undefined && group.remainingPercentage < worstPercentage) {
            worstPercentage = group.remainingPercentage;
          }
        }
      }
      break;
      
    case 'gemini-cli':
      if (data.quotaGroups) {
        for (const group of data.quotaGroups) {
          if (group.remainingPercentage !== undefined && group.remainingPercentage < worstPercentage) {
            worstPercentage = group.remainingPercentage;
          }
        }
      }
      break;
  }
  
  return Math.max(0, Math.min(100, worstPercentage));
}

/**
 * Render the summary bar with status counts
 */
function renderSummaryBar() {
  const container = document.getElementById('quotaSummaryBar');
  if (!container) return;
  
  const summary = calculateQuotaSummary();
  
  if (summary.total === 0) {
    container.innerHTML = '';
    return;
  }
  
  const fetchedCount = summary.critical + summary.warning + summary.healthy;
  
  container.innerHTML = `
    <div class="quota-summary-stat">
      <span class="quota-summary-stat-value">${summary.total}</span>
      <span>total${fetchedCount < summary.total ? ` (${fetchedCount} fetched)` : ''}</span>
    </div>
    <span class="quota-summary-divider"></span>
    <button class="quota-status-badge critical ${currentStatusFilter === 'critical' ? 'active' : ''}" 
            onclick="setStatusFilter('critical')" 
            aria-pressed="${currentStatusFilter === 'critical'}">
      <span class="status-dot"></span>
      <span class="quota-status-count">${summary.critical}</span> Critical
    </button>
    <button class="quota-status-badge warning ${currentStatusFilter === 'warning' ? 'active' : ''}" 
            onclick="setStatusFilter('warning')"
            aria-pressed="${currentStatusFilter === 'warning'}">
      <span class="status-dot"></span>
      <span class="quota-status-count">${summary.warning}</span> Warning
    </button>
    <button class="quota-status-badge healthy ${currentStatusFilter === 'healthy' ? 'active' : ''}" 
            onclick="setStatusFilter('healthy')"
            aria-pressed="${currentStatusFilter === 'healthy'}">
      <span class="status-dot"></span>
      <span class="quota-status-count">${summary.healthy}</span> Healthy
    </button>
    ${summary.notFetched > 0 ? `
      <button class="quota-status-badge not-fetched ${currentStatusFilter === 'not-fetched' ? 'active' : ''}" 
              onclick="setStatusFilter('not-fetched')"
              aria-pressed="${currentStatusFilter === 'not-fetched'}">
        <span class="status-dot"></span>
        <span class="quota-status-count">${summary.notFetched}</span> Pending
      </button>
    ` : ''}
    ${summary.error > 0 ? `
      <button class="quota-status-badge error ${currentStatusFilter === 'error' ? 'active' : ''}" 
              onclick="setStatusFilter('error')"
              aria-pressed="${currentStatusFilter === 'error'}">
        <span class="status-dot"></span>
        <span class="quota-status-count">${summary.error}</span> Error
      </button>
    ` : ''}
  `;
  
  renderActiveFilters();
  updateSyncStatus();
}

/**
 * Update the sync status indicator
 */
function updateSyncStatus() {
  const container = document.getElementById('quotaSyncStatus');
  const textEl = document.getElementById('quotaSyncText');
  if (!container || !textEl) return;
  
  const summary = calculateQuotaSummary();
  const fetchedCount = summary.critical + summary.warning + summary.healthy + summary.error;
  
  container.classList.remove('syncing', 'success', 'error');
  
  if (fetchedCount === 0) {
    textEl.textContent = 'Click Fetch All to load';
  } else if (summary.error > 0 && fetchedCount === summary.error) {
    container.classList.add('error');
    textEl.textContent = `${summary.error} failed`;
  } else {
    container.classList.add('success');
    textEl.textContent = `${fetchedCount}/${summary.total} fetched`;
  }
}

/**
 * Render active filter chips (provider, status, search, favorites)
 */
function renderActiveFilters() {
  const container = document.getElementById('quotaActiveFilters');
  if (!container) return;
  
  const chips = [];
  
  if (showFavoritesOnly) {
    chips.push(`
      <div class="quota-filter-chip favorites">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        Favorites only
        <button class="quota-filter-chip-remove" onclick="toggleFavoritesFilter()" aria-label="Remove favorites filter">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `);
  }
  
  if (currentFilter !== 'all') {
    chips.push(`
      <div class="quota-filter-chip">
        Provider: ${escapeHtml(currentFilter)}
        <button class="quota-filter-chip-remove" onclick="setQuotaFilter('all')" aria-label="Remove provider filter">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `);
  }
  
  if (currentStatusFilter) {
    chips.push(`
      <div class="quota-filter-chip">
        Status: ${escapeHtml(currentStatusFilter)}
        <button class="quota-filter-chip-remove" onclick="setStatusFilter(null)" aria-label="Remove status filter">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `);
  }
  
  if (quotaSearchQuery) {
    chips.push(`
      <div class="quota-filter-chip">
        Search: "${escapeHtml(quotaSearchQuery)}"
        <button class="quota-filter-chip-remove" onclick="clearQuotaSearch()" aria-label="Clear search">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `);
  }
  
  container.innerHTML = chips.join('');
}

/**
 * Render view toggle button (icon only version)
 */
function renderViewToggle() {
  const container = document.getElementById('quotaViewToggle');
  if (!container) return;
  
  const isCompact = currentViewMode === 'compact';
  
  container.innerHTML = `
    <button class="quota-view-btn ${isCompact ? '' : 'active'}" 
            onclick="setViewMode('detailed')"
            aria-pressed="${!isCompact}"
            title="Detailed view">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
    </button>
    <button class="quota-view-btn ${isCompact ? 'active' : ''}" 
            onclick="setViewMode('compact')"
            aria-pressed="${isCompact}"
            title="Compact view">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      </svg>
    </button>
  `;
  
  const quotaContainer = document.getElementById('quotaContainer');
  if (quotaContainer) {
    quotaContainer.classList.toggle('compact-view', isCompact);
  }
}

/**
 * Toggle the more actions menu
 */
export function toggleQuotaMoreMenu() {
  const menu = document.getElementById('quotaMoreMenu');
  if (menu) {
    menu.classList.toggle('open');
    
    // Close on click outside
    if (menu.classList.contains('open')) {
      setTimeout(() => {
        document.addEventListener('click', closeQuotaMoreMenuOnClickOutside);
      }, 0);
    }
  }
}

/**
 * Close the more actions menu
 */
export function closeQuotaMoreMenu() {
  const menu = document.getElementById('quotaMoreMenu');
  if (menu) {
    menu.classList.remove('open');
    document.removeEventListener('click', closeQuotaMoreMenuOnClickOutside);
  }
}

function closeQuotaMoreMenuOnClickOutside(e) {
  const menu = document.getElementById('quotaMoreMenu');
  const btn = document.getElementById('quotaMoreBtn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    closeQuotaMoreMenu();
  }
}

/**
 * Open mobile filter drawer
 */
export function openQuotaFilterDrawer() {
  const drawer = document.getElementById('quotaFilterDrawer');
  if (drawer) {
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close mobile filter drawer
 */
export function closeQuotaFilterDrawer() {
  const drawer = document.getElementById('quotaFilterDrawer');
  if (drawer) {
    drawer.classList.remove('open');
    document.body.style.overflow = '';
  }
}

/**
 * Set view mode and persist preference
 * @param {string} mode - 'compact' | 'detailed'
 */
export function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('quotaViewMode', mode);
  renderViewToggle();
}

/**
 * Set status filter and re-render
 * @param {string|null} status - 'critical' | 'warning' | 'healthy' | null
 */
export function setStatusFilter(status) {
  if (currentStatusFilter === status) {
    currentStatusFilter = null;
  } else {
    currentStatusFilter = status;
  }
  
  applyFilter();
  renderQuotaPage();
  renderSummaryBar();
}

/**
 * Render a circular progress indicator SVG
 * @param {number} percentage - Percentage (0-100)
 * @param {string} status - 'critical' | 'warning' | 'healthy'
 * @returns {string} HTML string for circular progress
 */
function renderCircularProgress(percentage, status) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  
  return `
    <div class="quota-circular-progress" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="${percentage}% quota remaining">
      <svg viewBox="0 0 52 52">
        <circle class="progress-bg" cx="26" cy="26" r="${radius}"></circle>
        <circle class="progress-bar ${status}" cx="26" cy="26" r="${radius}" 
                stroke-dasharray="${circumference}" 
                stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="progress-text">${Math.round(percentage)}%</div>
    </div>
  `;
}

/**
 * Toggle expanded state of quota groups for a card
 * @param {string} authIndex - Auth index of the card
 */
export function toggleQuotaGroups(authIndex) {
  const card = document.querySelector(`[data-auth-index="${authIndex}"]`);
  if (!card) return;
  
  const collapsedSection = card.querySelector('.quota-groups-collapsed');
  const toggleBtn = card.querySelector('.quota-show-more-btn');
  
  if (collapsedSection && toggleBtn) {
    const isExpanded = collapsedSection.classList.toggle('expanded');
    toggleBtn.classList.toggle('expanded', isExpanded);
    toggleBtn.setAttribute('aria-expanded', isExpanded);
    
    const count = collapsedSection.querySelectorAll('.quota-group').length;
    toggleBtn.innerHTML = isExpanded 
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg> Show less`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg> Show ${count} more`;
  }
}

/**
 * Get the worst (lowest percentage) quota group from data
 * @param {Array} quotaGroups - Array of quota groups
 * @param {string} percentageKey - Key for percentage value ('percentage' or 'remainingPercentage')
 * @returns {{ worstGroup: object|null, worstIndex: number }}
 */
function getWorstQuotaGroup(quotaGroups, percentageKey = 'percentage') {
  if (!quotaGroups || quotaGroups.length === 0) {
    return { worstGroup: null, worstIndex: -1 };
  }
  
  let worstIndex = 0;
  let worstPercentage = quotaGroups[0]?.[percentageKey] ?? 100;
  
  quotaGroups.forEach((group, index) => {
    const pct = group[percentageKey] ?? 100;
    if (pct < worstPercentage) {
      worstPercentage = pct;
      worstIndex = index;
    }
  });
  
  return { worstGroup: quotaGroups[worstIndex], worstIndex };
}

/**
 * Sort auth files by quota urgency (critical first, then warning, then healthy)
 * @param {Array} files - Array of auth files
 * @returns {Array} Sorted array
 */
function sortByQuotaUrgency(files) {
  return [...files].sort((a, b) => {
    const dataA = quotaData.get(a.auth_index);
    const dataB = quotaData.get(b.auth_index);
    
    const getPercentage = (authFile, data) => {
      if (!data || data.error || data.loading) return 100;
      if (!isQuotaSupported(authFile.provider)) return 100;
      return getWorstQuotaPercentage(authFile, data);
    };
    
    const pctA = getPercentage(a, dataA);
    const pctB = getPercentage(b, dataB);
    
    const statusOrder = { 'critical': 0, 'warning': 1, 'healthy': 2 };
    const statusA = getQuotaStatus(pctA);
    const statusB = getQuotaStatus(pctB);
    
    if (statusA !== statusB) {
      return statusOrder[statusA] - statusOrder[statusB];
    }
    
    return pctA - pctB;
  });
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
    lastFetchStatus = { start: Date.now(), end: null, success: null, count: 1 };
    updateFetchStatus();
    quotaData.delete(authIndex);
    await fetchQuotaForAuth(authFile);
    renderQuotaPage();
    updateLastUpdated();
    lastFetchStatus = { ...lastFetchStatus, end: Date.now(), success: true, count: 1 };
    updateFetchStatus();
    toast('Quota refreshed', 'success');
  } catch (e) {
    lastFetchStatus = { ...lastFetchStatus, end: Date.now(), success: false, count: 1 };
    updateFetchStatus();
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

    lastFetchStatus = { start: Date.now(), end: null, success: null, count: supportedFiles.length };
    updateFetchStatus();
    
    for (const authFile of supportedFiles) {
      quotaData.delete(authFile.auth_index);
    }
    
    await Promise.all(supportedFiles.map(authFile => fetchQuotaForAuth(authFile)));
    
    renderQuotaPage();
    updateLastUpdated();
    lastFetchStatus = { ...lastFetchStatus, end: Date.now(), success: true, count: supportedFiles.length };
    updateFetchStatus();
    toast(`Refreshed ${supportedFiles.length} quota(s)`, 'success');
  } catch (e) {
    lastFetchStatus = { ...lastFetchStatus, end: Date.now(), success: false };
    updateFetchStatus();
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
  
  document.querySelectorAll('.quota-provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
    btn.setAttribute('aria-pressed', btn.dataset.filter === filter);
  });
  
  applyFilter();
  renderQuotaPage();
  renderSummaryBar();
}

export function setQuotaSearch(value) {
  quotaSearchQuery = value || '';
  const clearBtn = document.getElementById('quotaSearchClear');
  if (clearBtn) {
    clearBtn.style.display = quotaSearchQuery.trim() ? 'inline-flex' : 'none';
  }
  
  // Debounce search to avoid excessive re-renders
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    applyFilter();
    renderQuotaPage();
  }, SEARCH_DEBOUNCE_MS);
}

export function clearQuotaSearch() {
  quotaSearchQuery = '';
  const input = document.getElementById('quotaSearch');
  if (input) input.value = '';
  const clearBtn = document.getElementById('quotaSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  applyFilter();
  renderQuotaPage();
}

export function resetQuotaFilters() {
  currentFilter = 'all';
  currentStatusFilter = null;
  showFavoritesOnly = false;
  clearQuotaSearch();
  document.querySelectorAll('.quota-provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
    btn.setAttribute('aria-pressed', btn.dataset.filter === 'all');
  });
  renderFavoritesFilterButton();
  applyFilter();
  renderQuotaPage();
  renderSummaryBar();
}

export async function handleQuotaBulkAction(action) {
  const select = document.getElementById('quotaBulkAction');
  if (select) select.value = '';
  if (!action) return;
  if (action === 'fetch-visible') {
    await fetchAllQuotas();
    return;
  }
  if (action === 'fetch-all') {
    const prevPage = currentPage;
    const prevFilter = currentFilter;
    const prevStatus = currentStatusFilter;
    const prevSearch = quotaSearchQuery;
    currentFilter = 'all';
    currentStatusFilter = null;
    quotaSearchQuery = '';
    applyFilter();
    currentPage = 1;
    await fetchAllQuotas();
    currentFilter = prevFilter;
    currentStatusFilter = prevStatus;
    quotaSearchQuery = prevSearch;
    applyFilter();
    currentPage = Math.min(prevPage, Math.max(1, Math.ceil(filteredAuthFiles.length / pageSize)));
    renderQuotaPage();
    renderSummaryBar();
    return;
  }
  if (action === 'reset-filters') {
    resetQuotaFilters();
  }
}

/**
 * Set page size
 * @param {number|string} size - Page size
 */
export function setQuotaPageSize(size) {
  pageSize = parseInt(size, 10);
  currentPage = 1;
  renderQuotaPage();
  // Don't auto-fetch - user must click refresh manually
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
  // Don't auto-fetch - user must click refresh manually
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
 * Get quota status based on remaining percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {'critical'|'warning'|'healthy'} Status string
 */
export function getQuotaStatus(percentage) {
  if (percentage >= 60) return 'healthy';
  if (percentage >= 30) return 'warning';
  return 'critical';
}

/**
 * Get color class based on remaining percentage
 * Thresholds: Critical < 30%, Warning 30-59%, Healthy >= 60%
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} CSS color class
 */
export function getQuotaColorClass(percentage) {
  if (percentage >= 60) return 'quota-green';
  if (percentage >= 30) return 'quota-yellow';
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
window.unloadQuotaPage = unloadQuotaPage;
window.refreshQuota = refreshQuota;
window.fetchAllQuotas = fetchAllQuotas;
window.fetchVisibleQuotas = fetchVisibleQuotas;
window.setQuotaFilter = setQuotaFilter;
window.setQuotaPageSize = setQuotaPageSize;
window.setQuotaPage = setQuotaPage;
window.getQuotaStatus = getQuotaStatus;
window.setStatusFilter = setStatusFilter;
window.toggleQuotaGroups = toggleQuotaGroups;
window.setViewMode = setViewMode;
window.setQuotaSearch = setQuotaSearch;
window.clearQuotaSearch = clearQuotaSearch;
window.resetQuotaFilters = resetQuotaFilters;
window.handleQuotaBulkAction = handleQuotaBulkAction;
window.toggleQuotaMoreMenu = toggleQuotaMoreMenu;
window.closeQuotaMoreMenu = closeQuotaMoreMenu;
window.fetchVisibleQuotas = fetchVisibleQuotas;
window.openQuotaFilterDrawer = openQuotaFilterDrawer;
window.closeQuotaFilterDrawer = closeQuotaFilterDrawer;

// Favorites functions
window.toggleFavorite = toggleFavorite;
window.updateFavoriteLabel = updateFavoriteLabel;
window.updateFavoriteLabelFromInput = updateFavoriteLabelFromInput;
window.removeFavorite = removeFavorite;
window.toggleFavoritesFilter = toggleFavoritesFilter;
window.openManageFavoritesModal = openManageFavoritesModal;
window.closeManageFavoritesModal = closeManageFavoritesModal;
