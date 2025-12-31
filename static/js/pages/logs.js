/**
 * Logs Page Module
 * Handles system log viewing, filtering, auto-refresh, and export
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { closeModal } from '../core/modal.js';
import { getLogState, updateLogState, resetLogState } from '../core/state.js';

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parse a log line into structured data
 */
function parseLogLine(line) {
  let level = 'INFO';
  let time = '';
  let message = line;

  const bracketMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*\[(\w+)\]\s*(?:\[[^\]]+\]\s*)?(.*)$/);

  if (bracketMatch) {
    time = bracketMatch[1];
    const levelStr = bracketMatch[2].toLowerCase();
    if (levelStr === 'error' || levelStr === 'erro') level = 'ERROR';
    else if (levelStr === 'warn' || levelStr === 'warning') level = 'WARN';
    else if (levelStr === 'debug' || levelStr === 'debu') level = 'DEBUG';
    else if (levelStr === 'info') level = 'INFO';
    message = bracketMatch[3] || '';
  } else {
    if (line.includes('level=error') || line.includes('ERROR') || line.includes('[ERRO')) level = 'ERROR';
    else if (line.includes('level=warn') || line.includes('WARN') || line.includes('[WARN')) level = 'WARN';
    else if (line.includes('level=debug') || line.includes('DEBUG') || line.includes('[DEBU')) level = 'DEBUG';

    const timeMatch = line.match(/time="([^"]+)"/) ||
      line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/) ||
      line.match(/(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);

    if (timeMatch) {
      time = timeMatch[1] || timeMatch[0];
    }
  }

  return { raw: line, time, level, message };
}

/**
 * Update log statistics display
 */
function updateLogStats() {
  const logState = getLogState();
  const totalEl = document.getElementById('statTotal');
  const errorsEl = document.getElementById('statErrors');
  const warningsEl = document.getElementById('statWarnings');
  const infoEl = document.getElementById('statInfo');
  const debugEl = document.getElementById('statDebug');
  const truncatedHint = document.getElementById('logTruncatedHint');
  
  if (totalEl) totalEl.textContent = logState.allLogs.length;
  if (errorsEl) errorsEl.textContent = logState.errorCount;
  if (warningsEl) warningsEl.textContent = logState.warnCount;
  if (infoEl) infoEl.textContent = logState.infoCount;
  if (debugEl) debugEl.textContent = logState.debugCount;
  
  if (truncatedHint) {
    truncatedHint.style.display = logState.allLogs.length >= 500 ? 'inline' : 'none';
  }
}

/**
 * Update new logs badge
 */
function updateNewLogsBadge() {
  const logState = getLogState();
  const badge = document.getElementById('newLogsBadge');
  const btn = document.getElementById('scrollBottomBtn');
  
  if (badge && btn) {
    if (logState.newLogsWhileScrolled > 0) {
      badge.textContent = logState.newLogsWhileScrolled > 99 ? '99+' : logState.newLogsWhileScrolled;
      badge.style.display = 'block';
      btn.classList.add('visible');
    } else {
      badge.style.display = 'none';
    }
  }
}

/**
 * Update log status UI
 */
function updateLogStatusUI() {
  const logState = getLogState();
  const statusText = document.getElementById('liveStatusText');
  if (logState.autoRefreshInterval) {
    statusText.innerText = 'Live';
    statusText.style.color = 'var(--accent-green)';
  } else {
    statusText.innerText = 'Last updated: ' + new Date().toLocaleTimeString();
    statusText.style.color = 'var(--text-muted)';
  }

  const errorBtn = document.getElementById('filter-ERROR');
  if (errorBtn) {
    if (logState.errorCount > 0) {
      errorBtn.innerHTML = `ERROR <span class="log-count-badge error">${logState.errorCount}</span>`;
    } else {
      errorBtn.textContent = 'ERROR';
    }
  }

  const warnBtn = document.getElementById('filter-WARN');
  if (warnBtn) {
    if (logState.warnCount > 0) {
      warnBtn.innerHTML = `WARN <span class="log-count-badge warn">${logState.warnCount}</span>`;
    } else {
      warnBtn.textContent = 'WARN';
    }
  }
}

/**
 * Get filtered logs based on current filter state
 */
