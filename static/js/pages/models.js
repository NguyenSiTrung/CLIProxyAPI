/**
 * Models Page Module
 * Handles model listing, filtering, provider grouping, and pricing configuration
 */

import { api, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, closeModal } from '../core/modal.js';
import {
  getAllModels,
  setAllModels,
  getAccessApiKeys,
  setAccessApiKeys,
  getModelPricingConfig,
  setModelPricingConfig,
  isPricingConfigLoaded,
  setPricingConfigLoaded,
  getCurrentProviderFilter,
  setCurrentProviderFilter
} from '../core/state.js';

// Default pricing for well-known models (prices per 1M tokens in USD)
export const DEFAULT_MODEL_PRICING = {
  // OpenAI Models
  'gpt-4o': { input: 2.50, output: 10.00, cached_input: 1.25 },
  'gpt-4o-2024-08-06': { input: 2.50, output: 10.00, cached_input: 1.25 },
  'gpt-4o-2024-05-13': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60, cached_input: 0.075 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60, cached_input: 0.075 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-2024-04-09': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-4-0613': { input: 30.00, output: 60.00 },
  'gpt-4.1': { input: 2.00, output: 8.00, cached_input: 0.50 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60, cached_input: 0.10 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40, cached_input: 0.025 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-3.5-turbo-0125': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-preview': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 1.10, output: 4.40 },
  'o3': { input: 2.00, output: 8.00, cached_input: 0.50 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'o4-mini': { input: 1.10, output: 4.40, cached_input: 0.275 },

  // Anthropic Claude Models
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-3-5-sonnet-20240620': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, cached_input: 0.08 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cached_input: 1.50 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, cached_input: 0.03 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, cached_input: 1.50 },
  'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-opus-4-5-20250514': { input: 5.00, output: 25.00, cached_input: 0.50 },
  'claude-haiku-4-5-20250514': { input: 1.00, output: 5.00, cached_input: 0.10 },

  // Google Gemini Models
  'gemini-1.5-pro': { input: 1.25, output: 5.00, cached_input: 0.3125 },
  'gemini-1.5-pro-latest': { input: 1.25, output: 5.00, cached_input: 0.3125 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30, cached_input: 0.01875 },
  'gemini-1.5-flash-latest': { input: 0.075, output: 0.30, cached_input: 0.01875 },
  'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40, cached_input: 0.025 },
  'gemini-2.0-flash-exp': { input: 0.10, output: 0.40, cached_input: 0.025 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00, cached_input: 0.125 },
  'gemini-2.5-pro-preview': { input: 1.25, output: 10.00, cached_input: 0.125 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, cached_input: 0.0375 },
  'gemini-2.5-flash-preview': { input: 0.15, output: 0.60, cached_input: 0.0375 },
  'gemini-pro': { input: 0.50, output: 1.50 },

  // DeepSeek Models
  'deepseek-chat': { input: 0.14, output: 0.28, cached_input: 0.014 },
  'deepseek-coder': { input: 0.14, output: 0.28, cached_input: 0.014 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },

  // Mistral Models
  'mistral-large-latest': { input: 2.00, output: 6.00 },
  'mistral-medium-latest': { input: 2.70, output: 8.10 },
  'mistral-small-latest': { input: 0.20, output: 0.60 },
  'codestral-latest': { input: 0.30, output: 0.90 },

  // Meta Llama Models (typical hosted pricing)
  'llama-3.1-405b': { input: 3.00, output: 3.00 },
  'llama-3.1-70b': { input: 0.88, output: 0.88 },
  'llama-3.1-8b': { input: 0.20, output: 0.20 },
  'llama-3-70b': { input: 0.79, output: 0.79 },
  'llama-3-8b': { input: 0.20, output: 0.20 },
};

/**
 * Fetch models from the /v1/models endpoint
 * Tries management key first, then access keys, then unauthenticated
 * @returns {Promise<Array>} List of model objects
 */
export async function fetchModels() {
  const apiKey = getApiKey();
  const accessApiKeys = getAccessApiKeys();

  // Try with management key first
  let res = await fetch('/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (res.ok) {
    const data = await res.json();
    return data.data || data.models || [];
  }

  // Try with access keys from config
  if (accessApiKeys.length > 0) {
    for (const key of accessApiKeys) {
      res = await fetch('/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });

      if (res.ok) {
        const data = await res.json();
        return data.data || data.models || [];
      }
    }
  }

  // Try without auth
  res = await fetch('/v1/models');

  if (res.ok) {
    const data = await res.json();
    return data.data || data.models || [];
  }

  throw new Error('API authentication required');
}

/**
 * Load the models page
 */
export async function loadModels() {
  const refreshBtn = document.getElementById('modelsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }

  const container = document.getElementById('modelsContainer');
  container.innerHTML = `
    <div class="models-loading">
      <div class="models-loading-spinner"></div>
      <p>Loading models...</p>
    </div>
  `;

  try {
    const cfg = await api('GET', '/config').catch(() => ({}));
    setAccessApiKeys(cfg['api-keys'] || cfg.api_keys || []);
    const models = await fetchModels();
    setAllModels(models);
    setCurrentProviderFilter('all');
    updateProviderFilters(models);
    renderModels(models);
  } catch (e) {
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h4>Could not load models</h4>
        <p>The /v1/models endpoint requires API authentication. Add access keys in the <strong>API Keys</strong> tab or check your auth files.</p>
      </div>
    `;
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Get provider icon and CSS class
 * @param {string} provider - Provider name
 * @returns {{icon: string, class: string}}
 */
export function getProviderIcon(provider) {
  const p = provider.toLowerCase();
  if (p.includes('anthropic') || p.includes('claude')) return { icon: '🤖', class: 'anthropic' };
  if (p.includes('google') || p.includes('gemini')) return { icon: '✨', class: 'google' };
  if (p.includes('openai') || p.includes('gpt')) return { icon: '🧠', class: 'openai' };
  if (p.includes('meta') || p.includes('llama')) return { icon: '🦙', class: 'other' };
  if (p.includes('mistral')) return { icon: '🌀', class: 'other' };
  if (p.includes('codex')) return { icon: '💻', class: 'other' };
  return { icon: '📦', class: 'other' };
}

/**
 * Update the provider filter pills
 * @param {Array} models - List of models
 */
export function updateProviderFilters(models) {
  const providers = new Set();
  models.forEach(m => {
    const owner = m.owned_by || m.provider || 'other';
    providers.add(owner);
  });

  const pillsContainer = document.getElementById('modelsFilterPills');
  let html = `<button class="models-filter-pill active" data-provider="all" onclick="filterModelsByProvider('all')">All</button>`;

  Array.from(providers).sort().forEach(provider => {
    const count = models.filter(m => (m.owned_by || m.provider || 'other') === provider).length;
    html += `<button class="models-filter-pill" data-provider="${provider}" onclick="filterModelsByProvider('${provider}')">${provider} <span style="opacity:0.7">(${count})</span></button>`;
  });

  pillsContainer.innerHTML = html;
}

/**
 * Filter models by provider
 * @param {string} provider - Provider to filter by, or 'all'
 */
export function filterModelsByProvider(provider) {
  setCurrentProviderFilter(provider);

  document.querySelectorAll('.models-filter-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.provider === provider);
  });

  filterModels();
}

/**
 * Render the models list grouped by provider
 * @param {Array} models - List of models to render
 */
export function renderModels(models) {
  const container = document.getElementById('modelsContainer');
  const countEl = document.getElementById('modelsTotalCount');

  countEl.textContent = `${models.length} model${models.length !== 1 ? 's' : ''}`;

  if (!models.length) {
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <h4>No models found</h4>
        <p>Try adjusting your search or filter criteria.</p>
      </div>
    `;
    return;
  }

  const grouped = {};
  models.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(id);
  });

  container.innerHTML = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).map(([owner, modelList]) => {
    const { icon, class: iconClass } = getProviderIcon(owner);
    return `
      <div class="models-provider-card" data-provider="${owner}">
        <div class="models-provider-header" onclick="toggleProviderCard(this.parentElement)">
          <div class="models-provider-info">
            <div class="models-provider-icon ${iconClass}">${icon}</div>
            <span class="models-provider-name">${owner}</span>
            <span class="models-provider-count">${modelList.length} model${modelList.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="models-provider-toggle">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div class="models-list">
          ${modelList.map(id => `
            <div class="model-badge" onclick="copyModelId(this, '${id}')" title="Click to copy">
              <span>${id}</span>
              <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle a provider card expanded/collapsed state
 * @param {HTMLElement} card - The provider card element
 */
export function toggleProviderCard(card) {
  card.classList.toggle('collapsed');
}

/**
 * Copy a model ID to clipboard
 * @param {HTMLElement} element - The clicked element
 * @param {string} id - Model ID to copy
 */
export function copyModelId(element, id) {
  navigator.clipboard.writeText(id).then(() => {
    element.classList.add('copied');
    setTimeout(() => {
      element.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

/**
 * Clear the model search input
 */
export function clearModelSearch() {
  document.getElementById('modelSearch').value = '';
  document.getElementById('modelSearchClear').style.display = 'none';
  filterModels();
}

/**
 * Filter models based on search input and provider filter
 */
export function filterModels() {
  const search = document.getElementById('modelSearch').value.toLowerCase();
  const clearBtn = document.getElementById('modelSearchClear');
  const currentProviderFilter = getCurrentProviderFilter();
  const allModels = getAllModels();

  clearBtn.style.display = search ? 'flex' : 'none';

  let filtered = allModels;

  if (currentProviderFilter !== 'all') {
    filtered = filtered.filter(m => {
      const owner = m.owned_by || m.provider || 'other';
      return owner === currentProviderFilter;
    });
  }

  if (search) {
    filtered = filtered.filter(m => {
      const id = (m.id || m.name || '').toLowerCase();
      const owner = (m.owned_by || m.provider || '').toLowerCase();
      return id.includes(search) || owner.includes(search);
    });
  }

  renderModels(filtered);
}

/**
 * Load pricing configuration from server
 */
export async function loadPricingConfig() {
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
 * Save pricing configuration to server
 */
export async function savePricingConfig() {
  try {
    await api('PUT', '/model-pricing', { pricing: getModelPricingConfig() });
  } catch (e) {
    console.error('Failed to save pricing config:', e);
    toast('Failed to save pricing configuration', 'error');
  }
}

/**
 * Switch between models tabs
 * @param {string} tabId - Tab ID to switch to
 */
export async function switchModelsTab(tabId) {
  document.querySelectorAll('.models-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  document.querySelectorAll('.models-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });

  if (tabId === 'models-pricing') {
    await loadPricingConfig();
    renderPricingModels();
  }
}

/**
 * Get default pricing for a model (exact match or fuzzy match)
 * @param {string} modelId - Model ID
 * @returns {object|null} Pricing object or null
 */
export function getDefaultPricing(modelId) {
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
 * Render the pricing models list
 */
export function renderPricingModels() {
  const container = document.getElementById('pricingContainer');
  const allModels = getAllModels();
  const modelPricingConfig = getModelPricingConfig();

  if (!allModels || allModels.length === 0) {
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <h4>No models available</h4>
        <p>Load models from the "Available Models" tab first.</p>
      </div>
    `;
    return;
  }

  const grouped = {};
  allModels.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(id);
  });

  container.innerHTML = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).map(([owner, modelList]) => {
    const { icon, class: iconClass } = getProviderIcon(owner);
    const configuredCount = modelList.filter(id => modelPricingConfig[id]).length;

    return `
      <div class="pricing-card">
        <div class="pricing-card-header">
          <div class="pricing-card-title">
            <div class="pricing-card-icon ${iconClass}">${icon}</div>
            <h3>${owner}</h3>
            <span class="pricing-badge ${configuredCount > 0 ? 'configured' : 'not-configured'}">
              ${configuredCount}/${modelList.length} configured
            </span>
          </div>
        </div>
        <div class="pricing-model-list">
          ${modelList.map(id => {
            const hasPricing = !!modelPricingConfig[id];
            const hasDefault = !!getDefaultPricing(id);
            return `
              <div class="pricing-model-item ${hasPricing ? 'has-pricing' : ''}" data-model="${id}">
                <div class="pricing-model-name">${id}</div>
                <div class="pricing-model-actions">
                  ${hasPricing ? `
                    <span class="pricing-badge configured">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Configured
                    </span>
                  ` : hasDefault ? `
                    <span class="pricing-badge not-configured">Default available</span>
                  ` : ''}
                  <button class="pricing-btn ${hasPricing ? 'active' : ''}" onclick="openPricingModal('${id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    ${hasPricing ? 'Edit' : 'Set Pricing'}
                  </button>
                  ${hasPricing ? `
                    <button class="pricing-btn" onclick="removePricing('${id}')" title="Remove pricing">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Filter pricing models by search
 */
export function filterPricingModels() {
  const search = document.getElementById('pricingSearch').value.toLowerCase();
  const items = document.querySelectorAll('.pricing-model-item');
  const cards = document.querySelectorAll('.pricing-card');

  items.forEach(item => {
    const modelName = item.dataset.model.toLowerCase();
    item.style.display = modelName.includes(search) ? '' : 'none';
  });

  cards.forEach(card => {
    const visibleItems = card.querySelectorAll('.pricing-model-item:not([style*="display: none"])');
    card.style.display = visibleItems.length > 0 ? '' : 'none';
  });
}

/**
 * Open the pricing modal for a model
 * @param {string} modelId - Model ID to configure
 */
export function openPricingModal(modelId) {
  const modelPricingConfig = getModelPricingConfig();
  const existing = modelPricingConfig[modelId] || {};
  const defaultPricing = getDefaultPricing(modelId);

  const content = `
    <div class="pricing-modal-content">
      <h3 style="margin-bottom:20px;color:var(--text-primary)">Configure Pricing: <span style="color:var(--accent-cyan)">${modelId}</span></h3>

      ${defaultPricing ? `
        <div class="pricing-presets" style="margin-bottom:20px">
          <div class="pricing-presets-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            Default pricing available
          </div>
          <div class="pricing-preset-btns">
            <button class="pricing-preset-btn" onclick="applyPresetPricing('${modelId}')">
              Apply Default: $${defaultPricing.input}/M input, $${defaultPricing.output}/M output
              ${defaultPricing.cached_input ? `, $${defaultPricing.cached_input}/M cached` : ''}
            </button>
          </div>
        </div>
      ` : ''}

      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px">
        Set pricing per 1 million tokens (USD). Leave fields empty to skip.
      </p>

      <div class="pricing-form-grid">
        <div class="pricing-form-group">
          <label class="pricing-form-label">Input Tokens <span>(per 1M)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingInput"
            value="${existing.input || ''}" placeholder="e.g., 3.00">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Output Tokens <span>(per 1M)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingOutput"
            value="${existing.output || ''}" placeholder="e.g., 15.00">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Cached Input <span>(per 1M, optional)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingCached"
            value="${existing.cached_input || ''}" placeholder="e.g., 0.30">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Cached Write <span>(per 1M, optional)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingCacheWrite"
            value="${existing.cache_write || ''}" placeholder="e.g., 3.75">
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:24px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="savePricingForModel('${modelId}')">Save Pricing</button>
      </div>
    </div>
  `;

  showModal('Model Pricing', content);
}

/**
 * Apply preset/default pricing to the modal inputs
 * @param {string} modelId - Model ID
 */
export function applyPresetPricing(modelId) {
  const defaultPricing = getDefaultPricing(modelId);
  if (defaultPricing) {
    document.getElementById('pricingInput').value = defaultPricing.input || '';
    document.getElementById('pricingOutput').value = defaultPricing.output || '';
    document.getElementById('pricingCached').value = defaultPricing.cached_input || '';
    document.getElementById('pricingCacheWrite').value = defaultPricing.cache_write || '';
  }
}

/**
 * Save pricing for a specific model
 * @param {string} modelId - Model ID
 */
export async function savePricingForModel(modelId) {
  const input = parseFloat(document.getElementById('pricingInput').value) || 0;
  const output = parseFloat(document.getElementById('pricingOutput').value) || 0;
  const cached = parseFloat(document.getElementById('pricingCached').value) || 0;
  const cacheWrite = parseFloat(document.getElementById('pricingCacheWrite').value) || 0;

  if (input === 0 && output === 0) {
    toast('Please set at least input or output pricing', 'error');
    return;
  }

  const modelPricingConfig = getModelPricingConfig();
  modelPricingConfig[modelId] = {
    input: input,
    output: output,
    cached_input: cached || undefined,
    cache_write: cacheWrite || undefined
  };
  setModelPricingConfig(modelPricingConfig);

  await savePricingConfig();
  closeModal();
  renderPricingModels();
  toast(`Pricing saved for ${modelId}`, 'success');
}

/**
 * Remove pricing configuration for a model
 * @param {string} modelId - Model ID
 */
export async function removePricing(modelId) {
  if (confirm(`Remove pricing configuration for ${modelId}?`)) {
    const modelPricingConfig = getModelPricingConfig();
    delete modelPricingConfig[modelId];
    setModelPricingConfig(modelPricingConfig);
    await savePricingConfig();
    renderPricingModels();
    toast(`Pricing removed for ${modelId}`, 'success');
  }
}

/**
 * Apply default pricing to all models that don't have custom pricing
 */
export async function applyDefaultPricing() {
  const allModels = getAllModels();
  const modelPricingConfig = getModelPricingConfig();

  if (!allModels || allModels.length === 0) {
    toast('No models loaded', 'error');
    return;
  }

  let applied = 0;
  allModels.forEach(m => {
    const id = m.id || m.name;
    if (id && !modelPricingConfig[id]) {
      const defaultPricing = getDefaultPricing(id);
      if (defaultPricing) {
        modelPricingConfig[id] = { ...defaultPricing };
        applied++;
      }
    }
  });

  if (applied > 0) {
    setModelPricingConfig(modelPricingConfig);
    await savePricingConfig();
    renderPricingModels();
    toast(`Applied default pricing to ${applied} models`, 'success');
  } else {
    toast('No new models to configure (all known models already have pricing)', 'info');
  }
}

/**
 * Clear all pricing configurations
 */
export async function clearAllPricing() {
  if (confirm('Clear all pricing configurations? This cannot be undone.')) {
    setModelPricingConfig({});
    await savePricingConfig();
    renderPricingModels();
    toast('All pricing configurations cleared', 'success');
  }
}

/**
 * Export pricing configuration to a JSON file
 */
export function exportPricing() {
  const modelPricingConfig = getModelPricingConfig();
  const dataStr = JSON.stringify(modelPricingConfig, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'model-pricing-config.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Pricing configuration exported', 'success');
}

/**
 * Prompt to import pricing configuration from a JSON file
 */
export function importPricingPrompt() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const modelPricingConfig = getModelPricingConfig();
        const merged = { ...modelPricingConfig, ...imported };
        setModelPricingConfig(merged);
        await savePricingConfig();
        renderPricingModels();
        toast(`Imported pricing for ${Object.keys(imported).length} models`, 'success');
      } catch (err) {
        toast('Failed to import: Invalid JSON file', 'error');
      }
    }
  };
  input.click();
}
