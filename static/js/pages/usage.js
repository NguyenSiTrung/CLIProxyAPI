/**
 * Usage Statistics Page Module
 * Handles usage stats display, charts, cost calculations, and data import/export
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal } from '../core/modal.js';
import { 
  getUsageState, 
  updateUsageState,
  getModelPricingConfig,
  setModelPricingConfig,
  isPricingConfigLoaded,
  setPricingConfigLoaded
} from '../core/state.js';

// Chart instances
let requestsChartInstance = null;
let tokensChartInstance = null;

// Cost limits cache
let costLimitsCache = null;

// Auto-backup state cache
const autoBackupState = {
  enabled: false,
  folder: '',
  intervalMinutes: null
};

// Default pricing for well-known models (prices per 1M tokens in USD)
const DEFAULT_MODEL_PRICING = {
  // OpenAI Models
  'gpt-4o': { input: 2.50, output: 10.00, cached_input: 1.25 },
  'gpt-4o-2024-08-06': { input: 2.50, output: 10.00, cached_input: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cached_input: 0.075 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4.1': { input: 2.00, output: 8.00, cached_input: 0.50 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60, cached_input: 0.10 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 2.00, output: 8.00, cached_input: 0.50 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40, cached_input: 0.275 },
  
  // Anthropic Claude Models
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, cached_input: 0.08 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cached_input: 1.50 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, cached_input: 0.03 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, cached_input: 1.50 },
  
  // Google Gemini Models
  'gemini-1.5-pro': { input: 1.25, output: 5.00, cached_input: 0.3125 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30, cached_input: 0.01875 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40, cached_input: 0.025 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00, cached_input: 0.125 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, cached_input: 0.0375 },
  
  // DeepSeek Models
  'deepseek-chat': { input: 0.14, output: 0.28, cached_input: 0.014 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  
  // Mistral Models
  'mistral-large-latest': { input: 2.00, output: 6.00 },
  'mistral-small-latest': { input: 0.20, output: 0.60 },
};

/**
 * Get default pricing for a model
 */
function getDefaultPricing(modelId) {
  if (DEFAULT_MODEL_PRICING[modelId]) {
    return DEFAULT_MODEL_PRICING[modelId];
  }
  
  const lowerModelId = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (lowerModelId.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerModelId)) {
      return pricing;
    }
  }
  
  return null;
}

/**
 * Load pricing configuration from server
 */
async function loadPricingConfig() {
  if (isPricingConfigLoaded()) return;
  try {
    const data = await api('GET', '/model-pricing');
    setModelPricingConfig(data.pricing || {});
    setPricingConfigLoaded(true);
  } catch (e) {
    console.error('Failed to load pricing config:', e);
    setModelPricingConfig({});
  }
}

/**
 * Load cost limits data from server
 */
async function loadCostLimitsData() {
  try {
    const data = await api('GET', '/access-key-limits');
    costLimitsCache = data;
    return data;
  } catch (e) {
    console.error('Failed to load cost limits:', e);
    costLimitsCache = { enabled: false, keys: [] };
    return costLimitsCache;
  }
}

/**
 * Get cost limit info for an API key
 */
function getCostLimitInfo(apiKey) {
  if (!costLimitsCache || !costLimitsCache.enabled || !costLimitsCache.keys) {
    return null;
  }
  return costLimitsCache.keys.find(k => k.api_key === apiKey) || null;
}

/**
 * Format numbers with appropriate suffixes
 */
function formatNumber(num, decimals = 1) {
  if (num >= 1000000) return (num / 1000000).toFixed(decimals) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(decimals) + 'k';
  return num.toLocaleString();
}

/**
 * Get period label for date range
 */
function getPeriodLabel(range) {
  switch (range) {
    case 'today': return 'Today';
    case '7d': return 'Last 7 days';
    case '30d': return 'Last 30 days';
    default: return 'All time';
  }
}

/**
 * Filter data by date range
 */
function filterDataByDateRange(data, range) {
  if (range === 'all' || !data) return data;
  
  const now = new Date();
  let cutoff;
  
  if (range === 'today') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === '7d') {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === '30d') {
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    return data;
  }
  
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    try {
      const date = new Date(key);
      if (!isNaN(date.getTime()) && date >= cutoff) {
        filtered[key] = value;
      }
    } catch {
      // Skip invalid date keys
    }
  }
  return filtered;
}

/**
 * Load usage statistics
 */
