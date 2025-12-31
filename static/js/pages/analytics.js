/**
 * Analytics Page Module
 * Handles failure analytics display, filtering, sorting, and export
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, closeModal } from '../core/modal.js';

// Analytics state
let analyticsData = {
  failures: [],
  allFailures: [],
  totalRequests: 0,
  failureCount: 0,
  sortBy: 'timestamp',
  sortDir: 'desc',
  currentPage: 1,
  pageSize: 10,
  providerFailures: {},
  dailyFailures: []
};

let analyticsFilterTimeout = null;

/**
 * Debounced filter for search input
 */
export function debounceFilterAnalytics() {
  clearTimeout(analyticsFilterTimeout);
  analyticsFilterTimeout = setTimeout(filterAnalytics, 300);
}

/**
 * Get severity level from HTTP status
 */
function getSeverity(httpStatus) {
  if (!httpStatus) return { level: 'low', label: 'Unknown', class: 'low' };
  if (httpStatus >= 500) return { level: 'critical', label: 'Critical', class: 'critical' };
  if (httpStatus === 429 || httpStatus === 408) return { level: 'high', label: 'High', class: 'high' };
  if (httpStatus >= 400) return { level: 'medium', label: 'Medium', class: 'medium' };
  return { level: 'low', label: 'Low', class: 'low' };
}

/**
 * Generate sparkline data from failures
 */
function generateSparklineData(failures, days = 7) {
  const now = new Date();
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const count = failures.filter(f => f.timestamp.split('T')[0] === dateStr).length;
    data.push(count);
  }
  return data;
}

/**
 * Render sparkline chart
 */
function renderSparkline(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container || !data.length) return;
  
  const maxVal = Math.max(...data, 1);
  container.innerHTML = data.map(val => {
    const height = Math.max(4, (val / maxVal) * 100);
    return `<div class="analytics-sparkline-bar" style="height:${height}%"></div>`;
  }).join('');
}

/**
 * Update active filters indicator
 */
function updateActiveFiltersIndicator() {
  const provider = document.getElementById('analyticsProviderFilter')?.value || '';
  const model = document.getElementById('analyticsModelFilter')?.value || '';
  const severity = document.getElementById('analyticsSeverityFilter')?.value || '';
  const timeRange = document.getElementById('analyticsTimeFilter')?.value || 'all';
  const search = document.getElementById('analyticsSearchFilter')?.value || '';
  
  let count = 0;
  if (provider) count++;
  if (model) count++;
  if (severity) count++;
  if (timeRange !== 'all') count++;
  if (search) count++;
  
  const indicator = document.getElementById('analyticsFiltersActive');
  const countEl = document.getElementById('analyticsActiveCount');
  
  if (indicator && countEl) {
    if (count > 0) {
      countEl.textContent = count;
      indicator.classList.add('visible');
    } else {
      indicator.classList.remove('visible');
    }
  }
}

/**
 * Clear all analytics filters
 */
export function clearAnalyticsFilters() {
  const providerEl = document.getElementById('analyticsProviderFilter');
  const modelEl = document.getElementById('analyticsModelFilter');
  const severityEl = document.getElementById('analyticsSeverityFilter');
  const timeEl = document.getElementById('analyticsTimeFilter');
  const searchEl = document.getElementById('analyticsSearchFilter');
  
  if (providerEl) providerEl.value = '';
  if (modelEl) modelEl.value = '';
  if (severityEl) severityEl.value = '';
  if (timeEl) timeEl.value = 'all';
  if (searchEl) searchEl.value = '';
  
  analyticsData.currentPage = 1;
  filterAnalytics();
}

/**
 * Show error banner
 */
function showAnalyticsError(message) {
  const banner = document.getElementById('analyticsErrorBanner');
  const msgEl = document.getElementById('analyticsErrorMessage');
  if (banner && msgEl) {
    msgEl.textContent = message;
    banner.classList.add('visible');
  }
}

/**
 * Hide error banner
 */
function hideAnalyticsError() {
  const banner = document.getElementById('analyticsErrorBanner');
  if (banner) banner.classList.remove('visible');
}

/**
 * Update trend indicator element
 */
