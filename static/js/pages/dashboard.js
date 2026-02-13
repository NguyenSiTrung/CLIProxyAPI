/**
 * Dashboard Page Module
 * Handles dashboard loading, server info display, uptime tracking, and version checking
 * Enhanced with: time-based greetings, animated counters, keyboard shortcuts, activity timeline
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
let keyboardShortcutHandler = null;
let previousStats = { requests: 0, authFiles: 0, models: 0 };

// Activity log for recent activity timeline
let activityLog = [];

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

    // Remove loading state and update values with animations
    statCards.forEach(card => card.classList.remove('loading'));

    const totalRequests = usage.usage?.total_requests || 0;
    const failed = usage.usage?.failed_requests || usage.failed_requests || 0;
    const successRate = totalRequests > 0 ? ((totalRequests - failed) / totalRequests * 100).toFixed(1) : '-';
    
    // Animate request counter
    const requestsEl = document.getElementById('statRequests');
    if (requestsEl) {
      animateCounter(requestsEl, totalRequests, 800);
    }
    
    // Update success rate
    const successEl = document.getElementById('statSuccess');
    if (successEl) {
      successEl.textContent = successRate === '-' ? '-' : successRate + '%';
      successEl.dataset.value = successRate;
    }
    
    // Update system health metrics
    updateSystemHealth(usage.usage);
    
    // Update checklist after data loads
    setTimeout(() => updateChecklist(), 500);

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

    // Load auth files count with animation
    api('GET', '/auth-files')
      .then(d => {
        const el = document.getElementById('statAuthFiles');
        const count = (d.files || []).length;
        if (el) {
          animateCounter(el, count, 600);
        }
        // Update checklist
        setTimeout(() => updateChecklist(), 100);
      })
      .catch(err => {
        console.warn('Failed to load auth files count:', err.message);
        const el = document.getElementById('statAuthFiles');
        if (el) {
          el.textContent = '-';
          el.dataset.value = '0';
        }
      });

    // Load models count with animation
    if (fetchModelsFunc) {
      fetchModelsFunc()
        .then(models => {
          const el = document.getElementById('statModels');
          if (el) {
            animateCounter(el, models.length, 600);
          }
          setAllModels(models);
          // Update checklist
          setTimeout(() => updateChecklist(), 100);
        })
        .catch(err => {
          console.warn('Failed to load models count:', err.message);
          const el = document.getElementById('statModels');
          if (el) {
            el.textContent = '-';
            el.dataset.value = '0';
          }
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
  
  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
    keyboardShortcutHandler = null;
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
  updateGreeting();
  setupKeyboardShortcuts();
  updateChecklist();
  loadRecentActivity();
}

/**
 * Update the greeting based on time of day
 */