function getFilteredLogs() {
  const logState = getLogState();
  const filter = logState.filter;
  const search = logState.search.toLowerCase();
  let searchRegex = null;
  
  try {
    if (search) searchRegex = new RegExp(search, 'i');
  } catch (e) { }
  
  return logState.allLogs.filter(l => {
    if (filter !== 'ALL' && l.level !== filter) return false;
    if (search) {
      if (searchRegex) return searchRegex.test(l.raw);
      return l.raw.toLowerCase().includes(search);
    }
    return true;
  });
}

/**
 * Render logs to the viewer
 */
function renderLogs() {
  const logState = getLogState();
  const v = document.getElementById('logViewer');
  const filter = logState.filter;
  const search = logState.search.toLowerCase();
  let searchRegex = null;
  
  const searchInput = document.getElementById('logSearch');
  const searchContainer = document.getElementById('logSearchContainer');
  const regexError = document.getElementById('logRegexError');

  try {
    if (search) {
      searchRegex = new RegExp(search, 'i');
      updateLogState({ regexError: false });
      if (searchInput) searchInput.classList.remove('regex-error');
      if (searchContainer) searchContainer.classList.remove('has-error');
      if (regexError) regexError.classList.remove('visible');
    }
  } catch (e) {
    updateLogState({ regexError: true });
    if (searchInput) searchInput.classList.add('regex-error');
    if (searchContainer) searchContainer.classList.add('has-error');
    if (regexError) {
      regexError.textContent = 'Invalid regex: ' + e.message;
      regexError.classList.add('visible');
    }
    searchRegex = null;
  }

  const filtered = logState.allLogs.filter(l => {
    if (filter !== 'ALL' && l.level !== filter) return false;
    if (search) {
      if (searchRegex) return searchRegex.test(l.raw);
      return l.raw.toLowerCase().includes(search);
    }
    return true;
  });

  document.getElementById('logCount').innerText = `${filtered.length} lines`;

  if (filtered.length === 0) {
    v.innerHTML = `<div class="empty-logs">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <p>No logs found matching filters</p>
      <button class="btn btn-secondary btn-sm" onclick="window.logsModule.clearLogFilters()">Clear filters</button>
    </div>`;
    return;
  }

  const linesToRender = filtered.slice(-500);

  const html = linesToRender.map((l, idx) => {
    let lvlClass = l.level.toLowerCase();
    let displayTime = l.time ? (l.time.length > 15 ? l.time.substring(11, 19) : l.time) : '--:--:--';
    const isLongMessage = l.message && l.message.length > 200;

    return `
       <div class="log-entry ${lvlClass}" data-log-idx="${idx}" onclick="window.logsModule.copyLogEntry(this)" ondblclick="window.logsModule.showLogDetail(${idx})" title="Click to copy • Double-click for details">
         <div class="log-time" title="${escapeHtml(l.time)}">${escapeHtml(displayTime)}</div>
         <div class="log-lvl ${lvlClass}">${l.level}</div>
         <div class="log-msg${isLongMessage ? '' : ''}">${escapeHtml(l.message)}</div>
       </div>
     `;
  }).join('');

  const wasAtBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 50;
  v.innerHTML = html;

  if (wasAtBottom || !v.getAttribute('data-loaded')) {
    v.scrollTop = v.scrollHeight;
    v.setAttribute('data-loaded', 'true');
    updateLogState({ isAtBottom: true });
  }
}

/**
 * Clear log filters
 */
export function clearLogFilters() {
  const searchInput = document.getElementById('logSearch');
  if (searchInput) searchInput.value = '';
  updateLogState({ search: '', filter: 'ALL' });
  document.querySelectorAll('.log-filter-btn').forEach(b => {
    b.classList.toggle('active', b.id === 'filter-ALL');
  });
  renderLogs();
}

/**
 * Show log detail in modal
 */
export function showLogDetail(idx) {
  const linesToRender = getFilteredLogs().slice(-500);
  const log = linesToRender[idx];
  if (!log) return;
  
  const lvlClass = log.level.toLowerCase();
  
  document.getElementById('modalTitle').textContent = 'Log Entry Details';
  document.getElementById('modalContent').innerHTML = `
    <div class="log-detail-content">
      <div class="log-detail-header">
        <span class="log-detail-level ${lvlClass}">${log.level}</span>
        <span class="log-detail-time">${escapeHtml(log.time || 'N/A')}</span>
      </div>
      <div class="log-detail-body">
        <div class="log-detail-message">${escapeHtml(log.raw)}</div>
        <div class="log-detail-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.logsModule.copyLogToClipboard(\`${escapeHtml(log.raw).replace(/`/g, '\\`')}\`)">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Full Log
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.logsModule.copyLogToClipboard(\`${escapeHtml(log.message).replace(/`/g, '\\`')}\`)">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Message Only
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.logsModule.closeModal()">Close</button>
  `;
  document.getElementById('modal').classList.add('active');
}

