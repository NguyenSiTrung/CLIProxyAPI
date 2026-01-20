/**
 * API Keys Page Module
 * Handles access keys and provider API keys management (Gemini, Claude, Codex)
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, closeModal } from '../core/modal.js';
import { 
  getModelPricingConfig,
  setModelPricingConfig,
  isPricingConfigLoaded,
  setPricingConfigLoaded
} from '../core/state.js';

// Track revealed keys state
let revealedKeys = {};

// Cache cost limits data for cross-tab state tracking
let costLimitsCache = null;

// Default pricing for well-known models (prices per 1M tokens in USD)
const DEFAULT_MODEL_PRICING = {
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
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, cached_input: 0.08 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cached_input: 1.50 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, cached_input: 0.03 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cached_input: 0.30 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, cached_input: 1.50 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00, cached_input: 0.3125 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30, cached_input: 0.01875 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40, cached_input: 0.025 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00, cached_input: 0.125 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60, cached_input: 0.0375 },
  'deepseek-chat': { input: 0.14, output: 0.28, cached_input: 0.014 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
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
 * Calculate cost for an API key from usage data
 */
function calculateCostFromUsage(apiKey, usageData) {
  if (!usageData || !usageData.apis) return 0;
  
  const apiStats = usageData.apis[apiKey];
  if (!apiStats) return 0;
  
  const pricingConfig = getModelPricingConfig();
  let totalCost = 0;
  
  const providerModels = apiStats.models || {};
  for (const [modelName, modelStats] of Object.entries(providerModels)) {
    if (!modelStats || typeof modelStats !== 'object') continue;
    const details = modelStats.details || [];
    let modelInput = 0, modelOutput = 0, modelCached = 0;
    for (const detail of details) {
      const t = detail.tokens || {};
      modelInput += (t.input_tokens || 0);
      modelOutput += (t.output_tokens || 0);
      // Handle both cached_tokens and cache_read_input_tokens field names
      modelCached += (t.cached_tokens || t.cache_read_input_tokens || 0);
    }
    const pricing = pricingConfig[modelName] || getDefaultPricing(modelName);
    if (pricing) {
      const nonCachedInput = Math.max(0, modelInput - modelCached);
      const inputCost = (nonCachedInput / 1000000) * (pricing.input || 0);
      const outputCost = (modelOutput / 1000000) * (pricing.output || 0);
      const cachedCost = (modelCached / 1000000) * (pricing.cached_input || pricing.input * 0.1 || 0);
      totalCost += inputCost + outputCost + cachedCost;
    }
  }
  
  return totalCost;
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
 * Generate a cryptographically secure 32-character alphanumeric key
 * @returns {string} A 32-character random alphanumeric string (A-Z, a-z, 0-9)
 */
export function generateRandomKey() {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = 32;
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}

/**
 * Load all API keys and render them
 */
export async function loadKeys() {
  try {
    const [a, g, c, x, limitsData] = await Promise.all([
      api('GET', '/api-keys').catch(() => ({})),
      api('GET', '/gemini-api-key').catch(() => ({})),
      api('GET', '/claude-api-key').catch(() => ({})),
      api('GET', '/codex-api-key').catch(() => ({})),
      api('GET', '/access-key-limits').catch(() => ({}))
    ]);

    // Update cost limits cache
    costLimitsCache = limitsData;

    const accessKeys = a['api-keys'] || [];
    const geminiKeys = g['gemini-api-key'] || [];
    const claudeKeys = c['claude-api-key'] || [];
    const codexKeys = x['codex-api-key'] || [];

    renderKeyList('accessKeysList', accessKeys, 'access');
    renderKeyList('geminiKeysList', geminiKeys, 'gemini');
    renderKeyList('claudeKeysList', claudeKeys, 'claude');
    renderKeyList('codexKeysList', codexKeys, 'codex');

    // Update key counts in section headers
    const accessKeyCountEl = document.getElementById('accessKeyCount');
    const geminiKeyCountEl = document.getElementById('geminiKeyCount');
    const claudeKeyCountEl = document.getElementById('claudeKeyCount');
    const codexKeyCountEl = document.getElementById('codexKeyCount');

    if (accessKeyCountEl) accessKeyCountEl.textContent = `${accessKeys.length} key${accessKeys.length !== 1 ? 's' : ''}`;
    if (geminiKeyCountEl) geminiKeyCountEl.textContent = `${geminiKeys.length} key${geminiKeys.length !== 1 ? 's' : ''}`;
    if (claudeKeyCountEl) claudeKeyCountEl.textContent = `${claudeKeys.length} key${claudeKeys.length !== 1 ? 's' : ''}`;
    if (codexKeyCountEl) codexKeyCountEl.textContent = `${codexKeys.length} key${codexKeys.length !== 1 ? 's' : ''}`;

    // Update tab badges
    const accessTabBadge = document.getElementById('accessTabBadge');
    const geminiTabBadge = document.getElementById('geminiTabBadge');
    const claudeTabBadge = document.getElementById('claudeTabBadge');
    const codexTabBadge = document.getElementById('codexTabBadge');

    if (accessTabBadge) accessTabBadge.textContent = accessKeys.length;
    if (geminiTabBadge) geminiTabBadge.textContent = geminiKeys.length;
    if (claudeTabBadge) claudeTabBadge.textContent = claudeKeys.length;
    if (codexTabBadge) codexTabBadge.textContent = codexKeys.length;
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Get key type info for display
 */
function getKeyTypeInfo(type) {
  const info = {
    access: { name: 'Access', hint: 'Used for authenticating API requests to this proxy', prefix: '' },
    gemini: { name: 'Gemini', hint: 'Google AI Studio key starting with AIza...', prefix: 'AIza' },
    claude: { name: 'Claude', hint: 'Anthropic key starting with sk-ant-...', prefix: 'sk-ant-' },
    codex: { name: 'Codex', hint: 'OpenAI Codex key starting with sk-...', prefix: 'sk-' }
  };
  return info[type] || info.access;
}

/**
 * Render a list of keys
 */
function renderKeyList(id, keys, type) {
  const container = document.getElementById(id);
  if (!container) return;

  const typeInfo = getKeyTypeInfo(type);
  const isAccessKey = type === 'access';

  if (!keys.length) {
    container.innerHTML = `
      <div class="keys-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
        <h4>No ${typeInfo.name} Keys</h4>
        <p>Add your first API key to get started. Keys are stored securely and used for authentication.</p>
        <button class="btn btn-secondary btn-sm" onclick="window.keysModule.openAddKeyModal('${type}')" style="margin-top:16px">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Key
        </button>
      </div>`;
    return;
  }

  // Get cost limits map for access keys
  const limitsMap = isAccessKey ? getCostLimitsMap() : {};

  container.innerHTML = keys.map((k, i) => {
    const fullKey = typeof k === 'string' ? k : (k.key || k.api_key || JSON.stringify(k));
    const maskedKey = fullKey.length > 12 ? fullKey.slice(0, 6) + '••••••••' + fullKey.slice(-4) : '••••••••';
    const keyMeta = typeof k === 'object' ? (k.project || k.name || typeInfo.name + ' Key') : typeInfo.name + ' Key #' + (i + 1);
    const keyId = type + '-' + i;
    const isRevealed = revealedKeys[keyId];
    const displayKey = isRevealed ? fullKey : maskedKey;
    const escapedKey = fullKey.replace(/'/g, "\\'").replace(/"/g, '\\"');

    // For access keys, check if has cost limit
    const keyHasLimit = isAccessKey && limitsMap[fullKey] !== undefined;
    const limitBadge = keyHasLimit ? '<span class="key-limit-badge" title="Cost limit configured">$</span>' : '';
    const limitButtonLabel = keyHasLimit ? 'Edit Limit' : 'Set Limit';
    const limitButtonOnclick = keyHasLimit 
      ? `window.keysModule.openEditLimitModal('${escapedKey}', ${limitsMap[fullKey]?.max_cost || 0})`
      : `window.keysModule.openAddLimitForKeyModal('${escapedKey}')`;
    const limitButton = isAccessKey ? `
      <button class="key-action-btn limit${keyHasLimit ? ' has-limit' : ''}" onclick="${limitButtonOnclick}" title="${limitButtonLabel}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>${limitButtonLabel}
      </button>` : '';

    return '<div class="key-card">' +
      '<span class="key-index">' + (i + 1) + '</span>' +
      '<div class="key-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg></div>' +
      '<div class="key-info">' +
      '<div class="key-value-wrapper">' +
      '<div class="key-value ' + (isRevealed ? 'revealed' : '') + '" id="key-display-' + keyId + '">' + displayKey + '</div>' +
      limitBadge +
      '</div>' +
      '<div class="key-meta">' + keyMeta + '</div>' +
      '</div>' +
      '<div class="key-actions">' +
      '<button class="key-action-btn reveal" onclick="window.keysModule.toggleKeyReveal(\'' + keyId + '\', \'' + escapedKey + '\', \'' + maskedKey + '\')" title="' + (isRevealed ? 'Hide' : 'Reveal') + ' key">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      (isRevealed ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>' : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>') +
      '</svg>' +
      '</button>' +
      limitButton +
      '<button class="key-action-btn copy" onclick="window.keysModule.copyKey(\'' + escapedKey + '\')">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy' +
      '</button>' +
      '<button class="key-action-btn delete" onclick="window.keysModule.confirmDeleteKey(\'' + type + '\', ' + i + ')">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete' +
      '</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

/**
 * Toggle key visibility
 */
export function toggleKeyReveal(keyId, fullKey, maskedKey) {
  revealedKeys[keyId] = !revealedKeys[keyId];
  const displayEl = document.getElementById('key-display-' + keyId);
  if (displayEl) {
    displayEl.textContent = revealedKeys[keyId] ? fullKey : maskedKey;
    displayEl.classList.toggle('revealed', revealedKeys[keyId]);
  }
  loadKeys();
}

/**
 * Copy key to clipboard
 */
export function copyKey(text) {
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

/**
 * Handle Generate button click - generates random key and sets input value
 * Provides visual feedback via highlight animation
 */
export function handleGenerateKey() {
  const key = generateRandomKey();
  const input = document.getElementById('newKeyValue');
  if (input) {
    input.value = key;
    
    // Remove class first to reset animation if button is clicked multiple times
    input.classList.remove('key-generated');
    // Force reflow to restart animation
    void input.offsetWidth;
    // Add highlight class for visual feedback
    input.classList.add('key-generated');
    
    input.focus();
    
    // Remove highlight class after animation completes (keep subtle glow)
    setTimeout(() => {
      input.classList.remove('key-generated');
    }, 2000);
  }
}

/**
 * Open modal to add a new key
 */
export function openAddKeyModal(type) {
  const typeInfo = getKeyTypeInfo(type);
  const isAccessKey = type === 'access';
  
  // Generate button HTML - only for access keys
  const generateButtonHtml = isAccessKey ? `
    <button type="button" class="btn btn-secondary" onclick="window.keysModule.handleGenerateKey()" title="Generate random key" style="margin-left: 8px; padding: 8px 12px;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </button>` : '';
  
  const content = `
    <div class="key-format-hint">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      <span>${typeInfo.hint}</span>
    </div>
    <div class="form-group">
      <label>API Key</label>
      <div style="display: flex; align-items: center;">
        <input type="text" id="newKeyValue" class="form-input" placeholder="${typeInfo.prefix ? 'e.g. ' + typeInfo.prefix + '...' : 'Enter your API key'}" autocomplete="off" spellcheck="false" style="flex: 1;">
        ${generateButtonHtml}
      </div>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.keysModule.addApiKey('${type}')">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add Key
    </button>`;

  showModal(`Add ${typeInfo.name} Key`, content, footer);
  setTimeout(() => document.getElementById('newKeyValue')?.focus(), 100);
}

/**
 * Add a new API key
 */
export async function addApiKey(type) {
  const v = document.getElementById('newKeyValue').value.trim();
  if (!v) {
    toast('Please enter an API key', 'error');
    return;
  }

  try {
    const epMap = {
      access: '/api-keys',
      gemini: '/gemini-api-key',
      claude: '/claude-api-key',
      codex: '/codex-api-key'
    };
    const ep = epMap[type];

    await api('PATCH', ep, { old: '', new: v });
    closeModal();
    toast('API key added successfully', 'success');
    loadKeys();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Show confirmation dialog for key deletion
 */
export function confirmDeleteKey(type, idx) {
  const typeInfo = getKeyTypeInfo(type);
  
  const content = `
    <div style="text-align:center; padding: 24px 0;">
      <div style="width:64px; height:64px; background:rgba(248, 113, 113, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </div>
      <h4 style="margin-bottom:8px; font-size:18px;">Delete ${typeInfo.name} Key #${idx + 1}?</h4>
      <p style="color:var(--text-secondary); font-size:14px; max-width:300px; margin:0 auto;">This action cannot be undone. The key will be permanently removed from your configuration.</p>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="window.keysModule.deleteApiKey('${type}', ${idx})">Yes, Delete</button>`;

  showModal('Delete API Key', content, footer);
}

/**
 * Delete an API key
 */
export async function deleteApiKey(type, idx) {
  try {
    const epMap = {
      access: '/api-keys',
      gemini: '/gemini-api-key',
      claude: '/claude-api-key',
      codex: '/codex-api-key'
    };
    const ep = epMap[type];
    await api('DELETE', `${ep}?index=${idx}`);
    closeModal();
    toast('API key deleted successfully', 'success');
    loadKeys();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Setup keys tab switching handlers
 */
export function setupKeysTabHandlers() {
  document.querySelectorAll('.keys-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.keys-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.keys-content').forEach(c => c.classList.remove('active'));
      const tabId = tab.dataset.keytab;
      const content = document.getElementById(`keytab-${tabId}`);
      if (content) content.classList.add('active');
      
      // Load cost limits when switching to cost limits tab
      if (tabId === 'costlimits') {
        loadCostLimits();
      }
    });
  });
}

/**
 * Load cost limits data and render the list
 */
export async function loadCostLimits() {
  try {
    // Load pricing config first if not loaded
    await loadPricingConfig();
    
    // Fetch cost limits and usage data in parallel
    // Note: /usage returns { usage: { apis: ... } }, we need the inner .usage object
    const [limitsData, usageResponse] = await Promise.all([
      api('GET', '/access-key-limits').catch(() => ({ enabled: false, keys: [] })),
      api('GET', '/usage').catch(() => ({ usage: { apis: {} } }))
    ]);
    
    // Extract the usage object (endpoint returns { usage: snapshot })
    const usageData = usageResponse.usage || { apis: {} };
    
    // Merge calculated costs from usage data into limits data
    const enhancedData = {
      ...limitsData,
      keys: (limitsData.keys || []).map(keyInfo => {
        const calculatedCost = calculateCostFromUsage(keyInfo.api_key, usageData);
        return {
          ...keyInfo,
          current_cost: calculatedCost > 0 ? calculatedCost : keyInfo.current_cost
        };
      })
    };
    
    // Update cache for cross-tab state tracking
    costLimitsCache = enhancedData;
    renderCostLimitsList(enhancedData);
  } catch (e) {
    const container = document.getElementById('costLimitsList');
    if (container) {
      container.innerHTML = `
        <div class="keys-empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h4>Unable to Load Cost Limits</h4>
          <p>${e.message || 'Failed to fetch cost limits data'}</p>
        </div>`;
    }
  }
}

/**
 * Get cost limits map (apiKey -> limitData) from cache
 * @returns {Object} Map of apiKey to limit data
 */
export function getCostLimitsMap() {
  const map = {};
  if (costLimitsCache && costLimitsCache.keys) {
    costLimitsCache.keys.forEach(limit => {
      map[limit.api_key] = limit;
    });
  }
  return map;
}

/**
 * Check if an API key has an existing cost limit
 * @param {string} apiKey - The API key to check
 * @returns {boolean} True if the key has an existing limit
 */
export function hasExistingLimit(apiKey) {
  const map = getCostLimitsMap();
  return map[apiKey] !== undefined;
}

/**
 * Refresh cost limits (alias for loadCostLimits with loading animation)
 */
export async function refreshCostLimits() {
  const refreshBtn = document.getElementById('costLimitsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }
  try {
    await loadCostLimits();
    toast('Cost limits refreshed', 'success');
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Refresh all cost-related data across tabs
 * Call this after adding/editing/resetting a limit to keep both tabs in sync
 */
export async function refreshAllCostData() {
  await loadCostLimits();
  await loadKeys();
}

/**
 * Mask API key for display (show last 4 chars)
 */
function maskApiKey(key) {
  if (!key || key.length <= 4) return '••••' + (key || '');
  return '••••' + key.slice(-4);
}

/**
 * Get usage percentage and color class
 */
function getUsageInfo(currentCost, maxCost) {
  if (!maxCost || maxCost === 0) {
    return { percentage: 0, colorClass: '', isUnlimited: true };
  }
  const percentage = Math.min((currentCost / maxCost) * 100, 100);
  let colorClass = 'usage-green';
  if (percentage >= 90) {
    colorClass = 'usage-red';
  } else if (percentage >= 70) {
    colorClass = 'usage-yellow';
  }
  return { percentage, colorClass, isUnlimited: false };
}

/**
 * Get request usage percentage and color class
 */
function getRequestUsageInfo(currentRequests, maxRequests) {
  if (!maxRequests || maxRequests === 0) {
    return { percentage: 0, colorClass: '', isUnlimited: true };
  }
  const percentage = Math.min((currentRequests / maxRequests) * 100, 100);
  let colorClass = 'usage-green';
  if (percentage >= 90) {
    colorClass = 'usage-red';
  } else if (percentage >= 70) {
    colorClass = 'usage-yellow';
  }
  return { percentage, colorClass, isUnlimited: false };
}

function formatAutoResetInterval(interval) {
  if (!interval || interval === 'none') {
    return '—';
  }
  switch (interval) {
    case 'hourly':
      return 'Hourly';
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    default:
      return `Every ${interval}`;
  }
}

function normalizeAutoResetInterval(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return 'none';
  }
  const normalized = trimmed.toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return `${normalized}h`;
  }
  return normalized;
}

/**
 * Render cost limits list
 */
function renderCostLimitsList(data) {
  const container = document.getElementById('costLimitsList');
  if (!container) return;

  const keys = data.keys || [];
  const enabled = data.enabled;
  
  // Update key count
  const keyCountEl = document.getElementById('costLimitsKeyCount');
  if (keyCountEl) {
    keyCountEl.textContent = `${keys.length} key${keys.length !== 1 ? 's' : ''}`;
  }

  if (!enabled) {
    container.innerHTML = `
      <div class="keys-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <h4>Cost Limits Disabled</h4>
        <p>Enable cost limits in Configuration to track and limit API costs per key.</p>
      </div>`;
    return;
  }

  if (!keys.length) {
    container.innerHTML = `
      <div class="keys-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <h4>No Cost Data</h4>
        <p>Cost data will appear here once API keys start making requests.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="cost-limits-table-container">
      <table class="cost-limits-table">
        <thead>
          <tr>
            <th>API Key</th>
            <th>Cost Limit</th>
            <th>Request Limit</th>
            <th>Auto-Reset</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="costLimitsTableBody">
        </tbody>
      </table>
    </div>`;

  const tbody = document.getElementById('costLimitsTableBody');
  keys.forEach((keyInfo, idx) => {
    const { api_key, max_cost, current_cost, max_requests, current_requests, auto_reset_interval, next_reset_time } = keyInfo;
    const maskedKey = maskApiKey(api_key);
    const usageInfo = getUsageInfo(current_cost, max_cost);
    const requestUsageInfo = getRequestUsageInfo(current_requests || 0, max_requests || 0);
    const isCostBlocked = max_cost > 0 && current_cost >= max_cost;
    const isRequestBlocked = max_requests > 0 && (current_requests || 0) >= max_requests;
    const isBlocked = isCostBlocked || isRequestBlocked;
    
    // Format auto-reset display
    let autoResetDisplay = formatAutoResetInterval(auto_reset_interval);
    if (auto_reset_interval && auto_reset_interval !== 'none' && next_reset_time) {
      try {
        const nextReset = new Date(next_reset_time);
        autoResetDisplay += `<br><span class="next-reset-time">${nextReset.toLocaleDateString()}</span>`;
      } catch (e) { /* ignore */ }
    }
    
    const row = document.createElement('tr');
    row.className = isBlocked ? 'cost-limit-blocked' : '';
    row.innerHTML = `
      <td>
        <div class="cost-limit-key">
          <span class="key-masked">${maskedKey}</span>
          ${isBlocked ? `<span class="badge badge-blocked">${isCostBlocked ? 'Cost' : 'Requests'}</span>` : ''}
        </div>
      </td>
      <td>
        <div class="limit-cell">
          <span class="cost-value">${usageInfo.isUnlimited ? '∞' : '$' + max_cost.toFixed(2)}</span>
          <span class="current-value">$${current_cost.toFixed(2)}</span>
          ${usageInfo.isUnlimited ? '' : `
          <div class="usage-bar-mini">
            <div class="usage-bar ${usageInfo.colorClass}" style="width: ${usageInfo.percentage}%"></div>
          </div>
          `}
        </div>
      </td>
      <td>
        <div class="limit-cell">
          <span class="cost-value">${requestUsageInfo.isUnlimited ? '∞' : max_requests.toLocaleString()}</span>
          <span class="current-value">${(current_requests || 0).toLocaleString()}</span>
          ${requestUsageInfo.isUnlimited ? '' : `
          <div class="usage-bar-mini">
            <div class="usage-bar ${requestUsageInfo.colorClass}" style="width: ${requestUsageInfo.percentage}%"></div>
          </div>
          `}
        </div>
      </td>
      <td>
        <span class="auto-reset-cell">${autoResetDisplay}</span>
      </td>
      <td>
        <div class="cost-limit-actions">
          <button class="btn btn-xs btn-secondary" onclick="window.keysModule.openEditLimitModal('${api_key}', ${max_cost}, ${max_requests || 0}, '${auto_reset_interval || ''}')" title="Edit limit">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button class="btn btn-xs btn-warning" onclick="window.keysModule.confirmResetCost('${api_key}', '${maskedKey}')" title="Reset">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Reset
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Open modal to edit cost limit for a key
 */
export function openEditLimitModal(apiKey, currentMaxCost, currentMaxRequests = 0, currentAutoReset = '') {
  const maskedKey = maskApiKey(apiKey);
  const isCostUnlimited = !currentMaxCost || currentMaxCost === 0;
  const isRequestsUnlimited = !currentMaxRequests || currentMaxRequests === 0;
  const autoResetValue = currentAutoReset || 'none';
  
  const content = `
    <div class="form-group">
      <label>API Key</label>
      <div class="key-display">${maskedKey}</div>
    </div>
    <div class="form-row">
      <div class="form-group form-group-half">
        <label>Maximum Cost (USD)</label>
        <input type="number" id="editMaxCost" class="form-input" step="0.01" min="0" value="${isCostUnlimited ? '' : currentMaxCost.toFixed(2)}" placeholder="0 = unlimited">
      </div>
      <div class="form-group form-group-half">
        <label>Maximum Requests</label>
        <input type="number" id="editMaxRequests" class="form-input" step="1" min="0" value="${isRequestsUnlimited ? '' : currentMaxRequests}" placeholder="0 = unlimited">
      </div>
    </div>
    <div class="form-group">
      <label>Auto-Reset Interval</label>
      <input type="text" id="editAutoReset" class="form-input" list="editAutoResetOptions" value="${autoResetValue}" placeholder="none, hourly, daily, weekly, monthly, or 5h">
      <datalist id="editAutoResetOptions">
        <option value="none"></option>
        <option value="hourly"></option>
        <option value="daily"></option>
        <option value="weekly"></option>
        <option value="monthly"></option>
        <option value="5h"></option>
      </datalist>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.keysModule.saveEditLimit('${apiKey}')">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save
    </button>`;

  showModal('Edit Limit', content, footer);
}

/**
 * Save edited cost limit
 */
export async function saveEditLimit(apiKey) {
  const maxCostEl = document.getElementById('editMaxCost');
  const maxRequestsEl = document.getElementById('editMaxRequests');
  const autoResetEl = document.getElementById('editAutoReset');
  
  const maxCost = parseFloat(maxCostEl?.value || '0') || 0;
  const maxRequests = parseInt(maxRequestsEl?.value || '0', 10) || 0;
  const autoResetInterval = normalizeAutoResetInterval(autoResetEl?.value);

  try {
    await api('PUT', `/access-key-limits/keys/${encodeURIComponent(apiKey)}`, { 
      max_cost: maxCost,
      max_requests: maxRequests,
      auto_reset_interval: autoResetInterval
    });
    closeModal();
    toast('Limit updated successfully', 'success');
    refreshAllCostData();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Show confirmation dialog for resetting cost
 */
export function confirmResetCost(apiKey, maskedKey) {
  const content = `
    <div style="text-align:center; padding: 24px 0;">
      <div style="width:64px; height:64px; background:rgba(251, 191, 36, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </div>
      <h4 style="margin-bottom:8px; font-size:18px;">Reset Accumulated Cost?</h4>
      <p style="color:var(--text-secondary); font-size:14px; max-width:300px; margin:0 auto;">Reset accumulated cost for <strong>${maskedKey}</strong> to $0.00?</p>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-warning" onclick="window.keysModule.resetCost('${apiKey}')">Yes, Reset</button>`;

  showModal('Reset Cost', content, footer);
}

/**
 * Reset accumulated cost for a key
 */
export async function resetCost(apiKey) {
  try {
    await api('POST', `/access-key-limits/keys/${encodeURIComponent(apiKey)}/reset`);
    closeModal();
    toast('Cost reset successfully', 'success');
    refreshAllCostData();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Show confirmation dialog for resetting ALL cost limits
 */
export function confirmResetAllCostLimits() {
  const content = `
    <div style="text-align:center; padding: 24px 0;">
      <div style="width:64px; height:64px; background:rgba(251, 191, 36, 0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto;">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </div>
      <h4 style="margin-bottom:8px; font-size:18px;">Reset All Quotas?</h4>
      <p style="color:var(--text-secondary); font-size:14px; max-width:300px; margin:0 auto;">This will reset accumulated cost and request count for <strong>ALL</strong> API keys to zero.</p>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-warning" onclick="window.keysModule.resetAllCostLimits()">Yes, Reset All</button>`;

  showModal('Reset All Quotas', content, footer);
}

/**
 * Reset all cost limits for all keys
 */
export async function resetAllCostLimits() {
  try {
    const response = await api('POST', '/access-key-limits/reset-all');
    closeModal();
    const count = response.keys_reset || 0;
    toast(`Successfully reset ${count} key(s)`, 'success');
    refreshAllCostData();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Open modal to add a new cost limit (shows key dropdown)
 */
export async function openAddLimitModal() {
  try {
    // Fetch both access keys and existing limits in parallel
    const [keysResponse, limitsResponse] = await Promise.all([
      api('GET', '/api-keys').catch(() => ({})),
      api('GET', '/access-key-limits/keys').catch(() => ({}))
    ]);

    const accessKeys = keysResponse['api-keys'] || [];
    const existingLimits = limitsResponse.keys || [];

    if (!accessKeys.length) {
      toast('No access keys found. Add an access key first.', 'error');
      return;
    }

    // Build map of existing limits (apiKey -> limitData)
    const limitsMap = {};
    existingLimits.forEach(limit => {
      limitsMap[limit.api_key] = limit;
    });

    // Build dropdown options
    const options = accessKeys.map(key => {
      const maskedKey = maskApiKey(key);
      const hasLimit = limitsMap[key] !== undefined;
      const indicator = hasLimit ? ' ✓ has limit' : '';
      return `<option value="${key}" data-has-limit="${hasLimit}">${maskedKey}${indicator}</option>`;
    }).join('');

    const content = `
      <div class="form-group">
        <label>Select Access Key</label>
        <select id="limitKeySelect" class="form-input">
          <option value="">-- Select a key --</option>
          ${options}
        </select>
      </div>
      <div id="limitKeyHint" class="key-format-hint" style="display:none;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span id="limitKeyHintText"></span>
      </div>`;

    const footer = `
      <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="proceedLimitBtn" onclick="window.keysModule.proceedWithLimitSelection()" disabled>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        Continue
      </button>`;

    showModal('Add Cost Limit', content, footer);

    // Setup change handler for dropdown
    const select = document.getElementById('limitKeySelect');
    select?.addEventListener('change', () => {
      const selectedKey = select.value;
      const btn = document.getElementById('proceedLimitBtn');
      const hint = document.getElementById('limitKeyHint');
      const hintText = document.getElementById('limitKeyHintText');
      
      if (selectedKey) {
        btn.disabled = false;
        const hasLimit = limitsMap[selectedKey] !== undefined;
        if (hasLimit) {
          hint.style.display = 'flex';
          hintText.textContent = 'This key already has a limit. You will edit the existing limit.';
        } else {
          hint.style.display = 'flex';
          hintText.textContent = 'This key has no limit. You will create a new limit.';
        }
      } else {
        btn.disabled = true;
        hint.style.display = 'none';
      }
    });
  } catch (e) {
    toast('Failed to load keys: ' + e.message, 'error');
  }
}

// Store limits map for use in proceedWithLimitSelection
let _limitsMapCache = null;

/**
 * Handle proceed button click from add limit modal
 */
export async function proceedWithLimitSelection() {
  const select = document.getElementById('limitKeySelect');
  const selectedKey = select?.value;
  
  if (!selectedKey) {
    toast('Please select a key', 'error');
    return;
  }

  closeModal();

  // Re-fetch limits to check if key has limit
  try {
    const limitsResponse = await api('GET', '/access-key-limits/keys').catch(() => ({}));
    const existingLimits = limitsResponse.keys || [];
    const limitsMap = {};
    existingLimits.forEach(limit => {
      limitsMap[limit.api_key] = limit;
    });

    const existingLimit = limitsMap[selectedKey];
    if (existingLimit) {
      // Open edit modal with existing values
      openEditLimitModal(selectedKey, existingLimit.max_cost);
    } else {
      // Open add modal for new limit
      openAddLimitForKeyModal(selectedKey);
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Open modal to add cost limit for a specific key (no existing limit)
 */
export function openAddLimitForKeyModal(apiKey) {
  const maskedKey = maskApiKey(apiKey);
  
  const content = `
    <div class="form-group">
      <label>API Key</label>
      <div class="key-display">${maskedKey}</div>
    </div>
    <div class="form-row">
      <div class="form-group form-group-half">
        <label>Maximum Cost (USD)</label>
        <input type="number" id="newMaxCost" class="form-input" step="0.01" min="0" value="" placeholder="0 = unlimited">
      </div>
      <div class="form-group form-group-half">
        <label>Maximum Requests</label>
        <input type="number" id="newMaxRequests" class="form-input" step="1" min="0" value="" placeholder="0 = unlimited">
      </div>
    </div>
    <div class="form-group">
      <label>Auto-Reset Interval</label>
      <input type="text" id="newAutoReset" class="form-input" list="newAutoResetOptions" value="none" placeholder="none, hourly, daily, weekly, monthly, or 5h">
      <datalist id="newAutoResetOptions">
        <option value="none"></option>
        <option value="hourly"></option>
        <option value="daily"></option>
        <option value="weekly"></option>
        <option value="monthly"></option>
        <option value="5h"></option>
      </datalist>
    </div>`;

  const footer = `
    <button class="btn btn-secondary" onclick="window.closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.keysModule.saveNewLimit('${apiKey}')">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add Limit
    </button>`;

  showModal('Add Limit', content, footer);
  setTimeout(() => document.getElementById('newMaxCost')?.focus(), 100);
}

/**
 * Save new cost limit for a key
 */
export async function saveNewLimit(apiKey) {
  const maxCostEl = document.getElementById('newMaxCost');
  const maxRequestsEl = document.getElementById('newMaxRequests');
  const autoResetEl = document.getElementById('newAutoReset');
  
  const maxCost = parseFloat(maxCostEl?.value || '0') || 0;
  const maxRequests = parseInt(maxRequestsEl?.value || '0', 10) || 0;
  const autoResetInterval = normalizeAutoResetInterval(autoResetEl?.value);

  if (maxCost === 0 && maxRequests === 0 && autoResetInterval === 'none') {
    toast('Please set at least one limit or auto-reset interval', 'error');
    return;
  }

  try {
    await api('PUT', `/access-key-limits/keys/${encodeURIComponent(apiKey)}`, { 
      max_cost: maxCost,
      max_requests: maxRequests,
      auto_reset_interval: autoResetInterval
    });
    closeModal();
    toast('Limit added successfully', 'success');
    refreshAllCostData();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

// Export module interface for global access
export const keysModule = {
  loadKeys,
  openAddKeyModal,
  addApiKey,
  deleteApiKey,
  confirmDeleteKey,
  toggleKeyReveal,
  copyKey,
  setupKeysTabHandlers,
  generateRandomKey,
  handleGenerateKey,
  loadCostLimits,
  refreshCostLimits,
  refreshAllCostData,
  getCostLimitsMap,
  hasExistingLimit,
  openEditLimitModal,
  saveEditLimit,
  confirmResetCost,
  resetCost,
  confirmResetAllCostLimits,
  resetAllCostLimits,
  openAddLimitModal,
  proceedWithLimitSelection,
  openAddLimitForKeyModal,
  saveNewLimit
};

// Expose functions to window for HTML onclick handlers
window.keysModule = keysModule;
window.loadKeys = loadKeys;
window.openAddKeyModal = openAddKeyModal;