export async function loadUsageStats() {
  const refreshBtn = document.getElementById('usageRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }

  await Promise.all([loadPricingConfig(), loadCostLimitsData()]);

  try {
    const d = await api('GET', '/usage');
    const u = d.usage || {};

    updateUsageState({ rawData: u });

    const updateTimeEl = document.getElementById('usageUpdateTime');
    if (updateTimeEl) {
      updateTimeEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
    }

    renderUsageData(u);
  } catch (e) {
    toast('Failed to load usage stats: ' + e.message, 'error');
    console.error(e);
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Render usage data to the page
 */
function renderUsageData(usageData) {
  if (!usageData) return;

  const state = getUsageState();
  const range = state.dateRange;
  const periodLabel = getPeriodLabel(range);

  const reqByDay = usageData.requests_by_day || {};
  const filteredReqByDay = filterDataByDateRange(reqByDay, range);
  const filteredTotal = Object.values(filteredReqByDay).reduce((a, b) => a + b, 0);

  const allTimeTotal = usageData.total_requests || 0;
  const allTimeSuccess = usageData.success_count || 0;
  const allTimeFailed = usageData.failure_count || 0;

  let total, success, failed;
  if (range === 'all') {
    total = allTimeTotal;
    success = allTimeSuccess;
    failed = allTimeFailed;
  } else {
    total = filteredTotal;
    const failRatio = allTimeTotal > 0 ? allTimeFailed / allTimeTotal : 0;
    failed = Math.round(total * failRatio);
    success = total - failed;
  }

  const rate = total > 0 ? ((success / total) * 100).toFixed(1) : '-';

  const usageTotalRequestsEl = document.getElementById('usageTotalRequests');
  const usageSuccessfulEl = document.getElementById('usageSuccessful');
  const usageFailedEl = document.getElementById('usageFailed');
  const usageSuccessRateEl = document.getElementById('usageSuccessRate');

  if (usageTotalRequestsEl) usageTotalRequestsEl.textContent = total.toLocaleString();
  if (usageSuccessfulEl) usageSuccessfulEl.textContent = success.toLocaleString();
  if (usageFailedEl) usageFailedEl.textContent = failed.toLocaleString();
  if (usageSuccessRateEl) usageSuccessRateEl.textContent = rate === '-' ? '-' : rate + '%';

  const periodElements = ['usageReqPeriod', 'usageSuccessPeriod', 'usageFailedPeriod', 'usageRatePeriod'];
  periodElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = periodLabel;
  });

  const rateIndicator = document.getElementById('usageRateIndicator');
  if (rateIndicator) {
    if (rate === '-' || parseFloat(rate) >= 95) {
      rateIndicator.classList.remove('down');
    } else {
      rateIndicator.classList.add('down');
    }
  }

  // Deep aggregation for tokens
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  const providerUsage = {};
  const modelUsage = {};
  const apis = usageData.apis || {};
  const pricingConfig = getModelPricingConfig();

  if (typeof apis === 'object') {
    for (const [apiKey, apiStats] of Object.entries(apis)) {
      if (!apiStats || typeof apiStats !== 'object') continue;

      const pKey = apiKey || 'unknown';
      if (!providerUsage[pKey]) providerUsage[pKey] = { requests: 0, tokens: 0, cost: 0 };
      providerUsage[pKey].requests += (apiStats.total_requests || 0);
      providerUsage[pKey].tokens += (apiStats.total_tokens || 0);

      const providerModels = apiStats.models || {};
      for (const [modelName, modelStats] of Object.entries(providerModels)) {
        if (!modelStats || typeof modelStats !== 'object') continue;
        const details = modelStats.details || [];
        let modelInput = 0, modelOutput = 0, modelCached = 0;
        for (const detail of details) {
          const t = detail.tokens || {};
          modelInput += (t.input_tokens || 0);
          modelOutput += (t.output_tokens || 0);
          modelCached += (t.cached_tokens || 0);
        }
        const pricing = pricingConfig[modelName] || getDefaultPricing(modelName);
        if (pricing) {
          const nonCachedInput = Math.max(0, modelInput - modelCached);
          const inputCost = (nonCachedInput / 1000000) * (pricing.input || 0);
          const outputCost = (modelOutput / 1000000) * (pricing.output || 0);
          const cachedCost = (modelCached / 1000000) * (pricing.cached_input || pricing.input * 0.1 || 0);
          providerUsage[pKey].cost += inputCost + outputCost + cachedCost;
        }
      }

      const models = apiStats.models || {};
      for (const [modelName, modelStats] of Object.entries(models)) {
        if (!modelStats || typeof modelStats !== 'object') continue;

        if (!modelUsage[modelName]) modelUsage[modelName] = { requests: 0, tokens: 0 };
        modelUsage[modelName].requests += (modelStats.total_requests || 0);
        modelUsage[modelName].tokens += (modelStats.total_tokens || 0);

        const details = modelStats.details || [];
        for (const detail of details) {
          const t = detail.tokens || {};
          totalInput += (t.input_tokens || 0);
          totalOutput += (t.output_tokens || 0);
          totalReasoning += (t.reasoning_tokens || 0);
          totalCacheRead += (t.cached_tokens || 0);
          totalCacheWrite += (t.cache_creation_input_tokens || t.cache_write_tokens || 0);
        }
      }
    }
  }

  const usageTotalTokensEl = document.getElementById('usageTotalTokens');
  const usageInputTokensEl = document.getElementById('usageInputTokens');
  const usageOutputTokensEl = document.getElementById('usageOutputTokens');
  const usageReasoningTokensEl = document.getElementById('usageReasoningTokens');
  const usageCacheReadEl = document.getElementById('usageCacheRead');
  const usageCacheWriteEl = document.getElementById('usageCacheWrite');

  if (usageTotalTokensEl) usageTotalTokensEl.textContent = formatNumber(totalInput + totalOutput + totalReasoning);
  if (usageInputTokensEl) usageInputTokensEl.textContent = formatNumber(totalInput);
  if (usageOutputTokensEl) usageOutputTokensEl.textContent = formatNumber(totalOutput);
  if (usageReasoningTokensEl) usageReasoningTokensEl.textContent = totalReasoning > 0 ? formatNumber(totalReasoning) : '-';
  if (usageCacheReadEl) usageCacheReadEl.textContent = totalCacheRead > 0 ? formatNumber(totalCacheRead) : '-';
  if (usageCacheWriteEl) usageCacheWriteEl.textContent = totalCacheWrite > 0 ? formatNumber(totalCacheWrite) : '-';

  updateUsageCosts(usageData, modelUsage);
  renderProviderStats(providerUsage);
  renderModelStats(modelUsage);
  renderUsageChartsUnified(usageData);
}

/**
 * Update usage costs display
 */
function updateUsageCosts(usageData, modelUsage) {
  let totalInputCost = 0;
  let totalOutputCost = 0;
  let totalCachedCost = 0;
  let pricedModelCount = 0;
  let totalModelsUsed = 0;
  const modelsWithoutPricing = [];
  const pricingConfig = getModelPricingConfig();

  const apis = usageData.apis || {};
  const seenModels = new Set();

  for (const [apiKey, apiStats] of Object.entries(apis)) {
    if (!apiStats || typeof apiStats !== 'object') continue;

    const models = apiStats.models || {};
    for (const [modelName, modelStats] of Object.entries(models)) {
      if (!modelStats || typeof modelStats !== 'object') continue;

      const pricing = pricingConfig[modelName] || getDefaultPricing(modelName);
      if (!pricing) continue;

      const hasPricingConfig = pricingConfig[modelName] !== undefined;
      let modelInput = 0, modelOutput = 0, modelCached = 0;

      const details = modelStats.details || [];
      for (const detail of details) {
        const t = detail.tokens || {};
        modelInput += (t.input_tokens || 0);
        modelOutput += (t.output_tokens || 0);
        modelCached += (t.cached_tokens || t.cache_read_input_tokens || 0);
      }

      const nonCachedInput = Math.max(0, modelInput - modelCached);
      const inputCost = (nonCachedInput / 1000000) * (pricing.input || 0);
      const outputCost = (modelOutput / 1000000) * (pricing.output || 0);
      const cachedCost = (modelCached / 1000000) * (pricing.cached_input || pricing.input * 0.1 || 0);

      totalInputCost += inputCost;
      totalOutputCost += outputCost;
      totalCachedCost += cachedCost;

      if ((modelInput > 0 || modelOutput > 0) && !seenModels.has(modelName)) {
        seenModels.add(modelName);
        totalModelsUsed++;
        if (hasPricingConfig) {
          pricedModelCount++;
        } else {
          modelsWithoutPricing.push(modelName);
        }
      }
    }
  }

  const totalCost = totalInputCost + totalOutputCost + totalCachedCost;

  const formatCost = (cost) => {
    if (cost >= 1000) return '$' + cost.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (cost >= 100) return '$' + cost.toFixed(1);
    if (cost >= 1) return '$' + cost.toFixed(2);
    if (cost >= 0.01) return '$' + cost.toFixed(3);
    return '$' + cost.toFixed(4);
  };

  const usageTotalCostEl = document.getElementById('usageTotalCost');
  const usageInputCostEl = document.getElementById('usageInputCost');
  const usageOutputCostEl = document.getElementById('usageOutputCost');
  const usageCachedCostEl = document.getElementById('usageCachedCost');

  if (usageTotalCostEl) usageTotalCostEl.textContent = formatCost(totalCost);
  if (usageInputCostEl) usageInputCostEl.textContent = formatCost(totalInputCost);
  if (usageOutputCostEl) usageOutputCostEl.textContent = formatCost(totalOutputCost);
  if (usageCachedCostEl) usageCachedCostEl.textContent = formatCost(totalCachedCost);

  const pricedModelsEl = document.getElementById('usagePricedModels');
  if (pricedModelsEl) {
    if (totalModelsUsed > 0) {
      pricedModelsEl.textContent = `${pricedModelCount}/${totalModelsUsed}`;
      if (pricedModelCount === totalModelsUsed) {
        pricedModelsEl.className = 'badge badge-green';
      } else if (pricedModelCount > 0) {
        pricedModelsEl.className = 'badge badge-yellow';
      } else {
        pricedModelsEl.className = 'badge badge-red';
      }
    } else {
      pricedModelsEl.textContent = '0';
      pricedModelsEl.className = 'badge badge-green';
    }
  }
}

/**
 * Get usage percentage bar HTML for cost limits
 */
function getCostLimitBarHtml(currentCost, maxCost) {
  if (!maxCost || maxCost === 0) {
    return '';
  }
  const percentage = Math.min((currentCost / maxCost) * 100, 100);
  let colorClass = 'usage-green';
  if (percentage >= 90) {
    colorClass = 'usage-red';
  } else if (percentage >= 70) {
    colorClass = 'usage-yellow';
  }
  return `
    <div class="usage-bar-container" style="width:60px;height:16px">
      <div class="usage-bar ${colorClass}" style="width:${percentage}%"></div>
      <span class="usage-text" style="font-size:9px">${percentage.toFixed(0)}%</span>
    </div>`;
}

/**
 * Render provider statistics
 */
function renderProviderStats(providerUsage) {
  const providerContainer = document.getElementById('providerStats');
  if (!providerContainer) return;

  const pEntries = Object.entries(providerUsage).sort((a, b) => b[1].requests - a[1].requests);

  if (pEntries.length === 0) {
    providerContainer.innerHTML = `
      <div style="padding:32px;text-align:center;color:var(--text-secondary)">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5;margin-bottom:12px">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <p style="margin:0;font-size:14px">No provider data yet</p>
      </div>`;
    return;
  }

  providerContainer.innerHTML = '<div class="config-settings-list">' + pEntries.map(([name, stats], idx) => {
    const limitInfo = getCostLimitInfo(name);
    // Use calculated cost (stats.cost) for limit exceeded check
    const isLimitExceeded = limitInfo && limitInfo.max_cost > 0 && stats.cost >= limitInfo.max_cost;
    const hasLimit = limitInfo && limitInfo.max_cost > 0;
    
    let limitBadgeHtml = '';
    if (isLimitExceeded) {
      limitBadgeHtml = '<span class="badge" style="background:rgba(248,113,113,0.2);color:var(--accent-red);font-size:9px;padding:2px 6px;margin-left:6px">Limit Exceeded</span>';
    }
    
    let limitBarHtml = '';
    if (hasLimit) {
      // Use the calculated cost (stats.cost) for the progress bar, not the server-side accumulator
      limitBarHtml = getCostLimitBarHtml(stats.cost, limitInfo.max_cost);
    }
    
    let costDisplayHtml = `<span class="badge" style="background:rgba(251,191,36,0.15);color:var(--accent-yellow);font-weight:600">$${stats.cost.toFixed(4)}</span>`;
    if (hasLimit) {
      costDisplayHtml = `<span class="badge" style="background:rgba(251,191,36,0.15);color:var(--accent-yellow);font-weight:600">$${stats.cost.toFixed(4)} / $${limitInfo.max_cost.toFixed(2)}</span>`;
    }
    
    return `
    <div class="config-setting-item provider-clickable${isLimitExceeded ? ' provider-limit-exceeded' : ''}" style="padding:12px 16px;transition:all 0.2s;cursor:pointer${isLimitExceeded ? ';background:rgba(248,113,113,0.08)' : ''}" data-provider-key="${escapeHtml(name)}" data-provider-idx="${idx}">
      <div class="config-setting-info">
        <div class="config-setting-text">
          <h4 style="font-family:monospace;font-size:13px" title="${escapeHtml(name)}">${escapeHtml(name.length > 25 ? name.slice(0, 22) + '...' : name)}${limitBadgeHtml}</h4>
          <p>${formatNumber(stats.tokens)} tokens</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        ${limitBarHtml}
        ${costDisplayHtml}
        <span class="badge badge-purple">${stats.requests.toLocaleString()}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
    </div>
  `;
  }).join('') + '</div>';

  providerContainer.querySelectorAll('.provider-clickable').forEach(el => {
    el.addEventListener('click', () => {
      const providerKey = el.dataset.providerKey;
      showProviderDetail(providerKey);
    });
  });
}

/**
 * Show provider detail modal
 */
function showProviderDetail(providerKey) {
  const state = getUsageState();
  const usageData = state.rawData;
  if (!usageData || !usageData.apis) return;

  const apiStats = usageData.apis[providerKey];
  if (!apiStats) {
    toast('Provider data not found', 'error');
    return;
  }

  const pricingConfig = getModelPricingConfig();
  const models = apiStats.models || {};
  const modelEntries = Object.entries(models);

  let totalInput = 0, totalOutput = 0, totalCached = 0, totalCost = 0;
  let providerLastCall = null;
  const modelDetails = [];

  for (const [modelName, modelStats] of modelEntries) {
    if (!modelStats || typeof modelStats !== 'object') continue;
    
    let modelInput = 0, modelOutput = 0, modelCached = 0, modelReasoning = 0;
    let modelLastCall = null;
    const details = modelStats.details || [];
    
    for (const detail of details) {
      const t = detail.tokens || {};
      modelInput += (t.input_tokens || 0);
      modelOutput += (t.output_tokens || 0);
      modelCached += (t.cached_tokens || t.cache_read_input_tokens || 0);
      modelReasoning += (t.reasoning_tokens || 0);
      
      if (detail.timestamp) {
        const ts = new Date(detail.timestamp);
        if (!modelLastCall || ts > modelLastCall) modelLastCall = ts;
        if (!providerLastCall || ts > providerLastCall) providerLastCall = ts;
      }
    }

    totalInput += modelInput;
    totalOutput += modelOutput;
    totalCached += modelCached;

    const pricing = pricingConfig[modelName] || getDefaultPricing(modelName);
    let modelCost = 0;
    if (pricing) {
      const nonCachedInput = Math.max(0, modelInput - modelCached);
      const inputCost = (nonCachedInput / 1000000) * (pricing.input || 0);
      const outputCost = (modelOutput / 1000000) * (pricing.output || 0);
      const cachedCost = (modelCached / 1000000) * (pricing.cached_input || pricing.input * 0.1 || 0);
      modelCost = inputCost + outputCost + cachedCost;
      totalCost += modelCost;
    }

    modelDetails.push({
      name: modelName,
      requests: modelStats.total_requests || 0,
      tokens: modelStats.total_tokens || 0,
      input: modelInput,
      output: modelOutput,
      cached: modelCached,
      reasoning: modelReasoning,
      cost: modelCost,
      hasPricing: !!pricing,
      lastCall: modelLastCall
    });
  }

  modelDetails.sort((a, b) => b.requests - a.requests);

  const formatRelativeTime = (date) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const content = `
    <div class="provider-detail-content-v2">
      <div class="provider-detail-header">
        <div class="provider-detail-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
        </div>
        <div class="provider-detail-title">
          <h3>${escapeHtml(providerKey.length > 40 ? providerKey.slice(0, 37) + '...' : providerKey)}</h3>
          <div class="provider-last-activity">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Last activity: <span class="last-time">${formatRelativeTime(providerLastCall)}</span>
          </div>
        </div>
      </div>

      <div class="provider-stats-grid-v2">
        <div class="provider-stat-card-v2 requests">
          <div class="stat-icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">${(apiStats.total_requests || 0).toLocaleString()}</span>
            <span class="stat-label">Total Requests</span>
          </div>
        </div>
        <div class="provider-stat-card-v2 tokens">
          <div class="stat-icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 6v6l4 2"></path>
            </svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">${formatNumber(totalInput + totalOutput)}</span>
            <span class="stat-label">Total Tokens</span>
          </div>
        </div>
        <div class="provider-stat-card-v2 cost">
          <div class="stat-icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">$${totalCost.toFixed(4)}</span>
            <span class="stat-label">Est. Cost</span>
          </div>
        </div>
        <div class="provider-stat-card-v2 models-count">
          <div class="stat-icon-wrapper">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">${modelDetails.length}</span>
            <span class="stat-label">Models Used</span>
          </div>
        </div>
      </div>
      
      <div class="provider-token-breakdown-v2">
        <div class="section-header">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M18 20V10"></path>
            <path d="M12 20V4"></path>
            <path d="M6 20v-6"></path>
          </svg>
          <span>Token Breakdown</span>
        </div>
        <div class="token-bars">
          <div class="token-bar-item">
            <div class="token-bar-header">
              <span class="token-bar-label">Input Tokens</span>
              <span class="token-bar-value">${formatNumber(totalInput)}</span>
            </div>
            <div class="token-bar-track"><div class="token-bar-fill input" style="width:${totalInput + totalOutput > 0 ? (totalInput / (totalInput + totalOutput) * 100) : 0}%"></div></div>
          </div>
          <div class="token-bar-item">
            <div class="token-bar-header">
              <span class="token-bar-label">Output Tokens</span>
              <span class="token-bar-value">${formatNumber(totalOutput)}</span>
            </div>
            <div class="token-bar-track"><div class="token-bar-fill output" style="width:${totalInput + totalOutput > 0 ? (totalOutput / (totalInput + totalOutput) * 100) : 0}%"></div></div>
          </div>
          ${totalCached > 0 ? `
          <div class="token-bar-item">
            <div class="token-bar-header">
              <span class="token-bar-label">Cached Tokens</span>
              <span class="token-bar-value">${formatNumber(totalCached)}</span>
            </div>
            <div class="token-bar-track"><div class="token-bar-fill cached" style="width:${totalInput > 0 ? Math.min((totalCached / totalInput * 100), 100) : 0}%"></div></div>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="provider-models-section-v2">
        <div class="section-header">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          </svg>
          <span>Models (${modelDetails.length})</span>
        </div>
        <div class="provider-models-list-v2">
          ${modelDetails.length === 0 ? '<div class="no-models">No model data available</div>' : 
            modelDetails.map(m => `
              <div class="provider-model-card">
                <div class="model-card-main">
                  <div class="model-card-name">${escapeHtml(m.name)}</div>
                  <div class="model-card-meta">
                    <span class="model-requests">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                      </svg>
                      ${m.requests.toLocaleString()} requests
                    </span>
                    <span class="model-tokens">${formatNumber(m.tokens)} tokens</span>
                  </div>
                </div>
                <div class="model-card-stats">
                  <div class="model-last-call">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    ${formatRelativeTime(m.lastCall)}
                  </div>
                  ${m.hasPricing ? `<span class="model-cost">$${m.cost.toFixed(4)}</span>` : ''}
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;

  const modalInner = document.querySelector('#modal .modal');
  if (modalInner) modalInner.classList.add('provider-detail-modal-v2');

  showModal(``, content, `
    <button class="btn btn-secondary" onclick="window.closeModal()">Close</button>
  `);
}

/**
 * Render model statistics
 */
function renderModelStats(modelUsage) {
  const modelContainer = document.getElementById('modelStats');
  if (!modelContainer) return;

  const mEntries = Object.entries(modelUsage);

  if (mEntries.length === 0) {
    modelContainer.innerHTML = `
      <div style="padding:32px;text-align:center;color:var(--text-secondary)">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5;margin-bottom:12px">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        </svg>
        <p style="margin:0;font-size:14px">No model usage data yet</p>
      </div>`;
    return;
  }

  mEntries.sort((a, b) => b[1].requests - a[1].requests);

  modelContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="text-align:left">Model Name</th>
          <th style="text-align:right">Requests</th>
          <th style="text-align:right">Tokens</th>
        </tr>
      </thead>
      <tbody>
        ${mEntries.map(([name, stats]) => `
          <tr>
            <td><span style="color:var(--accent-cyan);font-weight:500">${escapeHtml(name)}</span></td>
            <td style="text-align:right">${stats.requests.toLocaleString()}</td>
            <td style="font-family:monospace;text-align:right">${formatNumber(stats.tokens)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

/**
 * Render usage charts
 */
function renderUsageChartsUnified(usageData) {
  const state = getUsageState();
  const view = state.chartView;
  const range = state.dateRange;

  let reqData, tokData, labelFormatter;

  if (view === 'hourly') {
    reqData = usageData.requests_by_hour || {};
    tokData = usageData.tokens_by_hour || {};
    labelFormatter = (h) => {
      const hour = parseInt(h, 10);
      return isNaN(hour) ? h : `${hour}:00`;
    };
  } else {
    reqData = filterDataByDateRange(usageData.requests_by_day || {}, range);
    tokData = filterDataByDateRange(usageData.tokens_by_day || {}, range);
    labelFormatter = (d) => {
      try {
        const date = new Date(d);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch {
        return d.slice(5);
      }
    };
  }

  let keys = [...new Set([...Object.keys(reqData), ...Object.keys(tokData)])];
  if (view === 'hourly') {
    keys = keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  } else {
    keys = keys.sort();
  }

  const reqValues = keys.map(k => reqData[k] || 0);
  const tokValues = keys.map(k => tokData[k] || 0);

  const viewLabel = view === 'hourly' ? 'Hourly' : 'Daily';
  const periodLabel = getPeriodLabel(range);
  const reqPeriodEl = document.getElementById('requestChartPeriod');
  const tokPeriodEl = document.getElementById('tokenChartPeriod');
  if (reqPeriodEl) reqPeriodEl.textContent = `${viewLabel} requests • ${periodLabel}`;
  if (tokPeriodEl) tokPeriodEl.textContent = `${viewLabel} tokens • ${periodLabel}`;

  const totalReq = reqValues.reduce((a, b) => a + b, 0);
  const totalTok = tokValues.reduce((a, b) => a + b, 0);

  const trendReqEl = document.getElementById('trendRequestTotal');
  const trendTokEl = document.getElementById('trendTokenTotal');
  if (trendReqEl) trendReqEl.textContent = totalReq.toLocaleString();
  if (trendTokEl) trendTokEl.textContent = formatNumber(totalTok);

  const reqEmptyEl = document.getElementById('requestsChartEmpty');
  const tokEmptyEl = document.getElementById('tokensChartEmpty');
  const hasReqData = reqValues.some(v => v > 0);
  const hasTokData = tokValues.some(v => v > 0);

  if (reqEmptyEl) reqEmptyEl.style.display = hasReqData ? 'none' : 'flex';
  if (tokEmptyEl) tokEmptyEl.style.display = hasTokData ? 'none' : 'flex';

  if (typeof Chart === 'undefined') return;

  Chart.defaults.color = '#8888aa';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';

  const ctxReq = document.getElementById('requestsChart')?.getContext('2d');
  if (ctxReq) {
    const gradReq = ctxReq.createLinearGradient(0, 0, 0, 200);
    gradReq.addColorStop(0, 'rgba(0, 229, 255, 0.25)');
    gradReq.addColorStop(1, 'rgba(0, 229, 255, 0)');

    if (requestsChartInstance) requestsChartInstance.destroy();
    requestsChartInstance = new Chart(ctxReq, {
      type: 'line',
      data: {
        labels: keys.map(labelFormatter),
        datasets: [{
          label: 'Requests',
          data: reqValues,
          borderColor: '#00e5ff',
          backgroundColor: gradReq,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: '#0d0d1a',
          pointBorderColor: '#00e5ff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(20, 20, 35, 0.95)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            borderColor: 'rgba(0, 229, 255, 0.3)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return `${context.parsed.y.toLocaleString()} requests`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0 } },
          y: { beginAtZero: true, border: { display: false } }
        }
      }
    });
  }

  const ctxTok = document.getElementById('tokensChart')?.getContext('2d');
  if (ctxTok) {
    const gradTok = ctxTok.createLinearGradient(0, 0, 0, 200);
    gradTok.addColorStop(0, '#a78bfa');
    gradTok.addColorStop(1, 'rgba(167, 139, 250, 0.1)');

    if (tokensChartInstance) tokensChartInstance.destroy();
    tokensChartInstance = new Chart(ctxTok, {
      type: 'bar',
      data: {
        labels: keys.map(labelFormatter),
        datasets: [{
          label: 'Tokens',
          data: tokValues,
          backgroundColor: gradTok,
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 'flex',
          maxBarThickness: 32,
          hoverBackgroundColor: '#8b5cf6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(20, 20, 35, 0.95)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            borderColor: 'rgba(167, 139, 250, 0.3)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: function(context) {
                return `${formatNumber(context.parsed.y)} tokens`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0 } },
          y: {
            beginAtZero: true,
            border: { display: false },
            ticks: {
              callback: function(value) {
                return formatNumber(value);
              }
            }
          }
        }
      }
    });
  }
}

/**
 * Set usage date range filter
 */
export function setUsageDateRange(range) {
  updateUsageState({ dateRange: range });

  document.querySelectorAll('.date-range-btn').forEach(btn => {
    const isActive = btn.dataset.range === range;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const state = getUsageState();
  if (state.rawData) {
    renderUsageData(state.rawData);
  }
}

/**
 * Set chart view (hourly/daily)
 */
export function setChartView(view) {
  updateUsageState({ chartView: view });

  document.querySelectorAll('.chart-view-btn').forEach(btn => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const state = getUsageState();
  if (state.rawData) {
    renderUsageChartsUnified(state.rawData);
  }
}

/**
 * Export usage data
 */
export async function exportUsageData() {
  try {
    const exportObj = await api('GET', '/usage/export');

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cliproxy-usage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Usage data exported successfully', 'success');
  } catch (err) {
    toast('Export failed: ' + err.message, 'error');
  }
}

/**
 * Trigger file input for usage import
 */
export function triggerUsageImport() {
  const input = document.getElementById('usageImportInput');
  if (input) input.click();
}

/**
 * Import usage data from file
 */
export async function importUsageData(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    let payload;

    try {
      const parsed = JSON.parse(text);
      if (parsed.usage) {
        payload = { version: parsed.version || 1, usage: parsed.usage };
      } else if (parsed.apis) {
        payload = { version: 1, usage: parsed };
      } else if (parsed.summary && parsed.apis === undefined) {
        toast('This export format is not compatible. Please re-export using the new Export button.', 'warning');
        event.target.value = '';
        return;
      } else {
        throw new Error('Unrecognized format');
      }
    } catch (e) {
      if (e.message === 'Unrecognized format') {
        toast('Unrecognized file format', 'error');
      } else {
        toast('Invalid JSON file: ' + e.message, 'error');
      }
      event.target.value = '';
      return;
    }

    const result = await api('POST', '/usage/import', payload);
    toast(`Imported ${result.added} records (${result.skipped} skipped)`, 'success');
    loadUsageStats();
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  } finally {
    event.target.value = '';
  }
}

/**
 * XSS protection helper
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// RESET USAGE DATA
// ============================================================================

/**
 * Show confirmation modal for resetting usage statistics.
 */
export function openResetUsageModal() {
  const backupAvailable = autoBackupState.enabled;
  const content = `
    <div style="padding:12px 0; text-align:left; color:var(--text-secondary); font-size:13px; line-height:1.5;">
      <p style="margin:0 0 8px 0; color:var(--text-primary);">Resetting clears all usage statistics immediately without restarting the server.</p>
      <label style="display:flex; gap:10px; align-items:flex-start; margin-top:10px;">
        <input type="checkbox" id="resetUsageBackupToggle" ${backupAvailable ? 'checked' : ''} ${backupAvailable ? '' : 'disabled'}>
        <div>
          <div style="color:var(--text-primary); font-weight:600;">Create server backup before reset</div>
          <div style="font-size:12px; color:var(--text-secondary);">
            ${backupAvailable ? 'A backup file will be saved to the configured folder before clearing data.' : 'Enable auto-backup to allow creating a backup before reset.'}
          </div>
        </div>
      </label>
      <p style="margin:12px 0 0 0; font-size:12px;">You can restore later from the <strong>Available Backups</strong> list.</p>
    </div>
  `;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-danger" id="confirmResetUsageBtn">Reset</button>
  `;

  showModal('Reset usage statistics', content, footer);

  const confirmBtn = document.getElementById('confirmResetUsageBtn');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      const backupToggle = document.getElementById('resetUsageBackupToggle');
      const backup = backupToggle ? backupToggle.checked && !backupToggle.disabled : false;
      window.closeModal();
      resetUsageData({ backup });
    };
  }
}

/**
 * Reset usage data in the server without a restart.
 */
export async function resetUsageData({ backup = false } = {}) {
  let backupRequested = backup;
  if (backupRequested && !autoBackupState.enabled) {
    toast('Auto-backup is disabled; proceeding without backup', 'warning');
    backupRequested = false;
  }

  const btn = document.getElementById('usageResetBtn');
  const label = document.getElementById('usageResetBtnLabel');
  const originalText = label ? label.textContent : 'Reset';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }
  if (label) {
    label.textContent = backupRequested ? 'Backing up…' : 'Resetting…';
  }

  try {
    const endpoint = backupRequested ? '/usage/reset?backup=true' : '/usage/reset';
    const result = await api('POST', endpoint);
    toast(result.message || 'Usage statistics reset', 'success');
    loadUsageStats();
    if (result.backup_created) {
      loadBackupFiles();
    }
  } catch (err) {
    toast('Reset failed: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    if (label) {
      label.textContent = originalText || 'Reset';
    }
  }
}

// ============================================================================
// AUTO-BACKUP STATUS (Server-Side)
// ============================================================================

/**
 * Toggle auto-backup settings panel visibility
 */
export function toggleAutoBackupSettings() {
  const panel = document.getElementById('autoBackupPanel');
  if (panel) {
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      loadAutoBackupStatus();
      loadBackupFiles();
    }
  }
}

/**
 * Initialize auto-backup status display
 */
export function initAutoBackup() {
  loadAutoBackupStatus();
}

/**
 * Load auto-backup status from server config
 */
async function loadAutoBackupStatus() {
  const statusEl = document.getElementById('autoBackupStatus');
  const btnEl = document.getElementById('autoBackupBtn');
  const intervalRow = document.getElementById('autoBackupIntervalRow');
  const intervalDisplay = document.getElementById('autoBackupIntervalDisplay');
  const folderRow = document.getElementById('autoBackupFolderRow');
  const folderDisplay = document.getElementById('autoBackupFolderDisplay');
  
  try {
    const config = await api('GET', '/config');
    const autoBackup = config?.['usage-auto-backup'] || {};
    const enabled = autoBackup.enabled === true;

    autoBackupState.enabled = enabled;
    autoBackupState.intervalMinutes = autoBackup['interval-minutes'] || null;
    autoBackupState.folder = autoBackup['folder-path'] || '';
    
    if (statusEl) {
      statusEl.textContent = enabled ? 'Enabled' : 'Disabled';
      statusEl.classList.toggle('active', enabled);
    }
    
    if (btnEl) {
      btnEl.classList.toggle('active', enabled);
      const label = btnEl.querySelector('#autoBackupBtnLabel');
      if (label) label.textContent = enabled ? 'Auto ✓' : 'Auto';
    }
    
    if (enabled) {
      if (intervalRow && intervalDisplay) {
        const minutes = autoBackup['interval-minutes'] || 60;
        intervalDisplay.textContent = formatInterval(minutes);
        intervalRow.style.display = 'flex';
      }
      
      if (folderRow && folderDisplay) {
        const folder = autoBackup['folder-path'] || '(current directory)';
        folderDisplay.textContent = folder;
        folderRow.style.display = 'flex';
      }
    } else {
      if (intervalRow) intervalRow.style.display = 'none';
      if (folderRow) folderRow.style.display = 'none';
    }
  } catch (err) {
    console.warn('Failed to load auto-backup status:', err);
    if (statusEl) {
      statusEl.textContent = 'Unknown';
    }
  }
}

function formatInterval(minutes) {
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes === 60) return 'Every 1 hour';
  if (minutes < 1440) return `Every ${Math.floor(minutes / 60)} hours`;
  return `Every ${Math.floor(minutes / 1440)} days`;
}

/**
 * Load and display backup files list
 */
export async function loadBackupFiles() {
  const listEl = document.getElementById('autoBackupFilesList');
  if (!listEl) return;
  
  listEl.innerHTML = '<div class="auto-backup-files-loading">Loading...</div>';
  
  try {
    const result = await api('GET', '/usage/backups');
    
    const files = result.files || [];
    
    if (files.length === 0) {
      const message = result.enabled 
        ? 'No backup files found' 
        : 'No backup files found (auto-backup is disabled)';
      listEl.innerHTML = `<div class="auto-backup-files-empty">${message}</div>`;
      return;
    }
    
    listEl.innerHTML = files.map(file => `
      <div class="auto-backup-file-item">
        <div class="auto-backup-file-info">
          <div class="auto-backup-file-name" title="${escapeHtmlAttr(file.filename)}">${escapeHtml(file.filename)}</div>
          <div class="auto-backup-file-meta">
            <span class="auto-backup-file-type ${file.backup_type}">${file.backup_type}</span>
            <span>${formatFileSize(file.size)}</span>
            <span>${formatBackupTime(file.mod_time)}</span>
          </div>
        </div>
        <button class="auto-backup-file-import" onclick="importBackupFile('${escapeHtmlAttr(file.filename)}')">
          Import
        </button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load backup files:', err);
    listEl.innerHTML = '<div class="auto-backup-files-empty">Failed to load backup files</div>';
  }
}

/**
 * Refresh backup files list
 */
export function refreshBackupFiles() {
  loadBackupFiles();
}

/**
 * Trigger a manual backup now
 */
export async function triggerManualBackup() {
  const btn = document.getElementById('manualBackupBtn');
  const label = document.getElementById('manualBackupBtnLabel');
  
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Backing up...';
  
  try {
    const result = await api('POST', '/usage/backups/trigger');
    toast(result.message || 'Backup completed successfully', 'success');
    loadBackupFiles();
  } catch (err) {
    toast('Backup failed: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = 'Backup Now';
  }
}

/**
 * Import a backup file from server
 */
export async function importBackupFile(filename) {
  if (!confirm(`Import usage data from "${filename}"?\n\nThis will merge the backup data with current statistics.`)) {
    return;
  }
  
  try {
    const result = await api('POST', `/usage/backups/import?filename=${encodeURIComponent(filename)}`);
    toast(`Imported ${result.added} records (${result.skipped} skipped)`, 'success');
    loadUsageStats();
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatBackupTime(isoString) {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

function escapeHtmlAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

// Export module interface for global access
export const usageModule = {
  loadUsageStats,
  setUsageDateRange,
  setChartView,
  exportUsageData,
  importUsageData,
  triggerUsageImport,
  openResetUsageModal,
  resetUsageData,
  toggleAutoBackupSettings,
  initAutoBackup,
  loadBackupFiles,
  refreshBackupFiles,
  triggerManualBackup,
  importBackupFile
};

// Expose functions to window for HTML onclick handlers
window.usageModule = usageModule;
window.loadUsageStats = loadUsageStats;
window.setUsageDateRange = setUsageDateRange;
window.setChartView = setChartView;
window.exportUsageData = exportUsageData;
window.triggerUsageImport = triggerUsageImport;
window.importUsageData = importUsageData;
window.openResetUsageModal = openResetUsageModal;
window.resetUsageData = resetUsageData;
window.toggleAutoBackupSettings = toggleAutoBackupSettings;
window.initAutoBackup = initAutoBackup;
window.refreshBackupFiles = refreshBackupFiles;
window.triggerManualBackup = triggerManualBackup;
window.importBackupFile = importBackupFile;