/**
 * Copy log text to clipboard
 */
export function copyLogToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

/**
 * Copy log entry from element
 */
export function copyLogEntry(element) {
  const timeEl = element.querySelector('.log-time');
  const levelEl = element.querySelector('.log-lvl');
  const msgEl = element.querySelector('.log-msg');

  const logText = `[${timeEl?.getAttribute('title') || timeEl?.textContent || ''}] [${levelEl?.textContent || ''}] ${msgEl?.textContent || ''}`;

  navigator.clipboard.writeText(logText).then(() => {
    element.classList.add('copied');
    setTimeout(() => {
      element.classList.remove('copied');
    }, 600);
  }).catch(() => {
    toast('Failed to copy log entry', 'error');
  });
}

/**
 * Set log filter
 */
export function setLogFilter(filter) {
  updateLogState({ filter });
  document.querySelectorAll('.log-filter-btn').forEach(b => {
    b.classList.toggle('active', b.id === 'filter-' + filter);
  });
  renderLogs();
}

/**
 * Filter logs (debounced)
 */
export function filterLogs() {
  const logState = getLogState();
  if (logState.searchDebounceTimer) {
    clearTimeout(logState.searchDebounceTimer);
  }
  const timer = setTimeout(() => {
    updateLogState({ search: document.getElementById('logSearch').value });
    renderLogs();
  }, 150);
  updateLogState({ searchDebounceTimer: timer });
}

/**
 * Toggle auto-refresh
 */
export function toggleAutoRefresh(enabled) {
  const logState = getLogState();
  if (logState.autoRefreshInterval) clearInterval(logState.autoRefreshInterval);
  updateLogState({ autoRefreshInterval: null });

  const dot = document.getElementById('liveStatusDot');
  if (dot) dot.classList.toggle('active', enabled);

  if (enabled) {
    loadLogs(true);
    const interval = setInterval(() => loadLogs(true), 2000);
    updateLogState({ autoRefreshInterval: interval });
  } else {
    updateLogStatusUI();
  }
}

/**
 * Stop log auto-refresh
 */
export function stopLogAutoRefresh() {
  const logState = getLogState();
  if (logState.autoRefreshInterval) {
    clearInterval(logState.autoRefreshInterval);
    updateLogState({ autoRefreshInterval: null });
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) toggle.checked = false;
    const dot = document.getElementById('liveStatusDot');
    if (dot) dot.classList.remove('active');
  }
  if (logState.searchDebounceTimer) {
    clearTimeout(logState.searchDebounceTimer);
    updateLogState({ searchDebounceTimer: null });
  }
}

/**
 * Scroll logs to bottom
 */
export function scrollLogsToBottom() {
  const v = document.getElementById('logViewer');
  if (v) {
    v.scrollTop = v.scrollHeight;
    updateLogState({ isAtBottom: true, newLogsWhileScrolled: 0 });
    
    const btn = document.getElementById('scrollBottomBtn');
    const badge = document.getElementById('newLogsBadge');
    if (btn) btn.classList.remove('visible');
    if (badge) badge.style.display = 'none';
  }
}

/**
 * Setup log scroll tracking
 */
export function setupLogScrollTracking() {
  const v = document.getElementById('logViewer');
  if (v) {
    v.addEventListener('scroll', () => {
      const logState = getLogState();
      const isAtBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 50;
      updateLogState({ isAtBottom });
      
      const btn = document.getElementById('scrollBottomBtn');
      if (btn) {
        if (!isAtBottom && logState.allLogs.length > 10) {
          btn.classList.add('visible');
        } else {
          btn.classList.remove('visible');
          updateLogState({ newLogsWhileScrolled: 0 });
          const badge = document.getElementById('newLogsBadge');
          if (badge) badge.style.display = 'none';
        }
      }
    });
  }
}

/**
 * Export logs to file
 */
