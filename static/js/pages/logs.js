/**
 * Logs Page Module
 * Handles system log viewing, filtering, auto-refresh, and export
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { closeModal } from '../core/modal.js';
import { getLogState, updateLogState, resetLogState } from '../core/state.js';

let currentDetailLog = null;
let scrollThrottleFrame = null;
let loadRequestId = 0;

/**
 * Close the modal and clear currentDetailLog reference
 */
function closeLogModal() {
  currentDetailLog = null;
  closeModal();
}

// Store event listener references for cleanup
let scrollHandler = null;
let clickHandler = null;
let keydownHandler = null;
let keyboardShortcutHandler = null;
let statsKeydownHandler = null;

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
  const truncatedHint = document.getElementById('logTruncatedHint');
  
  if (truncatedHint) {
    truncatedHint.style.display = logState.allLogs.length >= 500 ? 'inline' : 'none';
  }

  updateStatsAndCounts();
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
  if (!statusText) return;
  if (logState.autoRefreshInterval) {
    statusText.innerText = 'Live';
    statusText.style.color = 'var(--accent-green)';
  } else {
    statusText.innerText = 'Last updated: ' + new Date().toLocaleTimeString();
    statusText.style.color = 'var(--text-muted)';
  }
}

/**
 * Get filtered logs based on current filter state
 * Returns { logs: LogEntry[], regexError: boolean, errorMessage: string }
 */
function getFilteredLogs() {
  const logState = getLogState();
  const filter = logState.filter;
  const searchRaw = logState.search || '';
  const searchLower = searchRaw.toLowerCase();
  const useRegex = logState.useRegex !== false;
  let searchRegex = null;
  let regexError = false;
  let errorMessage = '';
  
  if (searchRaw && useRegex) {
    try {
      if (searchRaw.length > 200) {
        regexError = true;
        errorMessage = 'Pattern too long (max 200 chars)';
      } else {
        // Check for potentially dangerous regex patterns that cause catastrophic backtracking
        // 1. Adjacent quantifiers: a++, a*+, a+?, a*{2}
        const adjacentQuantifiers = /(\+|\*|\{[0-9]+,?\})\s*(\+|\*|\?|\{)/;
        // 2. Group with quantifier followed by another quantifier: (a+)+, (x*)+
        const groupQuantifierRepeat = /\([^)]*[+*][^)]*\)[+*]/;
        // 3. Nested groups with quantifiers: ((a+)b)+
        const nestedGroupQuantifiers = /\([^)]*\([^)]*[+*][^)]*\)[^)]*\)[+*]/;
        // 4. Alternation with overlap inside quantified group: (a|a)+
        const overlappingAlternation = /\(([^|)]+)\|\1[^)]*\)[+*]/;
        
        if (adjacentQuantifiers.test(searchRaw) || 
            groupQuantifierRepeat.test(searchRaw) || 
            nestedGroupQuantifiers.test(searchRaw) ||
            overlappingAlternation.test(searchRaw)) {
          regexError = true;
          errorMessage = 'Pattern too complex (potential catastrophic backtracking)';
        } else {
          const candidate = new RegExp(searchRaw, 'i');
          // Safety net: test against a probe string to detect slow regexes
          const probeString = 'a'.repeat(50);
          const probeStart = performance.now();
          candidate.test(probeString);
          const probeTime = performance.now() - probeStart;
          if (probeTime > 10) {
            // Regex took >10ms on a 50-char string — likely dangerous on real log lines
            regexError = true;
            errorMessage = 'Pattern too slow (may cause performance issues)';
          } else {
            searchRegex = candidate;
          }
        }
      }
    } catch (e) {
      regexError = true;
      errorMessage = e.message;
    }
  }
  
  const logs = logState.allLogs.filter(l => {
    if (filter !== 'ALL' && l.level !== filter) return false;
    if (searchRaw) {
      if (searchRegex) {
        try {
          return searchRegex.test(l.raw);
        } catch (e) {
          // Fallback to simple string matching if regex execution fails
          return l.raw.toLowerCase().includes(searchLower);
        }
      }
      return l.raw.toLowerCase().includes(searchLower);
    }
    return true;
  });
  
  return { logs, regexError, errorMessage };
}