export function updateGreeting() {
  const greetingEl = document.getElementById('dashboardGreeting');
  const emojiEl = document.getElementById('greetingEmoji');
  const subtitleEl = document.getElementById('dashboardSubtitle');
  
  if (!greetingEl) return;
  
  const hour = new Date().getHours();
  let greeting, emoji, subtitle;
  
  if (hour >= 5 && hour < 12) {
    greeting = 'Good morning';
    emoji = '☀️';
    subtitle = "Start your day with a quick overview";
  } else if (hour >= 12 && hour < 17) {
    greeting = 'Good afternoon';
    emoji = '🌤️';
    subtitle = "Here's your server status";
  } else if (hour >= 17 && hour < 21) {
    greeting = 'Good evening';
    emoji = '🌅';
    subtitle = "Check your daily progress";
  } else {
    greeting = 'Good night';
    emoji = '🌙';
    subtitle = "Late night monitoring";
  }
  
  greetingEl.textContent = greeting;
  if (emojiEl) emojiEl.textContent = emoji;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

/**
 * Animate a counter from 0 to target value
 */
export function animateCounter(element, targetValue, duration = 1000) {
  if (!element || isNaN(targetValue)) return;
  
  const startValue = 0;
  const startTime = performance.now();
  
  element.classList.add('counting');
  
  function updateCounter(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function for smooth animation
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const currentValue = Math.floor(startValue + (targetValue - startValue) * easeOutQuart);
    
    element.textContent = currentValue.toLocaleString();
    element.dataset.value = currentValue;
    
    if (progress < 1) {
      requestAnimationFrame(updateCounter);
    } else {
      element.classList.remove('counting');
      element.textContent = targetValue.toLocaleString();
      element.dataset.value = targetValue;
    }
  }
  
  requestAnimationFrame(updateCounter);
}

/**
 * Setup keyboard shortcuts for quick actions
 */
export function setupKeyboardShortcuts() {
  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
  }
  
  keyboardShortcutHandler = (e) => {
    // Don't trigger if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    
    // Check if we're on the dashboard page
    const dashboardPage = document.getElementById('page-dashboard');
    if (!dashboardPage || !dashboardPage.classList.contains('active')) {
      return;
    }
    
    const key = e.key.toUpperCase();
    const shortcuts = {
      'M': 'models',
      'A': 'auth',
      'U': 'usage',
      'L': 'logs',
      'K': 'keys',
      'S': 'config'
    };
    
    if (shortcuts[key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (window.navigateTo) {
        window.navigateTo(shortcuts[key]);
      }
    }
  };
  
  document.addEventListener('keydown', keyboardShortcutHandler);
}

/**
 * Update the getting started checklist based on current state
 */
export function updateChecklist() {
  const checklistCard = document.getElementById('gettingStartedCard');
  if (!checklistCard) return;
  
  // Check if user has dismissed the checklist
  if (localStorage.getItem('dismissedGettingStarted') === 'true') {
    checklistCard.style.display = 'none';
    return;
  }
  
  const steps = {
    server: true, // Always true if dashboard loads
    auth: false,
    model: false,
    request: false
  };
  
  // These will be updated by loadDashboard
  const authCount = parseInt(document.getElementById('statAuthFiles')?.dataset?.value || '0');
  const modelCount = parseInt(document.getElementById('statModels')?.dataset?.value || '0');
  const requestCount = parseInt(document.getElementById('statRequests')?.dataset?.value || '0');
  
  steps.auth = authCount > 0;
  steps.model = modelCount > 0;
  steps.request = requestCount > 0;
  
  // Update UI
  Object.entries(steps).forEach(([step, completed]) => {
    const item = document.querySelector(`.checklist-item[data-step="${step}"]`);
    if (item) {
      if (completed) {
        item.classList.add('completed');
      } else {
        item.classList.remove('completed');
      }
    }
  });
  
  // Update progress
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount = Object.keys(steps).length;
  const progressFill = document.getElementById('checklistProgress');
  const progressText = document.getElementById('checklistProgressText');
  
  if (progressFill) {
    progressFill.style.width = `${(completedCount / totalCount) * 100}%`;
  }
  if (progressText) {
    progressText.textContent = `${completedCount} of ${totalCount} complete`;
  }
  
  // Hide checklist if all steps completed
  if (completedCount === totalCount) {
    setTimeout(() => {
      checklistCard.style.display = 'none';
      localStorage.setItem('dismissedGettingStarted', 'true');
    }, 2000);
  }
}

/**
 * Dismiss the getting started checklist
 */
export function dismissGettingStarted() {
  const checklistCard = document.getElementById('gettingStartedCard');
  if (checklistCard) {
    checklistCard.style.opacity = '0';
    checklistCard.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      checklistCard.style.display = 'none';
    }, 300);
  }
  localStorage.setItem('dismissedGettingStarted', 'true');
}

/**
 * Add an activity item to the log
 */
export function addActivity(type, text, icon = 'cyan') {
  const activity = {
    type,
    text,
    icon,
    time: new Date()
  };
  
  activityLog.unshift(activity);
  if (activityLog.length > 10) {
    activityLog.pop();
  }
  
  renderActivityTimeline();
}

/**
 * Load recent activity from usage/logs
 */
export function loadRecentActivity() {
  const timeline = document.getElementById('activityTimeline');
  if (!timeline) return;
  
  // Generate some activity based on current state
  activityLog = [];
  
  // Add server start activity
  addActivity('server', 'Dashboard loaded', 'green');
  
  // Load recent logs if available
  api('GET', '/logs?limit=5').then(data => {
    if (data.logs && data.logs.length > 0) {
      data.logs.slice(0, 3).forEach(log => {
        const model = log.model || 'Unknown model';
        const status = log.status_code < 400 ? 'completed' : 'failed';
        const icon = log.status_code < 400 ? 'green' : 'red';
        addActivity('request', `Request to ${model} ${status}`, icon);
      });
    }
  }).catch(() => {
    // Silently fail - activity timeline is non-critical
  });
}

/**
 * Render the activity timeline
 */