function updateTrendIndicator(elementId, current, previous, higherIsBad) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  let change = 0;
  if (previous > 0) {
    change = ((current - previous) / previous * 100).toFixed(0);
  } else if (current > 0) {
    change = 100;
  }
  
  let className = 'neutral';
  let icon = '<line x1="5" y1="12" x2="19" y2="12"></line>';
  
  if (change > 0) {
    className = higherIsBad ? 'up' : 'down';
    icon = '<polyline points="18 15 12 9 6 15"></polyline>';
  } else if (change < 0) {
    className = higherIsBad ? 'down' : 'up';
    icon = '<polyline points="6 9 12 15 18 9"></polyline>';
  }
  
  el.className = `analytics-stat-trend ${className}`;
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${icon}
    </svg>
    <span>${change > 0 ? '+' : ''}${change}%</span>
  `;
}

/**
 * Render failure breakdown chart
 */
function renderFailureBreakdown(containerId, data, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="analytics-empty-state" style="padding:32px">
        <div class="analytics-empty-icon" style="width:48px;height:48px;margin-bottom:12px">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <div class="analytics-empty-title" style="font-size:14px">${emptyMessage}</div>
        <div class="analytics-empty-subtitle" style="font-size:12px">All systems operating normally</div>
      </div>`;
    return;
  }

  const maxVal = entries[0][1];
  container.innerHTML = entries.slice(0, 6).map(([name, count], idx) => {
    const pct = maxVal > 0 ? (count / maxVal * 100) : 0;
    const displayName = name.length > 20 ? name.slice(0, 17) + '...' : name;
    return `
      <div class="analytics-breakdown-item">
        <span class="analytics-breakdown-rank">${idx + 1}</span>
        <span class="analytics-breakdown-name" title="${name}">${displayName}</span>
        <div class="analytics-breakdown-bar-wrapper">
          <div class="analytics-breakdown-bar" style="width:${pct}%"></div>
        </div>
        <div class="analytics-breakdown-count">
          <span class="badge badge-red">${count}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render the analytics table with current data
 */
function renderAnalyticsTable(failures) {
  const tbody = document.getElementById('analyticsTable');
  const resultCountEl = document.getElementById('analyticsResultCount');
  
  if (!tbody) return;
  
  if (resultCountEl) {
    resultCountEl.textContent = `${failures.length} failure${failures.length !== 1 ? 's' : ''}`;
  }

  if (failures.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="analytics-empty-state">
        <div class="analytics-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <h3 class="analytics-empty-title">No Failed Requests</h3>
        <p class="analytics-empty-subtitle">Great news! No failures match your current filters. Your API is running smoothly.</p>
        <button class="btn btn-secondary btn-sm" onclick="window.analyticsModule.clearAnalyticsFilters()">Reset Filters</button>
      </div>
    </td></tr>`;
    updatePagination(0);
    return;
  }

  // Apply sorting
  const sortedFailures = [...failures].sort((a, b) => {
    let aVal, bVal;
    switch(analyticsData.sortBy) {
      case 'timestamp':
        aVal = new Date(a.timestamp);
        bVal = new Date(b.timestamp);
        break;
      case 'severity':
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        aVal = severityOrder[a.severity?.level] || 4;
        bVal = severityOrder[b.severity?.level] || 4;
        break;
      case 'provider':
        aVal = a.provider.toLowerCase();
        bVal = b.provider.toLowerCase();
        break;
      case 'model':
        aVal = a.model.toLowerCase();
        bVal = b.model.toLowerCase();
        break;
      case 'source':
        aVal = a.source.toLowerCase();
        bVal = b.source.toLowerCase();
        break;
      case 'status':
        aVal = a.httpStatus || 0;
        bVal = b.httpStatus || 0;
        break;
      default:
        aVal = a.timestamp;
        bVal = b.timestamp;
    }
    
    if (aVal < bVal) return analyticsData.sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return analyticsData.sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Paginate
  const { currentPage, pageSize } = analyticsData;
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const pageData = sortedFailures.slice(start, end);

  tbody.innerHTML = pageData.map(f => {
    const ts = new Date(f.timestamp);
    const timeStr = isNaN(ts) ? f.timestamp : ts.toLocaleString();
    const shortSource = f.source.length > 20 ? f.source.slice(0, 17) + '...' : f.source;
    const shortProvider = f.provider.length > 15 ? f.provider.slice(0, 12) + '...' : f.provider;

    const severity = f.severity || getSeverity(f.httpStatus);
    const severityHtml = `
      <span class="severity-indicator">
        <span class="severity-dot ${severity.class}"></span>
        ${severity.label}
      </span>
    `;

    let statusBadge = '<span class="badge badge-red">Error</span>';
    if (f.httpStatus) {
      const badgeClass = f.httpStatus >= 500 ? 'badge-red' : f.httpStatus >= 400 ? 'badge-yellow' : 'badge-cyan';
      statusBadge = `<span class="badge ${badgeClass}">${f.httpStatus}</span>`;
    } else if (f.errorCode) {
      const shortCode = f.errorCode.length > 12 ? f.errorCode.slice(0, 10) + '..' : f.errorCode;
      statusBadge = `<span class="badge badge-red" title="${f.errorCode}">${shortCode}</span>`;
    }

    const escapedF = JSON.stringify(f).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    return `<tr>
      <td style="font-size:12px;color:var(--text-secondary)">${timeStr}</td>
      <td>${severityHtml}</td>
      <td><span class="badge badge-purple">${shortProvider}</span></td>
      <td><span style="color:var(--accent-cyan);font-weight:500;font-size:13px">${f.model}</span></td>
      <td title="${f.source}" style="font-size:12px">${shortSource}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="analytics-detail-btn" onclick='window.analyticsModule.showFailureDetails(${escapedF})'>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Details
        </button>
      </td>
    </tr>`;
  }).join('');

  updatePagination(sortedFailures.length);
}

/**
 * Update pagination controls
 */
function updatePagination(totalItems) {
  const { currentPage, pageSize } = analyticsData;
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  
  const infoEl = document.getElementById('analyticsPaginationInfo');
  const prevBtn = document.getElementById('analyticsPrevBtn');
  const nextBtn = document.getElementById('analyticsNextBtn');
  const pageNumbersEl = document.getElementById('analyticsPageNumbers');
  
  if (infoEl) {
    infoEl.textContent = `Showing ${start}-${end} of ${totalItems} failures`;
  }
  
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  
  if (pageNumbersEl) {
    let pages = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages = [1, 2, 3, 4, '...', totalPages];
      } else if (currentPage >= totalPages - 2) {
        pages = [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
      } else {
        pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
      }
    }
    
    pageNumbersEl.innerHTML = pages.map(p => {
      if (p === '...') {
        return '<span class="analytics-page-num" style="cursor:default">...</span>';
      }
      return `<span class="analytics-page-num ${p === currentPage ? 'active' : ''}" onclick="window.analyticsModule.goToAnalyticsPage(${p})">${p}</span>`;
    }).join('');
  }
}

/**
 * Go to specific analytics page
 */
export function goToAnalyticsPage(page) {
  analyticsData.currentPage = page;
  renderAnalyticsTable(analyticsData.failures);
}

/**
 * Change analytics page by delta
 */
export function changeAnalyticsPage(delta) {
  analyticsData.currentPage += delta;
  renderAnalyticsTable(analyticsData.failures);
}

/**
 * Change analytics page size
 */
export function changeAnalyticsPageSize() {
  const select = document.getElementById('analyticsPageSize');
  if (select) {
    analyticsData.pageSize = parseInt(select.value, 10);
    analyticsData.currentPage = 1;
    renderAnalyticsTable(analyticsData.failures);
  }
}

/**
 * Sort analytics table by column
 */
export function sortAnalyticsTable(column) {
  if (analyticsData.sortBy === column) {
    analyticsData.sortDir = analyticsData.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    analyticsData.sortBy = column;
    analyticsData.sortDir = 'desc';
  }
  
  document.querySelectorAll('.analytics-table th').forEach(th => {
    th.classList.remove('sorted', 'desc', 'asc');
    if (th.dataset.sort === column) {
      th.classList.add('sorted', analyticsData.sortDir);
    }
  });
  
  analyticsData.currentPage = 1;
  renderAnalyticsTable(analyticsData.failures);
}

/**
 * Filter analytics based on current filter values
 */
export function filterAnalytics() {
  const providerEl = document.getElementById('analyticsProviderFilter');
  const modelEl = document.getElementById('analyticsModelFilter');
  const severityEl = document.getElementById('analyticsSeverityFilter');
  const timeEl = document.getElementById('analyticsTimeFilter');
  const searchEl = document.getElementById('analyticsSearchFilter');
  
  const provider = providerEl?.value || '';
  const model = modelEl?.value || '';
  const severity = severityEl?.value || '';
  const timeRange = timeEl?.value || 'all';
  const search = (searchEl?.value || '').toLowerCase();

  let filtered = [...analyticsData.allFailures];

  if (provider) {
    filtered = filtered.filter(f => f.provider === provider);
  }

  if (model) {
    filtered = filtered.filter(f => f.model === model);
  }

  if (severity) {
    filtered = filtered.filter(f => f.severity?.level === severity);
  }

  if (timeRange !== 'all') {
    const now = new Date();
    let cutoff;
    if (timeRange === 'hour') {
      cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    } else if (timeRange === 'today') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (timeRange === 'week') {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'month') {
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    if (cutoff) {
      filtered = filtered.filter(f => new Date(f.timestamp) >= cutoff);
    }
  }

  if (search) {
    filtered = filtered.filter(f =>
      f.provider.toLowerCase().includes(search) ||
      f.model.toLowerCase().includes(search) ||
      f.source.toLowerCase().includes(search) ||
      (f.errorCode || '').toLowerCase().includes(search) ||
      (f.errorMessage || '').toLowerCase().includes(search)
    );
  }

  analyticsData.failures = filtered;
  analyticsData.currentPage = 1;
  updateActiveFiltersIndicator();
  renderAnalyticsTable(filtered);
}

/**
 * Show failure details in modal
 */
export function showFailureDetails(failure) {
  document.getElementById('modalTitle').textContent = 'Failure Details';
  
  const severity = failure.severity || getSeverity(failure.httpStatus);
  const severityColors = {
    critical: { bg: 'rgba(248, 113, 113, 0.1)', border: 'rgba(248, 113, 113, 0.3)', text: 'var(--accent-red)' },
    high: { bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.3)', text: 'var(--accent-yellow)' },
    medium: { bg: 'rgba(0, 229, 255, 0.1)', border: 'rgba(0, 229, 255, 0.3)', text: 'var(--accent-cyan)' },
    low: { bg: 'rgba(136, 136, 170, 0.1)', border: 'rgba(136, 136, 170, 0.3)', text: 'var(--text-muted)' }
  };
  const colors = severityColors[severity.level] || severityColors.low;

  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border-color)">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:48px;height:48px;border-radius:12px;background:${colors.bg};display:flex;align-items:center;justify-content:center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors.text}" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div>
          <div style="font-weight:600;font-size:16px;margin-bottom:4px">${failure.model}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${new Date(failure.timestamp).toLocaleString()}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="severity-indicator">
          <span class="severity-dot ${severity.class}"></span>
          ${severity.label}
        </span>
        ${failure.httpStatus ? `<span class="badge ${failure.httpStatus >= 500 ? 'badge-red' : failure.httpStatus >= 400 ? 'badge-yellow' : 'badge-cyan'}">${failure.httpStatus}</span>` : ''}
      </div>
    </div>
  `;

  let errorSection = '';
  if (failure.httpStatus || failure.errorCode || failure.errorMessage) {
    errorSection = `
      <div style="background:${colors.bg};border:1px solid ${colors.border};border-radius:12px;padding:16px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${colors.text}" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span style="font-weight:600;color:${colors.text};font-size:14px">Error Details</span>
        </div>
        <div style="display:grid;gap:10px">
          ${failure.errorCode ? `
            <div style="display:flex;align-items:center;gap:12px">
              <span style="color:var(--text-secondary);font-size:12px;min-width:90px">Error Code</span>
              <code style="background:rgba(0,0,0,0.3);padding:6px 12px;border-radius:6px;font-size:12px;font-family:monospace">${failure.errorCode}</code>
            </div>
          ` : ''}
          ${failure.errorMessage ? `
            <div>
              <span style="color:var(--text-secondary);font-size:12px;display:block;margin-bottom:8px">Message</span>
              <pre style="background:rgba(0,0,0,0.4);padding:14px;border-radius:8px;overflow-x:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow-y:auto;margin:0;color:var(--text-primary);border:1px solid rgba(255,255,255,0.05)">${failure.errorMessage}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  } else {
    errorSection = `
      <div style="background:rgba(136,136,170,0.08);border:1px dashed rgba(136,136,170,0.3);border-radius:12px;padding:24px;margin-bottom:20px;text-align:center">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom:12px">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <p style="color:var(--text-muted);font-size:13px;margin:0">No detailed error information captured.<br><span style="font-size:12px;opacity:0.8">Error details will be available for future failures.</span></p>
      </div>
    `;
  }

  const infoGridHtml = `
    <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:16px;margin-bottom:20px">
      <div style="background:rgba(167, 139, 250, 0.08);border:1px solid rgba(167, 139, 250, 0.2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Provider</div>
        <div style="font-weight:500;color:var(--accent-purple)">${failure.provider}</div>
      </div>
      <div style="background:rgba(0, 229, 255, 0.08);border:1px solid rgba(0, 229, 255, 0.2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Model</div>
        <div style="font-weight:500;color:var(--accent-cyan)">${failure.model}</div>
      </div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Source</div>
        <div style="font-size:13px;word-break:break-all;color:var(--text-primary)">${failure.source}</div>
      </div>
      <div style="background:rgba(251, 191, 36, 0.08);border:1px solid rgba(251, 191, 36, 0.2);border-radius:10px;padding:14px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Auth Index</div>
        <div style="font-weight:500;color:var(--accent-yellow)">${failure.authIndex !== undefined ? failure.authIndex : 'N/A'}</div>
      </div>
    </div>
  `;

  const tokensHtml = (failure.tokens && Object.keys(failure.tokens).length > 0) ? `
    <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:10px;padding:14px">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        Token Usage
      </div>
      <pre style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:12px;margin:0;overflow-x:auto;color:var(--text-secondary)">${JSON.stringify(failure.tokens, null, 2)}</pre>
    </div>
  ` : '';

  document.getElementById('modalContent').innerHTML = `
    <div>
      ${headerHtml}
      ${errorSection}
      ${infoGridHtml}
      ${tokensHtml}
    </div>
  `;
  
  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.analyticsModule.copyFailureToClipboard()" style="margin-right:auto">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy Details
    </button>
    <button class="btn btn-primary" onclick="window.analyticsModule.closeModal()">Close</button>
  `;
  
  window._currentFailureDetails = failure;
  
  document.getElementById('modal').classList.add('active');
}

/**
 * Copy failure details to clipboard
 */
export function copyFailureToClipboard() {
  const f = window._currentFailureDetails;
  if (!f) return;
  
  const text = `Failure Details
================
Timestamp: ${new Date(f.timestamp).toLocaleString()}
Provider: ${f.provider}
Model: ${f.model}
Source: ${f.source}
Auth Index: ${f.authIndex !== undefined ? f.authIndex : 'N/A'}
HTTP Status: ${f.httpStatus || 'N/A'}
Error Code: ${f.errorCode || 'N/A'}
Error Message: ${f.errorMessage || 'N/A'}
Tokens: ${JSON.stringify(f.tokens, null, 2)}`;
  
  navigator.clipboard.writeText(text).then(() => {
    toast('Failure details copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy to clipboard', 'error');
  });
}

/**
 * Export analytics data to CSV
 */
export function exportAnalytics() {
  const failures = analyticsData.failures;
  if (failures.length === 0) {
    toast('No data to export', 'info');
    return;
  }

  const headers = ['Timestamp', 'Provider', 'Model', 'Source', 'Auth Index', 'HTTP Status', 'Error Code', 'Error Message', 'Input Tokens', 'Output Tokens'];
  const rows = failures.map(f => [
    new Date(f.timestamp).toISOString(),
    f.provider,
    f.model,
    f.source,
    f.authIndex !== undefined ? f.authIndex : '',
    f.httpStatus || '',
    f.errorCode || '',
    f.errorMessage || '',
    f.tokens?.input_tokens || 0,
    f.tokens?.output_tokens || 0
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `failure-analytics-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toast(`Exported ${failures.length} failures to CSV`, 'success');
}

/**
 * Load analytics data from the server
 */
export async function loadAnalytics() {
  const refreshBtn = document.getElementById('analyticsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }
  
  hideAnalyticsError();
  
  try {
    const d = await api('GET', '/usage');
    const u = d.usage || {};
    const apis = u.apis || {};

    const failures = [];
    const providerFailures = {};
    const modelFailures = {};
    const providers = new Set();
    const models = new Set();

    const total = u.total_requests || 0;
    const failed = u.failure_count || 0;
    const today = new Date().toISOString().split('T')[0];
    let failedToday = 0;
    let failedYesterday = 0;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const [apiKey, apiStats] of Object.entries(apis)) {
      const modelsData = apiStats.models || {};

      for (const [modelName, modelStats] of Object.entries(modelsData)) {
        const details = modelStats.details || [];

        for (const detail of details) {
          models.add(modelName);

          const provider = detail.source || apiKey || 'unknown';
          providers.add(provider);

          if (detail.failed) {
            const timestamp = detail.timestamp || new Date().toISOString();
            const dateOnly = timestamp.split('T')[0];
            const severity = getSeverity(detail.http_status || 0);

            failures.push({
              timestamp,
              provider,
              model: modelName,
              source: detail.source || '-',
              authIndex: detail.auth_index,
              tokens: detail.tokens || {},
              errorCode: detail.error_code || '',
              errorMessage: detail.error_message || '',
              httpStatus: detail.http_status || 0,
              severity: severity
            });

            providerFailures[provider] = (providerFailures[provider] || 0) + 1;
            modelFailures[modelName] = (modelFailures[modelName] || 0) + 1;

            if (dateOnly === today) failedToday++;
            if (dateOnly === yesterday) failedYesterday++;
          }
        }
      }
    }

    failures.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    analyticsData.failures = failures;
    analyticsData.allFailures = failures;
    analyticsData.totalRequests = total;
    analyticsData.failureCount = failed;
    analyticsData.providerFailures = providerFailures;
    analyticsData.currentPage = 1;

    const failedTotalEl = document.getElementById('analyticsFailedTotal');
    const failedTodayEl = document.getElementById('analyticsFailedToday');
    const successRateEl = document.getElementById('analyticsSuccessRate');
    const topProviderEl = document.getElementById('analyticsTopFailProvider');
    
    if (failedTotalEl) failedTotalEl.textContent = failed.toLocaleString();
    if (failedTodayEl) failedTodayEl.textContent = failedToday.toLocaleString();
    
    const successRate = total > 0 ? (((total - failed) / total) * 100).toFixed(1) : '100';
    if (successRateEl) successRateEl.textContent = successRate + '%';

    const topProvider = Object.entries(providerFailures).sort((a, b) => b[1] - a[1])[0];
    if (topProviderEl) {
      topProviderEl.textContent = topProvider ?
        (topProvider[0].length > 18 ? topProvider[0].slice(0, 15) + '...' : topProvider[0]) : '-';
    }
    
    const topProviderCountEl = document.getElementById('topProviderFailCount');
    if (topProviderCountEl && topProvider) {
      topProviderCountEl.textContent = `${topProvider[1]} failures`;
    }

    updateTrendIndicator('analyticsFailedTrend', failedToday, failedYesterday, true);
    
    const sparklineData = generateSparklineData(failures, 7);
    renderSparkline('sparklineTotal', sparklineData);
    renderSparkline('sparklineToday', sparklineData);
    renderSparkline('sparklineRate', sparklineData);

    const updateTimeEl = document.getElementById('analyticsUpdateTime');
    if (updateTimeEl) {
      updateTimeEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }

    const providerSelect = document.getElementById('analyticsProviderFilter');
    if (providerSelect) {
      providerSelect.innerHTML = '<option value="">All Providers</option>' +
        [...providers].sort().map(p => `<option value="${p}">${p.length > 30 ? p.slice(0, 27) + '...' : p}</option>`).join('');
    }

    const modelSelect = document.getElementById('analyticsModelFilter');
    if (modelSelect) {
      modelSelect.innerHTML = '<option value="">All Models</option>' +
        [...models].sort().map(m => `<option value="${m}">${m}</option>`).join('');
    }

    renderFailureBreakdown('failuresByProvider', providerFailures, 'No provider failures');
    renderFailureBreakdown('failuresByModel', modelFailures, 'No model failures');
    renderAnalyticsTable(failures);

  } catch (e) {
    showAnalyticsError('Failed to load analytics: ' + e.message);
    toast('Failed to load analytics: ' + e.message, 'error');
    console.error(e);
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  }
}

// Expose module functions globally for onclick handlers
window.analyticsModule = {
  loadAnalytics,
  filterAnalytics,
  debounceFilterAnalytics,
  clearAnalyticsFilters,
  sortAnalyticsTable,
  changeAnalyticsPage,
  changeAnalyticsPageSize,
  goToAnalyticsPage,
  exportAnalytics,
  showFailureDetails,
  copyFailureToClipboard,
  closeModal
};