/**
 * Render logs to the viewer
 * Uses getFilteredLogs() to avoid duplicated filtering logic
 */
function renderLogs() {
  const v = document.getElementById('logViewer');
  if (!v) return;
  
  const searchInput = document.getElementById('logSearch');
  const searchContainer = document.getElementById('logSearchContainer');
  const regexErrorEl = document.getElementById('logRegexError');
  const logCountEl = document.getElementById('logCount');

  const { logs: filtered, regexError, errorMessage } = getFilteredLogs();
  
  if (regexError) {
    updateLogState({ regexError: true });
    if (searchInput) searchInput.classList.add('regex-error');
    if (searchContainer) searchContainer.classList.add('has-error');
    if (regexErrorEl) {
      regexErrorEl.textContent = errorMessage ? 'Invalid regex: ' + errorMessage : 'Invalid pattern';
      regexErrorEl.classList.add('visible');
    }
  } else {
    updateLogState({ regexError: false });
    if (searchInput) searchInput.classList.remove('regex-error');
    if (searchContainer) searchContainer.classList.remove('has-error');
    if (regexErrorEl) regexErrorEl.classList.remove('visible');
  }

  if (logCountEl) {
    const displayCount = filtered.length > 500 
      ? `Showing 500 of ${filtered.length}` 
      : `${filtered.length} lines`;
    logCountEl.innerText = displayCount;
  }

  if (filtered.length === 0) {
    v.innerHTML = `<div class="empty-logs">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <p>No logs found matching filters</p>
      <button class="btn btn-secondary btn-sm" onclick="window.logsModule.clearLogFilters()">Clear filters</button>
    </div>`;
    updateStatsAndCounts();
    return;
  }

  const linesToRender = filtered.slice(-500);
  
  // Check if we can do an incremental append instead of full rebuild.
  // This avoids destroying the entire DOM subtree during auto-refresh.
  const logState = getLogState();
  const prevRendered = logState.renderedLogs || [];
  const canAppend = prevRendered.length > 0 && 
    linesToRender.length > prevRendered.length &&
    linesToRender.length - prevRendered.length <= 50 &&
    v.children.length > 0 && 
    !v.querySelector('.empty-logs') &&
    prevRendered[0].raw === linesToRender[linesToRender.length - prevRendered.length]?.raw;
  
  updateLogState({ renderedLogs: linesToRender });

  if (canAppend) {
    // Incremental append — only add new entries to the DOM
    const newEntries = linesToRender.slice(prevRendered.length);
    const startIdx = prevRendered.length;
    const fragment = document.createDocumentFragment();
    
    newEntries.forEach((l, i) => {
      const idx = startIdx + i;
      const lvlClass = l.level.toLowerCase();
      const displayTime = l.time ? (l.time.length > 15 ? l.time.substring(11, 19) : l.time) : '--:--:--';
      const isLongMessage = l.message && l.message.length > 200;
      
      const div = document.createElement('div');
      div.className = `log-entry ${lvlClass}${isLongMessage ? ' long-message' : ''}`;
      div.dataset.logIdx = idx;
      div.tabIndex = 0;
      div.setAttribute('role', 'listitem');
      div.setAttribute('aria-label', `${l.level} log at ${escapeHtml(l.time || 'unknown time')}`);
      div.innerHTML = `
        <div class="log-time" title="${escapeHtml(l.time)}">${escapeHtml(displayTime)}</div>
        <div class="log-lvl ${lvlClass}">${l.level}</div>
        <div class="log-msg">${escapeHtml(l.message)}</div>
        <div class="log-actions">
          <button class="log-action-btn copy-btn" title="Copy log" aria-label="Copy log entry">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="log-action-btn details-btn" title="View details" aria-label="View log details">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
        </div>`;
      fragment.appendChild(div);
    });
    
    // Remove excess entries from the top if over 500
    const excess = v.children.length + newEntries.length - 500;
    for (let i = 0; i < excess; i++) {
      v.removeChild(v.firstChild);
    }
    
    const wasAtBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 50;
    v.appendChild(fragment);
    
    // Re-index data-log-idx attributes after removal
    if (excess > 0) {
      Array.from(v.children).forEach((child, i) => {
        child.dataset.logIdx = i;
      });
    }
    
    if (wasAtBottom) {
      v.scrollTop = v.scrollHeight;
      updateLogState({ isAtBottom: true });
    }
  } else {
    // Full rebuild — filter changed, search changed, or first load
    const html = linesToRender.map((l, idx) => {
      const lvlClass = l.level.toLowerCase();
      const displayTime = l.time ? (l.time.length > 15 ? l.time.substring(11, 19) : l.time) : '--:--:--';
      const isLongMessage = l.message && l.message.length > 200;

      return `
       <div class="log-entry ${lvlClass}${isLongMessage ? ' long-message' : ''}" data-log-idx="${idx}" tabindex="0" role="listitem" aria-label="${l.level} log at ${escapeHtml(l.time || 'unknown time')}">
         <div class="log-time" title="${escapeHtml(l.time)}">${escapeHtml(displayTime)}</div>
         <div class="log-lvl ${lvlClass}">${l.level}</div>
         <div class="log-msg">${escapeHtml(l.message)}</div>
         <div class="log-actions">
           <button class="log-action-btn copy-btn" title="Copy log" aria-label="Copy log entry">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
           </button>
           <button class="log-action-btn details-btn" title="View details" aria-label="View log details">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
           </button>
         </div>
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

  // Update stats and counts
  updateStatsAndCounts();
}

/**
* Update statistics bar and filter count badges
*/
function updateStatsAndCounts() {
const logState = getLogState();
const allLogs = logState.allLogs || [];

// Count logs by level
const counts = {
ALL: allLogs.length,
DEBUG: 0,
INFO: 0,
WARN: 0,
ERROR: 0
};

allLogs.forEach(l => {
const level = l.level;
if (counts.hasOwnProperty(level)) {
counts[level]++;
}
});

// Update filter count badges
Object.keys(counts).forEach(level => {
const countEl = document.getElementById('count-' + level);
if (countEl) {
const prevCount = parseInt(countEl.textContent) || 0;
const newCount = counts[level];
countEl.textContent = newCount;

// Add animation if count changed
if (prevCount !== newCount) {
countEl.classList.add('updated');
setTimeout(() => countEl.classList.remove('updated'), 300);
}
}
});

// Update stats bar
const totalEl = document.getElementById('statTotal');
const errorsEl = document.getElementById('statErrors');
const warningsEl = document.getElementById('statWarnings');
const infoEl = document.getElementById('statInfo');
const debugEl = document.getElementById('statDebug');

if (totalEl) totalEl.textContent = counts.ALL.toLocaleString();
if (errorsEl) errorsEl.textContent = counts.ERROR.toLocaleString();
if (warningsEl) warningsEl.textContent = counts.WARN.toLocaleString();
if (infoEl) infoEl.textContent = counts.INFO.toLocaleString();
if (debugEl) debugEl.textContent = counts.DEBUG.toLocaleString();

// Update progress bars
const total = Math.max(counts.ALL, 1); // Prevent division by zero
const progressTotal = document.getElementById('progressTotal');
const progressErrors = document.getElementById('progressErrors');
const progressWarnings = document.getElementById('progressWarnings');
const progressInfo = document.getElementById('progressInfo');
const progressDebug = document.getElementById('progressDebug');

if (progressTotal) progressTotal.style.width = '100%';
if (progressErrors) progressErrors.style.width = ((counts.ERROR / total) * 100) + '%';
if (progressWarnings) progressWarnings.style.width = ((counts.WARN / total) * 100) + '%';
if (progressInfo) progressInfo.style.width = ((counts.INFO / total) * 100) + '%';
if (progressDebug) progressDebug.style.width = ((counts.DEBUG / total) * 100) + '%';

// Update clear filters button visibility
const clearBtn = document.getElementById('clearFilters');
if (clearBtn) {
const hasActiveFilter = logState.filter !== 'ALL' || (logState.search && logState.search.trim());
clearBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
}
}

/**
* Announce message to screen readers
* @param {string} message - Message to announce
*/
function announceToScreenReader(message) {
const announcement = document.createElement('div');
announcement.setAttribute('role', 'status');
announcement.setAttribute('aria-live', 'polite');
announcement.setAttribute('aria-atomic', 'true');
announcement.className = 'sr-only';
announcement.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;';
announcement.textContent = message;
document.body.appendChild(announcement);
setTimeout(() => announcement.remove(), 1000);
}

/**
* Clear log filters
*/
export function clearLogFilters() {
// Clear search input
const searchInput = document.getElementById('logSearch');
if (searchInput) {
searchInput.value = '';
searchInput.focus();
}

// Update search clear button
updateSearchClearButton();

// Reset filter state
updateLogState({ search: '', filter: 'ALL' });

// Update all filter buttons
const buttons = document.querySelectorAll('.log-filter-btn[id^="filter-"]');
buttons.forEach(b => {
const isActive = b.id === 'filter-ALL';
b.classList.toggle('active', isActive);
b.setAttribute('aria-pressed', isActive.toString());
});

// Hide clear filters button
const clearBtn = document.getElementById('clearFilters');
if (clearBtn) {
clearBtn.style.display = 'none';
}

renderLogs();

// Announce to screen readers
announceToScreenReader('Filters cleared. Showing all logs.');
}

/**
 * Show log detail in modal
 */
export function showLogDetail(idx) {
  const logState = getLogState();
  const renderedLogs = logState.renderedLogs || [];
  const log = renderedLogs[idx];
  if (!log) return;
  
  const lvlClass = log.level.toLowerCase();
  
  currentDetailLog = log;
  
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
          <button class="btn btn-secondary btn-sm" data-action="copy-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Full Log
          </button>
          <button class="btn btn-secondary btn-sm" data-action="copy-message">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Message Only
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.logsModule.closeLogModal()">Close</button>
  `;
  
  const modalContent = document.getElementById('modalContent');
  modalContent.querySelector('[data-action="copy-full"]')?.addEventListener('click', () => {
    copyLogToClipboard(log.raw);
  });
  modalContent.querySelector('[data-action="copy-message"]')?.addEventListener('click', () => {
    copyLogToClipboard(log.message);
  });
  
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
* Updates UI state and re-renders logs
*/
export function setLogFilter(filter) {
updateLogState({ filter });

// Update filter button states
const buttons = document.querySelectorAll('.log-filter-btn[id^="filter-"]');
buttons.forEach(b => {
const isActive = b.id === 'filter-' + filter;
b.classList.toggle('active', isActive);
b.setAttribute('aria-pressed', isActive.toString());
});

// Update clear filters button visibility
const clearBtn = document.getElementById('clearFilters');
if (clearBtn) {
if (filter !== 'ALL') {
clearBtn.style.display = 'inline-flex';
} else {
// Also check if search has value
const searchInput = document.getElementById('logSearch');
if (!searchInput || !searchInput.value) {
clearBtn.style.display = 'none';
}
}
}

renderLogs();
}

/**
* Filter logs (debounced)
* Uses 300ms delay for better performance
*/
export function filterLogs() {
const logState = getLogState();
if (logState.searchDebounceTimer) {
clearTimeout(logState.searchDebounceTimer);
}
const timer = setTimeout(() => {
updateLogState({ search: document.getElementById('logSearch').value });
updateSearchClearButton();
renderLogs();
}, 300);
updateLogState({ searchDebounceTimer: timer });
}

/**
* Debounced filter logs wrapper for HTML oninput handlers
* Exported for use in onclick/oninput attributes
*/
export function debouncedFilterLogs() {
filterLogs();
}

/**
* Clear log search input
*/
export function clearLogSearch() {
const searchInput = document.getElementById('logSearch');
if (searchInput) {
searchInput.value = '';
searchInput.focus();
updateLogState({ search: '' });
updateSearchClearButton();
renderLogs();
}
}

/**
* Update search clear button visibility
*/
function updateSearchClearButton() {
const searchInput = document.getElementById('logSearch');
const searchContainer = document.getElementById('logSearchContainer');
if (searchInput && searchContainer) {
if (searchInput.value) {
searchContainer.classList.add('has-value');
} else {
searchContainer.classList.remove('has-value');
}
}
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
    // If no logs loaded yet, do a full load first; otherwise start polling for new entries
    if (logState.allLogs.length === 0 || logState.latestTimestamp === 0) {
      loadLogs(false).then(() => {
        // Re-read state after load to get updated latestTimestamp
        const interval = setInterval(() => loadLogs(true), 2000);
        updateLogState({ autoRefreshInterval: interval });
      });
    } else {
      // Already have logs with a valid timestamp — start incremental polling immediately
      const interval = setInterval(() => loadLogs(true), 2000);
      updateLogState({ autoRefreshInterval: interval });
    }
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
 * Cleanup all event listeners and resources
 * Call this when leaving the logs page to prevent memory leaks
 */
export function cleanupLogs() {
  // Stop auto-refresh and clear timers
  stopLogAutoRefresh();
  
  // Cancel any pending scroll throttle frame
  if (scrollThrottleFrame) {
    cancelAnimationFrame(scrollThrottleFrame);
    scrollThrottleFrame = null;
  }
  
  // Remove scroll event listener
  const v = document.getElementById('logViewer');
  if (v && scrollHandler) {
    v.removeEventListener('scroll', scrollHandler);
  }
  
  // Remove event delegation listeners
  if (v && clickHandler) {
    v.removeEventListener('click', clickHandler);
  }
  if (v && keydownHandler) {
    v.removeEventListener('keydown', keydownHandler);
  }
  
  // Remove keyboard shortcut listener
  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
  }
  const logStatsBar = document.getElementById('logStatsBar');
  if (logStatsBar && statsKeydownHandler) {
    logStatsBar.removeEventListener('keydown', statsKeydownHandler);
  }
  
  // Clear handler references
  scrollHandler = null;
  clickHandler = null;
  keydownHandler = null;
  keyboardShortcutHandler = null;
  statsKeydownHandler = null;
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
 * Setup log scroll tracking with throttling via requestAnimationFrame
 */
export function setupLogScrollTracking() {
  const v = document.getElementById('logViewer');
  if (!v) return;
  
  // Remove existing handler if present to prevent duplicates
  if (scrollHandler) {
    v.removeEventListener('scroll', scrollHandler);
  }
  
  scrollHandler = () => {
    if (scrollThrottleFrame) return;
    
    scrollThrottleFrame = requestAnimationFrame(() => {
      scrollThrottleFrame = null;
      
      const logState = getLogState();
      const isAtBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 50;
      
      if (logState.isAtBottom !== isAtBottom) {
        updateLogState({ isAtBottom });
      }
      
      const btn = document.getElementById('scrollBottomBtn');
      if (btn) {
        if (!isAtBottom && logState.allLogs.length > 10) {
          btn.classList.add('visible');
        } else {
          btn.classList.remove('visible');
          if (logState.newLogsWhileScrolled !== 0) {
            updateLogState({ newLogsWhileScrolled: 0 });
          }
          const badge = document.getElementById('newLogsBadge');
          if (badge) badge.style.display = 'none';
        }
      }
    });
  };
  
  v.addEventListener('scroll', scrollHandler);
}

/**
 * Setup event delegation for log entries
 * Handles copy and details buttons without inline handlers
 */
export function setupLogEventDelegation() {
  const v = document.getElementById('logViewer');
  if (!v) return;
  
  // Remove existing handlers if present to prevent duplicates
  if (clickHandler) {
    v.removeEventListener('click', clickHandler);
  }
  if (keydownHandler) {
    v.removeEventListener('keydown', keydownHandler);
  }
  
  clickHandler = (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    const detailsBtn = e.target.closest('.details-btn');
    const logEntry = e.target.closest('.log-entry');
    
    if (copyBtn && logEntry) {
      e.stopPropagation();
      copyLogEntry(logEntry);
      return;
    }
    
    if (detailsBtn && logEntry) {
      e.stopPropagation();
      const idx = parseInt(logEntry.dataset.logIdx, 10);
      if (!isNaN(idx)) {
        showLogDetail(idx);
      }
      return;
    }
  };
  
  keydownHandler = (e) => {
    const logEntry = e.target.closest('.log-entry');
    if (!logEntry) return;
    
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const idx = parseInt(logEntry.dataset.logIdx, 10);
      if (!isNaN(idx)) {
        showLogDetail(idx);
      }
    } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      copyLogEntry(logEntry);
    }
  };
  
  v.addEventListener('click', clickHandler);
  v.addEventListener('keydown', keydownHandler);
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
  
  try {
    a.href = url;
    a.download = `cliproxy-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Logs exported successfully', 'success');
  } catch (e) {
    toast('Failed to export logs: ' + e.message, 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Show errors only and scroll to latest
 * Note: Despite the name, this filters to show errors rather than navigating to individual errors
 */
export function jumpToNextError() {
  const logState = getLogState();
  if (logState.errorCount === 0) {
    toast('No errors found', 'info');
    return;
  }
  setLogFilter('ERROR');
  scrollLogsToBottom();
  toast(`Showing ${logState.errorCount} error${logState.errorCount > 1 ? 's' : ''}`, 'info');
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
      <button class="btn btn-secondary" onclick="window.logsModule.closeLogModal()">Cancel</button>
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
      // Reset data-loaded so first load auto-scrolls to bottom
      const v = document.getElementById('logViewer');
      if (v) v.removeAttribute('data-loaded');
      loadLogs();
    })
    .catch(e => {
      toast('Failed to clear logs: ' + e.message, 'error');
    });
}

/**
 * Load logs from server
 * Uses requestId to prevent race conditions from overlapping requests
 */
export async function loadLogs(isAuto = false) {
  const thisRequestId = ++loadRequestId;
  const logState = getLogState();
  const v = document.getElementById('logViewer');
  const btn = document.getElementById('btnRefreshLogs');
  
  if (!v) return;
  
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
    
    // Check if this request is still the latest one before processing
    if (thisRequestId !== loadRequestId) {
      return;
    }
    
    const lines = d.lines || [];
    const newLogs = lines
      .filter(l => !l.includes('/v0/management/logs'))
      .map(parseLogLine);

    // Re-check after processing to ensure we're still the latest request
    if (thisRequestId !== loadRequestId) {
      return;
    }

    if (isAuto && logState.latestTimestamp > 0 && newLogs.length === 0) {
      // No new logs — skip the expensive render cycle
      if (d['latest-timestamp']) {
        updateLogState({ latestTimestamp: d['latest-timestamp'] });
      }
      updateLogStatusUI();
      return;
    }

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
    let errorCount = 0, warnCount = 0, infoCount = 0, debugCount = 0;
    for (const l of currentState.allLogs) {
      if (l.level === 'ERROR') errorCount++;
      else if (l.level === 'WARN') warnCount++;
      else if (l.level === 'INFO') infoCount++;
      else if (l.level === 'DEBUG') debugCount++;
    }
    
    // Final check before updating UI state
    if (thisRequestId !== loadRequestId) {
      return;
    }
    
    updateLogState({ errorCount, warnCount, infoCount, debugCount });

    renderLogs();
    updateLogStatusUI();
    updateLogStats();
    
    if (!isAuto) {
      loadLogFileInfo();
    }

  } catch (e) {
    if (thisRequestId === loadRequestId && !isAuto) {
      toast('Failed to load logs: ' + e.message, 'error');
    }
  } finally {
    // Only remove loading state if this is still the latest request
    if (thisRequestId === loadRequestId && btn) {
      btn.classList.remove('loading');
    }
  }
}

/**
 * Format bytes to human readable size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Load and display log file info (path and size)
 */
async function loadLogFileInfo() {
  const infoEl = document.getElementById('logFileInfo');
  if (!infoEl) return;

  try {
    const data = await api('GET', '/logs/info');
    
    if (data.enabled && data.path) {
      const size = formatFileSize(data.size || 0);
      const fileCount = data.file_count || 1;
      const fileLabel = fileCount > 1 ? `${fileCount} files` : '1 file';
      infoEl.textContent = `📁 ${data.path} (${size}, ${fileLabel})`;
      infoEl.title = `Log file: ${data.path}\nTotal size: ${size}\nFiles: ${fileLabel}`;
      infoEl.style.display = 'inline';
    } else {
      infoEl.textContent = '📁 File logging disabled';
      infoEl.style.display = 'inline';
    }
  } catch (e) {
    infoEl.style.display = 'none';
  }
}

/**
 * Initialize log keyboard shortcuts
 */
export function initLogKeyboardShortcuts() {
  const logStatsBar = document.getElementById('logStatsBar');
  if (logStatsBar && statsKeydownHandler) {
    logStatsBar.removeEventListener('keydown', statsKeydownHandler);
  }

  statsKeydownHandler = (e) => {
    const statItem = e.target.closest('.log-stat-item.clickable');
    if (!statItem) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      statItem.click();
    }
  };

  if (logStatsBar) {
    logStatsBar.addEventListener('keydown', statsKeydownHandler);
  }

  // Remove existing handler if present to prevent duplicates
  if (keyboardShortcutHandler) {
    document.removeEventListener('keydown', keyboardShortcutHandler);
  }
  
  keyboardShortcutHandler = (e) => {
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
  };
  
  document.addEventListener('keydown', keyboardShortcutHandler);
}

// Expose module functions globally for onclick handlers
window.logsModule = {
loadLogs,
filterLogs,
debouncedFilterLogs,
setLogFilter,
clearLogs,
clearLogSearch,
clearLogFilters,
toggleAutoRefresh,
stopLogAutoRefresh,
cleanupLogs,
scrollLogsToBottom,
jumpToNextError,
exportLogs,
showLogDetail,
copyLogToClipboard,
copyLogEntry,
closeModal,
closeLogModal,
setupLogEventDelegation
};

// Also expose directly for HTML onclick handlers
window.loadLogs = loadLogs;
window.filterLogs = filterLogs;
window.debouncedFilterLogs = debouncedFilterLogs;
window.setLogFilter = setLogFilter;
window.clearLogs = clearLogs;
window.clearLogSearch = clearLogSearch;
window.clearLogFilters = clearLogFilters;
window.toggleAutoRefresh = toggleAutoRefresh;
window.stopLogAutoRefresh = stopLogAutoRefresh;
window.cleanupLogs = cleanupLogs;
window.scrollLogsToBottom = scrollLogsToBottom;
window.jumpToNextError = jumpToNextError;
window.exportLogs = exportLogs;
window.setupLogEventDelegation = setupLogEventDelegation;