function renderActivityTimeline() {
  const timeline = document.getElementById('activityTimeline');
  if (!timeline) return;
  
  if (activityLog.length === 0) {
    timeline.innerHTML = `
      <div class="activity-item">
        <div class="activity-icon cyan">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <div class="activity-content">
          <p class="activity-text">No recent activity</p>
          <span class="activity-time">--</span>
        </div>
      </div>
    `;
    return;
  }
  
  const icons = {
    cyan: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
    green: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
    red: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
    yellow: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    purple: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>'
  };
  
  timeline.innerHTML = activityLog.map(activity => {
    const timeAgo = getTimeAgo(activity.time);
    const iconSvg = icons[activity.icon] || icons.cyan;
    
    return `
      <div class="activity-item">
        <div class="activity-icon ${activity.icon}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${iconSvg}
          </svg>
        </div>
        <div class="activity-content">
          <p class="activity-text">${escapeHtml(activity.text)}</p>
          <span class="activity-time">${timeAgo}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Toggle theme between light and dark
 */
export function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const isLight = document.body.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  toast(`Switched to ${isLight ? 'light' : 'dark'} theme`, 'success');
}

/**
 * Toggle notifications panel (placeholder)
 */
export function toggleNotifications() {
  toast('No new notifications', 'info');
}

/**
 * Update system health metrics
 */
export async function updateSystemHealth(usage) {
  // First, try to fetch real system metrics from API
  let systemMetrics = null;
  try {
    const response = await api('GET', '/system');
    if (response) {
      systemMetrics = response;
    }
  } catch (e) {
    console.warn('Failed to fetch system metrics:', e);
  }

  if (systemMetrics) {
    // CPU
    const cpuEl = document.getElementById('metricCPU');
    const cpuFill = document.getElementById('metricCPUFill');
    if (cpuEl) cpuEl.textContent = systemMetrics.cpu_percent?.toFixed(1) + '%' || '--%';
    if (cpuFill) cpuFill.style.width = Math.min(systemMetrics.cpu_percent || 0, 100) + '%';

    // Memory
    const memEl = document.getElementById('metricMemory');
    const memFill = document.getElementById('metricMemoryFill');
    if (memEl) {
      const memUsed = systemMetrics.memory_used_bytes || 0;
      const memTotal = systemMetrics.memory_total_bytes || 1;
      memEl.textContent = formatBytes(memUsed) + ' / ' + formatBytes(memTotal);
    }
    if (memFill) memFill.style.width = Math.min(systemMetrics.memory_percent || 0, 100) + '%';

    // Disk
    const diskEl = document.getElementById('metricDisk');
    const diskFill = document.getElementById('metricDiskFill');
    if (diskEl) diskEl.textContent = systemMetrics.disk_percent?.toFixed(1) + '%' || '--%';
    if (diskFill) diskFill.style.width = Math.min(systemMetrics.disk_percent || 0, 100) + '%';

    // Uptime
    const uptimeEl = document.getElementById('metricUptime');
    const uptimeFill = document.getElementById('metricUptimeFill');
    if (uptimeEl) uptimeEl.textContent = systemMetrics.uptime || '--';
    if (uptimeFill) uptimeFill.style.width = '100%';
  } else {
    // Fallback: show placeholders if API fails
    const cpuEl = document.getElementById('metricCPU');
    const cpuFill = document.getElementById('metricCPUFill');
    if (cpuEl) cpuEl.textContent = '--%';
    if (cpuFill) cpuFill.style.width = '0%';

    const memEl = document.getElementById('metricMemory');
    const memFill = document.getElementById('metricMemoryFill');
    if (memEl) memEl.textContent = '--';
    if (memFill) memFill.style.width = '0%';

    const diskEl = document.getElementById('metricDisk');
    const diskFill = document.getElementById('metricDiskFill');
    if (diskEl) diskEl.textContent = '--%';
    if (diskFill) diskFill.style.width = '0%';

    const uptimeEl = document.getElementById('metricUptime');
    const uptimeFill = document.getElementById('metricUptimeFill');
    if (uptimeEl) uptimeEl.textContent = '--';
    if (uptimeFill) uptimeFill.style.width = '0%';
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Expose functions to window for HTML onclick handlers
window.loadDashboard = loadDashboard;
window.checkLatestVersion = checkLatestVersion;
window.cleanupDashboard = cleanupDashboard;
window.initDashboard = initDashboard;
window.toggleTheme = toggleTheme;
window.toggleNotifications = toggleNotifications;
window.dismissGettingStarted = dismissGettingStarted;
