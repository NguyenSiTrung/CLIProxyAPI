/**
 * Dashboard Page Module
 * Handles dashboard loading, server info display, uptime tracking, and version checking
 */

import { api, apiFetch, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import {
  setServerInfo,
  setAccessApiKeys,
  setCurrentServerVersion,
  getCurrentServerVersion,
  getDashboardStartTime,
  getServerStartTime,
  setServerStartTime,
  setAllModels
} from '../core/state.js';

// Forward declaration for fetchModels from models.js (to avoid circular dependency)
let fetchModelsFunc = null;

// Dashboard-specific state
let uptimeIntervalId = null;
let autoRefreshIntervalId = null;
let visibilityHandler = null;

/**
 * Set the fetchModels function reference (called from main app initialization)
 * @param {Function} fn - The fetchModels function from models.js
 */
export function setFetchModelsFunc(fn) {
  fetchModelsFunc = fn;
}

/**
 * Load the dashboard page data
 */
export async function loadDashboard() {
  // Initialize dashboard resources
  initDashboard();
  
  const refreshBtn = document.getElementById('dashboardRefreshBtn');
  const lastUpdatedEl = document.getElementById('dashboardLastUpdated');
  const statCards = document.querySelectorAll('.stats-grid .stat-card');

  // Add loading states
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.classList.add('refreshing');
  }
  statCards.forEach(card => card.classList.add('loading'));

  try {
    const apiKey = getApiKey();

    // Fetch config with full response to get headers
    const configRes = await fetch('/v0/management/config', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const version = configRes.headers.get('X-CPA-VERSION') || '-';
    const commit = configRes.headers.get('X-CPA-COMMIT') || '-';
    const buildDate = configRes.headers.get('X-CPA-BUILD-DATE') || '-';
    const serverStartTime = configRes.headers.get('X-CPA-START-TIME') || null;
    const config = await configRes.json();

    setServerInfo(config);
    const accessKeys = config['api-keys'] || config.api_keys || [];
    setAccessApiKeys(accessKeys);
    setCurrentServerVersion(version);

    // Fetch usage
    const usage = await api('GET', '/usage').catch(() => ({ usage: {} }));

    // Remove loading state and update values
    statCards.forEach(card => card.classList.remove('loading'));

    document.getElementById('statRequests').textContent = (usage.usage?.total_requests || 0).toLocaleString();
    const total = usage.usage?.total_requests || 0;
    const failed = usage.usage?.failed_requests || usage.failed_requests || 0;
    const successRate = total > 0 ? ((total - failed) / total * 100).toFixed(1) : '-';
    document.getElementById('statSuccess').textContent = successRate === '-' ? '-' : successRate + '%';

    document.getElementById('serverVersion').textContent = `Version: ${version} | Commit: ${commit.slice(0, 7)}`;
    document.getElementById('versionBadge').textContent = version;
    document.getElementById('buildDate').textContent = buildDate;

    // Update last updated timestamp
    const updateTimeEl = document.getElementById('dashboardUpdateTime');
    if (updateTimeEl) {
      updateTimeEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }

    // Update uptime
    updateServerUptime(serverStartTime);

    // Load auth files count
    api('GET', '/auth-files')
      .then(d => {
        const el = document.getElementById('statAuthFiles');
        if (el) el.textContent = (d.files || []).length;
      })
      .catch(err => {
        console.warn('Failed to load auth files count:', err.message);
        const el = document.getElementById('statAuthFiles');
        if (el) el.textContent = '-';
      });

    // Load models count
    if (fetchModelsFunc) {
      fetchModelsFunc()
        .then(models => {
          const el = document.getElementById('statModels');
          if (el) el.textContent = models.length;
          setAllModels(models);
        })
        .catch(err => {
          console.warn('Failed to load models count:', err.message);
          const el = document.getElementById('statModels');
          if (el) el.textContent = '-';
        });
    }

    // Update health indicator
    const healthIndicator = document.getElementById('healthIndicator');
    if (healthIndicator) {
      healthIndicator.classList.remove('offline');
      healthIndicator.querySelector('.health-text').textContent = 'Online';
    }
  } catch (e) {
    toast('Failed to load dashboard: ' + e.message, 'error');
    statCards.forEach(card => card.classList.remove('loading'));

    // Update health indicator to offline
    const healthIndicator = document.getElementById('healthIndicator');
    if (healthIndicator) {
      healthIndicator.classList.add('offline');
      healthIndicator.querySelector('.health-text').textContent = 'Offline';
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
    if (lastUpdatedEl) {
      lastUpdatedEl.classList.remove('refreshing');
    }
  }
}

/**
 * Update the server uptime display
 * @param {string} serverStartTimeStr - The server start time in ISO format (optional, uses cached value if not provided)
 */
export function updateServerUptime(serverStartTimeStr) {
  const uptimeEl = document.getElementById('serverUptime');
  if (!uptimeEl) return;

  if (serverStartTimeStr) {
    const parsedTime = new Date(serverStartTimeStr).getTime();
    if (!isNaN(parsedTime)) {
      setServerStartTime(parsedTime);
    }
  }

  const startTime = getServerStartTime();
  if (!startTime) {
    uptimeEl.textContent = '-';
    return;
  }

  const now = Date.now();
  const uptimeMs = now - startTime;

  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let uptimeStr = '';
  if (days > 0) uptimeStr = `${days}d ${hours % 24}h ${minutes % 60}m`;
  else if (hours > 0) uptimeStr = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  else if (minutes > 0) uptimeStr = `${minutes}m ${seconds % 60}s`;
  else uptimeStr = `${seconds}s`;

  uptimeEl.textContent = uptimeStr;
}

/**
 * Start the uptime update interval
 * @returns {number} The interval ID
 */
export function startUptimeInterval() {
  // Clear any existing interval first
  stopUptimeInterval();
  
  uptimeIntervalId = setInterval(() => {
    const uptimeEl = document.getElementById('serverUptime');
    if (uptimeEl && uptimeEl.textContent !== '-') {
      updateServerUptime();
    }
  }, 1000);
  
  return uptimeIntervalId;
}

/**
 * Stop the uptime update interval
 */
export function stopUptimeInterval() {
  if (uptimeIntervalId) {
    clearInterval(uptimeIntervalId);
    uptimeIntervalId = null;
  }
}

/**
 * Setup visibility change handler to pause/resume animations
 */
export function setupVisibilityHandler() {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  
  visibilityHandler = () => {
    const healthIndicator = document.getElementById('healthIndicator');
    if (healthIndicator) {
      if (document.hidden) {
        healthIndicator.classList.add('paused');
      } else {
        healthIndicator.classList.remove('paused');
      }
    }
  };
  
  document.addEventListener('visibilitychange', visibilityHandler);
}

/**
 * Cleanup dashboard resources when leaving the page
 */
export function cleanupDashboard() {
  stopUptimeInterval();
  
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
  }
  
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}

/**
 * Check for the latest version from the server
 */
export async function checkLatestVersion() {
  const checkBtn = document.getElementById('checkUpdateBtn');
  if (checkBtn) {
    checkBtn.classList.add('loading');
    checkBtn.disabled = true;
  }

  try {
    const d = await api('GET', '/latest-version');
    const latestVersion = d['latest-version'] || '-';
    document.getElementById('latestVersion').textContent = latestVersion;

    // Compare versions and update badge
    updateVersionBadge(getCurrentServerVersion(), latestVersion);

    toast('Version check complete', 'success');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');

    // Reset badge to unknown
    const badge = document.getElementById('versionStatusBadge');
    const badgeText = document.getElementById('versionStatusText');
    if (badge && badgeText) {
      badge.className = 'version-badge unknown';
      badgeText.textContent = 'Check Failed';
    }
  } finally {
    if (checkBtn) {
      checkBtn.classList.remove('loading');
      checkBtn.disabled = false;
    }
  }
}

/**
 * Update the version status badge based on current vs latest version
 * @param {string} current - Current server version
 * @param {string} latest - Latest available version
 */
export function updateVersionBadge(current, latest) {
  const badge = document.getElementById('versionStatusBadge');
  const badgeText = document.getElementById('versionStatusText');
  if (!badge || !badgeText) return;

  if (!current || current === '-' || !latest || latest === '-') {
    badge.className = 'version-badge unknown';
    badge.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <span id="versionStatusText">Unknown</span>
    `;
    return;
  }

  const isUpToDate = compareVersions(current, latest) >= 0;

  if (isUpToDate) {
    badge.className = 'version-badge up-to-date';
    badge.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span id="versionStatusText">Up to date</span>
    `;
  } else {
    badge.className = 'version-badge outdated';
    badge.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span id="versionStatusText">Update available</span>
    `;
  }
}

/**
 * Compare two semantic version strings
 * Handles versions like: 1.0.0, v1.0.0, 1.0.0-beta, 1.0.0-rc.1, 1.0.0+build
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1, v2) {
  if (!v1 || !v2) return 0;
  
  // Remove 'v' prefix if present
  v1 = v1.replace(/^v/, '');
  v2 = v2.replace(/^v/, '');

  // Split version and pre-release parts (e.g., "1.0.0-beta.1" -> ["1.0.0", "beta.1"])
  const [version1, prerelease1] = v1.split('-');
  const [version2, prerelease2] = v2.split('-');

  // Remove build metadata (everything after +)
  const cleanVersion1 = version1.split('+')[0];
  const cleanVersion2 = version2.split('+')[0];

  const parts1 = cleanVersion1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = cleanVersion2.split('.').map(p => parseInt(p, 10) || 0);

  // Compare main version numbers
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  // If main versions are equal, compare pre-release
  // A version without pre-release is greater than one with pre-release
  // e.g., 1.0.0 > 1.0.0-beta
  if (!prerelease1 && prerelease2) return 1;
  if (prerelease1 && !prerelease2) return -1;
  if (prerelease1 && prerelease2) {
    const prereleaseComparison = comparePrerelease(prerelease1, prerelease2);
    if (prereleaseComparison !== 0) return prereleaseComparison;
  }
  
  return 0;
}

/**
 * Compare two pre-release identifiers (e.g., "alpha.1" vs "alpha.2")
 * @param {string} prerelease1 - First pre-release string
 * @param {string} prerelease2 - Second pre-release string
 * @returns {number} 1 if prerelease1 > prerelease2, -1 if prerelease1 < prerelease2, 0 if equal
 */
function comparePrerelease(prerelease1, prerelease2) {
  const identifiers1 = prerelease1.split('.');
  const identifiers2 = prerelease2.split('.');

  const maxLength = Math.max(identifiers1.length, identifiers2.length);
  for (let i = 0; i < maxLength; i++) {
    const id1 = identifiers1[i];
    const id2 = identifiers2[i];

    if (id1 === undefined) return -1;
    if (id2 === undefined) return 1;

    const isNumeric1 = /^[0-9]+$/.test(id1);
    const isNumeric2 = /^[0-9]+$/.test(id2);

    if (isNumeric1 && isNumeric2) {
      const num1 = parseInt(id1, 10);
      const num2 = parseInt(id2, 10);
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
      continue;
    }

    if (isNumeric1 && !isNumeric2) return -1;
    if (!isNumeric1 && isNumeric2) return 1;

    if (id1 > id2) return 1;
    if (id1 < id2) return -1;
  }

  return 0;
}

/**
 * Initialize dashboard - call this when navigating to dashboard
 */
export function initDashboard() {
  setupVisibilityHandler();
  startUptimeInterval();
}

// Expose functions to window for HTML onclick handlers
window.loadDashboard = loadDashboard;
window.checkLatestVersion = checkLatestVersion;
window.cleanupDashboard = cleanupDashboard;
window.initDashboard = initDashboard;