export function exportLogs() {
  const logState = getLogState();
  if (logState.allLogs.length === 0) {
    toast('No logs to export', 'info');
    return;
  }

  const logText = logState.allLogs.map(l => `[${l.time || ''}] [${l.level}] ${l.message}`).join('\n');
  const blob = new Blob([logText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cliproxy-logs-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Logs exported successfully', 'success');
}

/**
 * Jump to next error
 */
export function jumpToNextError() {
  const logState = getLogState();
  const errorLogs = logState.allLogs.filter(l => l.level === 'ERROR');
  if (errorLogs.length === 0) {
    toast('No errors found', 'info');
    return;
  }
  setLogFilter('ERROR');
  scrollLogsToBottom();
}

/**
 * Clear logs
 */
export function clearLogs(confirmed = false) {
  if (!confirmed) {
    document.getElementById('modalTitle').textContent = 'Clear System Logs';
    document.getElementById('modalContent').innerHTML = `
      <div style="text-align:center; padding: 24px 0;">
        <div style="width:64px; height:64px; background:rgba(248, 113, 113, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </div>
        <h4 style="margin-bottom:8px; font-size:18px;">Clear all logs?</h4>
        <p style="color:var(--text-secondary); font-size:14px; max-width:300px; margin:0 auto;">This action will permanently delete the current log history. This cannot be undone.</p>
      </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
      <button class="btn btn-secondary" onclick="window.logsModule.closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="window.logsModule.clearLogs(true)">Yes, Clear All</button>
    `;
    document.getElementById('modal').classList.add('active');
    return;
  }

  closeModal();
  api('DELETE', '/logs')
    .then(() => {
      toast('Logs cleared successfully', 'success');
      resetLogState();
      loadLogs();
    })
    .catch(e => {
      toast('Failed to clear logs: ' + e.message, 'error');
    });
}

/**
 * Load logs from server
 */
export async function loadLogs(isAuto = false) {
  const logState = getLogState();
  const v = document.getElementById('logViewer');
  const btn = document.getElementById('btnRefreshLogs');
  
  if (!isAuto && btn) {
    btn.classList.add('loading');
  }
  
  if (!isAuto && (!logState.allLogs.length)) {
    v.innerHTML = '<div class="empty-logs"><div class="spinner" style="width:32px;height:32px;border:3px solid var(--border-color);border-top-color:var(--accent-cyan);border-radius:50%;animation:spin 1s linear infinite;"></div><p>Loading logs...</p></div>';
  }

  try {
    let url = '/logs?limit=500';
    if (isAuto && logState.latestTimestamp > 0) {
      url += '&after=' + logState.latestTimestamp;
    }

    const d = await api('GET', url);
    const lines = d.lines || [];
    const newLogs = lines
      .filter(l => !l.includes('/v0/management/logs'))
      .map(parseLogLine);

    if (isAuto && logState.latestTimestamp > 0 && newLogs.length > 0) {
      const allLogs = [...logState.allLogs, ...newLogs].slice(-1000);
      updateLogState({ allLogs });
      
      if (!logState.isAtBottom) {
        updateLogState({ newLogsWhileScrolled: logState.newLogsWhileScrolled + newLogs.length });
        updateNewLogsBadge();
      }
    } else {
      updateLogState({ allLogs: newLogs });
    }

    if (d['latest-timestamp']) {
      updateLogState({ latestTimestamp: d['latest-timestamp'] });
    }

    const currentState = getLogState();
    updateLogState({
      errorCount: currentState.allLogs.filter(l => l.level === 'ERROR').length,
      warnCount: currentState.allLogs.filter(l => l.level === 'WARN').length,
      infoCount: currentState.allLogs.filter(l => l.level === 'INFO').length,
      debugCount: currentState.allLogs.filter(l => l.level === 'DEBUG').length
    });

    renderLogs();
    updateLogStatusUI();
    updateLogStats();

  } catch (e) {
    if (!isAuto) toast('Failed to load logs: ' + e.message, 'error');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

/**
 * Initialize log keyboard shortcuts
 */
export function initLogKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const logsPage = document.getElementById('page-logs');
    if (!logsPage || !logsPage.classList.contains('active')) return;

    if (e.key === 'Escape') {
      const searchInput = document.getElementById('logSearch');
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        filterLogs();
      }
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
      e.preventDefault();
      scrollLogsToBottom();
    }
  });
}

// Expose module functions globally for onclick handlers
window.logsModule = {
  loadLogs,
  filterLogs,
  setLogFilter,
  clearLogs,
  clearLogFilters,
  toggleAutoRefresh,
  stopLogAutoRefresh,
  scrollLogsToBottom,
  jumpToNextError,
  exportLogs,
  showLogDetail,
  copyLogToClipboard,
  copyLogEntry,
  closeModal
};
