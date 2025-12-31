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
  setAllModels
} from '../core/state.js';

// Forward declaration for fetchModels from models.js (to avoid circular dependency)
let fetchModelsFunc = null;

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
    updateServerUptime(buildDate);

    // Load auth files count
    api('GET', '/auth-files')
      .then(d => document.getElementById('statAuthFiles').textContent = (d.files || []).length)
      .catch(() => {});

    // Load models count
    if (fetchModelsFunc) {
      fetchModelsFunc()
        .then(models => {
          document.getElementById('statModels').textContent = models.length;
          setAllModels(models);
        })
        .catch(() => document.getElementById('statModels').textContent = '-');
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
 * @param {string} buildDate - The build date string
 */
export function updateServerUptime(buildDate) {
  const uptimeEl = document.getElementById('serverUptime');
  if (!uptimeEl) return;

  const now = Date.now();
  const uptimeMs = now - getDashboardStartTime();

  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let uptimeStr = '';
  if (days > 0) uptimeStr = `${days}d ${hours % 24}h ${minutes % 60}m`;
  else if (hours > 0) uptimeStr = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  else if (minutes > 0) uptimeStr = `${minutes}m ${seconds % 60}s`;
  else uptimeStr = `${seconds}s`;

  uptimeEl.textContent = uptimeStr + ' (session)';
}

/**
 * Start the uptime update interval
 * @returns {number} The interval ID
 */
export function startUptimeInterval() {
  return setInterval(() => {
    const uptimeEl = document.getElementById('serverUptime');
    if (uptimeEl && uptimeEl.textContent !== '-') {
      updateServerUptime();
    }
  }, 1000);
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
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1, v2) {
  // Remove 'v' prefix if present
  v1 = v1.replace(/^v/, '');
  v2 = v2.replace(/^v/, '');

  const parts1 = v1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = v2.split('.').map(p => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// Expose functions to window for HTML onclick handlers
window.loadDashboard = loadDashboard;
window.checkLatestVersion = checkLatestVersion;
