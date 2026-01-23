/**
 * Models Page Module
 * Handles model listing, filtering, provider grouping, and pricing configuration
 * Enhanced with favorites, grid/list views, sorting, keyboard shortcuts, and cost calculator
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

// Track current load request for race condition prevention
let currentModelsLoadId = 0;
let currentModelsAbort = null;

// UI State
let currentView = 'grouped'; // 'grouped', 'grid', 'list'
let currentSort = 'name-asc'; // 'name-asc', 'name-desc', 'provider', 'favorites'
let showFavoritesOnly = false;
let favoriteModels = new Set();

// LocalStorage keys
const STORAGE_KEY_FAVORITES = 'cliproxy_model_favorites';
const STORAGE_KEY_VIEW = 'cliproxy_models_view';
const STORAGE_KEY_SORT = 'cliproxy_models_sort';

/**
 * Initialize favorites from localStorage
 */
function initFavorites() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FAVORITES);
    if (stored) {
      favoriteModels = new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.warn('Failed to load favorites from localStorage:', e);
    favoriteModels = new Set();
  }
  updateFavoritesCount();
}

/**
 * Save favorites to localStorage
 */
function saveFavorites() {
  try {
    localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify([...favoriteModels]));
  } catch (e) {
    console.warn('Failed to save favorites to localStorage:', e);
  }
}

/**
 * Toggle a model as favorite
 */
export function toggleFavorite(modelId, event) {
  if (event) {
    event.stopPropagation();
  }
  
  if (favoriteModels.has(modelId)) {
    favoriteModels.delete(modelId);
    toast(`Removed ${modelId} from favorites`, 'info');
  } else {
    favoriteModels.add(modelId);
    toast(`Added ${modelId} to favorites`, 'success');
  }
  
  saveFavorites();
  updateFavoritesCount();
  
  // Re-render if needed
  if (showFavoritesOnly || currentSort === 'favorites') {
    filterModels();
  } else {
    // Just update the visual state of favorite buttons
    updateFavoriteButtons(modelId);
  }
}

/**
 * Update favorite button states for a specific model
 */
function updateFavoriteButtons(modelId) {
  const isFav = favoriteModels.has(modelId);
  document.querySelectorAll(`[data-model-id="${modelId}"]`).forEach(el => {
    el.classList.toggle('is-favorite', isFav);
    const favBtn = el.querySelector('.favorite-btn, .btn-favorite, .model-row-favorite');
    if (favBtn) {
      favBtn.classList.toggle('favorited', isFav);
      favBtn.classList.toggle('active', isFav);
    }
  });
}

/**
 * Update favorites count in UI
 */
function updateFavoritesCount() {
  const countEl = document.getElementById('modelsFavoritesCount');
  if (countEl) {
    countEl.textContent = favoriteModels.size;
  }
}

/**
 * Toggle favorites-only filter
 */
export function toggleFavoritesFilter() {
  showFavoritesOnly = !showFavoritesOnly;
  const btn = document.getElementById('modelsFavoritesBtn');
  if (btn) {
    btn.classList.toggle('active', showFavoritesOnly);
  }
  filterModels();
}

/**
 * Set the current view mode
 */
export function setModelsView(view) {
  currentView = view;
  try {
    localStorage.setItem(STORAGE_KEY_VIEW, view);
  } catch (e) {}
  
  // Update toggle buttons
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  
  filterModels();
}

/**
 * Toggle sort dropdown
 */
export function toggleSortDropdown() {
  const dropdown = document.querySelector('.models-sort-dropdown');
  const sortBtn = document.getElementById('modelsSortBtn');
  if (dropdown) {
    const isOpen = dropdown.classList.toggle('open');
    // Update aria-expanded attribute for accessibility
    if (sortBtn) {
      sortBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }
}

/**
 * Set the current sort order
 */
export function setModelsSort(sort) {
  currentSort = sort;
  try {
    localStorage.setItem(STORAGE_KEY_SORT, sort);
  } catch (e) {}
  
  // Update sort options
  document.querySelectorAll('.sort-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.sort === sort);
  });
  
  // Update label
  const label = document.getElementById('modelsSortLabel');
  if (label) {
    const labels = {
      'name-asc': 'A-Z',
      'name-desc': 'Z-A',
      'provider': 'Provider',
      'favorites': 'Favorites'
    };
    label.textContent = labels[sort] || 'Sort';
  }
  
  // Close dropdown
  const dropdown = document.querySelector('.models-sort-dropdown');
  if (dropdown) {
    dropdown.classList.remove('open');
  }
  
  filterModels();
}

// Track if keyboard shortcuts have been initialized
let keyboardShortcutsInitialized = false;

/**
 * Initialize keyboard shortcuts for the models page
 */
export function initModelsKeyboardShortcuts() {
  if (keyboardShortcutsInitialized) return;
  keyboardShortcutsInitialized = true;
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Only handle if models page is active
    const modelsPage = document.getElementById('page-models');
    if (!modelsPage?.classList.contains('active')) return;
    
    // Don't handle if typing in an input
    if (e.target.matches('input, textarea, select')) return;
    
    switch (e.key.toLowerCase()) {
      case '/':
        e.preventDefault();
        document.getElementById('modelSearch')?.focus();
        break;
      case 'f':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          toggleFavoritesFilter();
        }
        break;
      case 'g':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const views = ['grouped', 'grid', 'list'];
          const nextIndex = (views.indexOf(currentView) + 1) % views.length;
          setModelsView(views[nextIndex]);
        }
        break;
      case '?':
        e.preventDefault();
        showKeyboardShortcutsModal();
        break;
      case 'escape':
        // Close sort dropdown if open
        const dropdown = document.querySelector('.models-sort-dropdown');
        if (dropdown?.classList.contains('open')) {
          dropdown.classList.remove('open');
          return;
        }
        // Clear search if focused
        const searchInput = document.getElementById('modelSearch');
        if (searchInput && document.activeElement === searchInput) {
          searchInput.blur();
          clearModelSearch();
        }
        break;
    }
  });
  
  // Click outside to close sort dropdown
  document.addEventListener('click', (e) => {
    const dropdown = document.querySelector('.models-sort-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });
}

/**
 * Show keyboard shortcuts modal
 */
function showKeyboardShortcutsModal() {
  const content = `
    <div style="padding: 20px;">
      <div style="display: grid; gap: 12px;">
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span><kbd style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; margin-right: 8px;">/</kbd> Focus search</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span><kbd style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; margin-right: 8px;">F</kbd> Toggle favorites filter</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span><kbd style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; margin-right: 8px;">G</kbd> Cycle view modes</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span><kbd style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; margin-right: 8px;">Esc</kbd> Clear search / Close</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px;">
          <span><kbd style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 4px; margin-right: 8px;">?</kbd> Show this help</span>
        </div>
      </div>
    </div>
  `;
  showModal('Keyboard Shortcuts', content);
}

/**
 * Load saved preferences
 */
function loadPreferences() {
  try {
    const savedView = localStorage.getItem(STORAGE_KEY_VIEW);
    if (savedView && ['grouped', 'grid', 'list'].includes(savedView)) {
      currentView = savedView;
    }
    const savedSort = localStorage.getItem(STORAGE_KEY_SORT);
    if (savedSort) {
      currentSort = savedSort;
    }
  } catch (e) {}
  
  // Update UI
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === currentView);
  });
  document.querySelectorAll('.sort-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.sort === currentSort);
  });
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Debounce a function call
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Validate a numeric pricing value
 * @param {*} value - Value to validate
 * @returns {boolean} True if valid
 */
function isValidPricingValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 1_000_000;
}

/**
 * Sanitize imported pricing data to prevent prototype pollution and invalid values
 * @param {*} raw - Raw imported data
 * @returns {Object} Sanitized pricing config
 */
function sanitizeImportedPricing(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid format: expected an object');
  }

  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
  const out = Object.create(null);

  for (const [key, value] of Object.entries(raw)) {
    if (!key || typeof key !== 'string') continue;
    if (DANGEROUS_KEYS.includes(key)) continue;
    if (key.length > 256) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const input = Number(value.input);
    const output = Number(value.output);
    const cached = value.cached_input == null ? undefined : Number(value.cached_input);
    const cacheWrite = value.cache_write == null ? undefined : Number(value.cache_write);

    if (!isValidPricingValue(input) || !isValidPricingValue(output)) continue;
    if (cached !== undefined && !isValidPricingValue(cached)) continue;
    if (cacheWrite !== undefined && !isValidPricingValue(cacheWrite)) continue;

    out[key] = {
      input,
      output,
      cached_input: cached,
      cache_write: cacheWrite
    };
  }

  return out;
}

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
 * Load the models page with race condition prevention and improved error handling
 */
export async function loadModels() {
  const loadId = ++currentModelsLoadId;
  
  if (currentModelsAbort) {
    currentModelsAbort.abort();
  }
  const abortController = new AbortController();
  currentModelsAbort = abortController;
  
  // Initialize favorites and preferences on first load
  initFavorites();
  loadPreferences();
  initModelsKeyboardShortcuts();
  
  const refreshBtn = document.getElementById('modelsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }

  const container = document.getElementById('modelsContainer');
  // Show skeleton loader instead of spinner
  container.innerHTML = `
    <div class="models-skeleton-loader">
      <div class="skeleton-provider-card">
        <div class="skeleton-header">
          <div class="skeleton-icon"></div>
          <div class="skeleton-title"></div>
          <div class="skeleton-count"></div>
        </div>
        <div class="skeleton-models">
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
        </div>
      </div>
      <div class="skeleton-provider-card">
        <div class="skeleton-header">
          <div class="skeleton-icon"></div>
          <div class="skeleton-title"></div>
          <div class="skeleton-count"></div>
        </div>
        <div class="skeleton-models">
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
        </div>
      </div>
      <div class="skeleton-provider-card">
        <div class="skeleton-header">
          <div class="skeleton-icon"></div>
          <div class="skeleton-title"></div>
          <div class="skeleton-count"></div>
        </div>
        <div class="skeleton-models">
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-badge"></div>
        </div>
      </div>
    </div>
  `;

  try {
    const cfg = await api('GET', '/config').catch(() => ({}));
    
    if (loadId !== currentModelsLoadId) return;
    
    setAccessApiKeys(cfg['api-keys'] || cfg.api_keys || []);
    const models = await fetchModels();
    
    if (loadId !== currentModelsLoadId) return;
    
    setAllModels(models);
    setCurrentProviderFilter('all');
    updateProviderFilters(models);
    renderModels(models);
  } catch (e) {
    if (abortController.signal.aborted) return;
    
    let errorTitle = 'Could not load models';
    let errorMessage = 'An unexpected error occurred.';
    
    if (e.message?.includes('401') || e.message?.includes('403') || e.message?.includes('auth')) {
      errorMessage = 'The /v1/models endpoint requires API authentication. Add access keys in the <strong>API Keys</strong> tab or check your auth files.';
    } else if (e.message?.includes('500') || e.message?.includes('server')) {
      errorTitle = 'Server error';
      errorMessage = 'The server returned an error. Please try again later.';
    } else if (e.message?.includes('network') || e.message?.includes('fetch') || e.name === 'TypeError') {
      errorTitle = 'Network error';
      errorMessage = 'Could not connect to the server. Please check your connection.';
    } else if (e.message?.includes('timeout')) {
      errorTitle = 'Request timeout';
      errorMessage = 'The request took too long. Please try again.';
    }
    
    console.error('Failed to load models:', e);
    
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h4>${escapeHtml(errorTitle)}</h4>
        <p>${errorMessage}</p>
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
 * Update the provider filter pills with O(n) counting and safe DOM operations
 * @param {Array} models - List of models
 */
export function updateProviderFilters(models) {
  const pillsContainer = document.getElementById('modelsFilterPills');
  pillsContainer.replaceChildren();
  
  const counts = new Map();
  for (const m of models) {
    const owner = m.owned_by || m.provider || 'other';
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  
  const createPill = (provider, isActive = false) => {
    const btn = document.createElement('button');
    btn.className = `models-filter-pill${isActive ? ' active' : ''}`;
    btn.dataset.provider = provider;
    btn.type = 'button';
    
    if (provider === 'all') {
      btn.textContent = 'All';
    } else {
      const text = document.createElement('span');
      text.textContent = provider;
      const count = document.createElement('span');
      count.style.opacity = '0.7';
      count.textContent = ` (${counts.get(provider) || 0})`;
      btn.append(text, count);
    }
    
    btn.addEventListener('click', () => filterModelsByProvider(provider));
    return btn;
  };
  
  pillsContainer.appendChild(createPill('all', true));
  [...counts.keys()].sort().forEach(provider => {
    pillsContainer.appendChild(createPill(provider));
  });
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
 * Sort models based on current sort setting
 * @param {Array} models - Models to sort
 * @returns {Array} Sorted models
 */
function sortModels(models) {
  const sorted = [...models];
  
  switch (currentSort) {
    case 'name-asc':
      sorted.sort((a, b) => (a.id || a.name || '').localeCompare(b.id || b.name || ''));
      break;
    case 'name-desc':
      sorted.sort((a, b) => (b.id || b.name || '').localeCompare(a.id || a.name || ''));
      break;
    case 'provider':
      sorted.sort((a, b) => {
        const provA = a.owned_by || a.provider || 'other';
        const provB = b.owned_by || b.provider || 'other';
        return provA.localeCompare(provB) || (a.id || '').localeCompare(b.id || '');
      });
      break;
    case 'favorites':
      sorted.sort((a, b) => {
        const aFav = favoriteModels.has(a.id || a.name) ? 0 : 1;
        const bFav = favoriteModels.has(b.id || b.name) ? 0 : 1;
        return aFav - bFav || (a.id || '').localeCompare(b.id || '');
      });
      break;
  }
  
  return sorted;
}

/**
 * Render the models list with support for grouped, grid, and list views
 * @param {Array} models - List of models to render
 */
export function renderModels(models) {
  const container = document.getElementById('modelsContainer');
  const countEl = document.getElementById('modelsTotalCount');

  // Sort models
  const sortedModels = sortModels(models);

  countEl.textContent = `${sortedModels.length} model${sortedModels.length !== 1 ? 's' : ''}`;

  if (!sortedModels.length) {
    container.className = 'models-grid-container';
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <h4>No models found</h4>
        <p>${showFavoritesOnly ? 'No favorite models yet. Click the star icon on models to add them.' : 'Try adjusting your search or filter criteria.'}</p>
      </div>
    `;
    return;
  }

  // Set container class based on view
  container.className = `models-grid-container view-${currentView}`;
  container.replaceChildren();

  if (currentView === 'grid') {
    renderGridView(container, sortedModels);
  } else if (currentView === 'list') {
    renderListView(container, sortedModels);
  } else {
    renderGroupedView(container, sortedModels);
  }
}

/**
 * Render models in grid view (cards)
 */
function renderGridView(container, models) {
  models.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    const { icon, class: iconClass } = getProviderIcon(owner);
    const isFavorite = favoriteModels.has(id);
    
    const card = document.createElement('div');
    card.className = `model-card-grid${isFavorite ? ' is-favorite' : ''}`;
    card.dataset.modelId = id;
    
    card.innerHTML = `
      <div class="model-card-header">
        <div class="model-card-title">${escapeHtml(id)}</div>
      </div>
      <div class="model-card-provider">
        <div class="model-card-provider-icon ${iconClass}">${icon}</div>
        <span>${escapeHtml(owner)}</span>
      </div>
      <div class="model-card-actions">
        <button class="model-card-btn btn-favorite${isFavorite ? ' active' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="model-card-btn btn-copy" title="Copy model ID">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
      </div>
    `;
    
    // Add event listeners
    card.querySelector('.btn-favorite').addEventListener('click', (e) => toggleFavorite(id, e));
    card.querySelector('.btn-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyModelIdWithConfetti(card, id);
    });
    
    container.appendChild(card);
  });
}

/**
 * Render models in list view (rows)
 */
function renderListView(container, models) {
  models.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    const { icon, class: iconClass } = getProviderIcon(owner);
    const isFavorite = favoriteModels.has(id);
    
    const row = document.createElement('div');
    row.className = `model-row-list${isFavorite ? ' is-favorite' : ''}`;
    row.dataset.modelId = id;
    
    row.innerHTML = `
      <div class="model-row-favorite${isFavorite ? ' active' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </div>
      <div class="model-row-name">${escapeHtml(id)}</div>
      <div class="model-row-provider">
        <div class="model-row-provider-icon ${iconClass}">${icon}</div>
        <span>${escapeHtml(owner)}</span>
      </div>
      <div class="model-row-actions">
        <button class="model-row-btn btn-copy" title="Copy model ID">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
      </div>
    `;
    
    // Add event listeners
    row.querySelector('.model-row-favorite').addEventListener('click', (e) => toggleFavorite(id, e));
    row.querySelector('.btn-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyModelIdWithConfetti(row, id);
    });
    
    container.appendChild(row);
  });
}

/**
 * Render models in grouped view (by provider, accordion style)
 */
function renderGroupedView(container, models) {
  const grouped = {};
  models.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(id);
  });
  
  Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).forEach(([owner, modelList]) => {
    const { icon, class: iconClass } = getProviderIcon(owner);
    
    const card = document.createElement('div');
    card.className = 'models-provider-card';
    card.dataset.provider = owner;
    
    const header = document.createElement('div');
    header.className = 'models-provider-header';
    header.addEventListener('click', () => toggleProviderCard(card));
    
    const info = document.createElement('div');
    info.className = 'models-provider-info';
    
    const iconEl = document.createElement('div');
    iconEl.className = `models-provider-icon ${iconClass}`;
    iconEl.textContent = icon;
    
    const nameEl = document.createElement('span');
    nameEl.className = 'models-provider-name';
    nameEl.textContent = owner;
    
    const countSpan = document.createElement('span');
    countSpan.className = 'models-provider-count';
    countSpan.textContent = `${modelList.length} model${modelList.length !== 1 ? 's' : ''}`;
    
    info.append(iconEl, nameEl, countSpan);
    
    const toggle = document.createElement('div');
    toggle.className = 'models-provider-toggle';
    toggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    
    header.append(info, toggle);
    
    const list = document.createElement('div');
    list.className = 'models-list';
    
    modelList.forEach(id => {
      const isFavorite = favoriteModels.has(id);
      
      const badge = document.createElement('div');
      badge.className = `model-badge${isFavorite ? ' is-favorite' : ''}`;
      badge.dataset.modelId = id;
      badge.title = 'Click to copy';
      badge.addEventListener('click', () => copyModelIdWithConfetti(badge, id));
      
      const span = document.createElement('span');
      span.textContent = id;
      
      const copyIcon = document.createElement('span');
      copyIcon.innerHTML = `<svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      
      // Add favorite button
      const favBtn = document.createElement('button');
      favBtn.className = `favorite-btn${isFavorite ? ' favorited' : ''}`;
      favBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
      favBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      favBtn.addEventListener('click', (e) => toggleFavorite(id, e));
      
      badge.append(span, copyIcon, favBtn);
      list.appendChild(badge);
    });
    
    card.append(header, list);
    container.appendChild(card);
  });
}

/**
 * Copy model ID with confetti animation
 */
function copyModelIdWithConfetti(element, id) {
  navigator.clipboard.writeText(id).then(() => {
    element.classList.add('copied');
    
    // Create confetti effect
    createConfetti(element);
    
    setTimeout(() => {
      element.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

/**
 * Create confetti particles for copy animation
 */
function createConfetti(element) {
  const colors = ['#00e5ff', '#a78bfa', '#22d3a0', '#fbbf24', '#f87171'];
  const confettiContainer = document.createElement('div');
  confettiContainer.className = 'copy-confetti';
  element.appendChild(confettiContainer);
  
  for (let i = 0; i < 8; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle';
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    const angle = (i / 8) * Math.PI * 2;
    const distance = 20 + Math.random() * 20;
    particle.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--y', `${Math.sin(angle) * distance}px`);
    confettiContainer.appendChild(particle);
  }
  
  setTimeout(() => confettiContainer.remove(), 600);
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
 * Filter models based on search input, provider filter, and favorites
 */
export function filterModels() {
  const search = document.getElementById('modelSearch')?.value.toLowerCase() || '';
  const clearBtn = document.getElementById('modelSearchClear');
  const currentProviderFilter = getCurrentProviderFilter();
  const allModels = getAllModels() || [];

  if (clearBtn) {
    clearBtn.style.display = search ? 'flex' : 'none';
  }

  let filtered = allModels;

  // Filter by favorites if enabled
  if (showFavoritesOnly) {
    filtered = filtered.filter(m => {
      const id = m.id || m.name || '';
      return favoriteModels.has(id);
    });
  }

  // Filter by provider
  if (currentProviderFilter !== 'all') {
    filtered = filtered.filter(m => {
      const owner = m.owned_by || m.provider || 'other';
      return owner === currentProviderFilter;
    });
  }

  // Filter by search
  if (search) {
    filtered = filtered.filter(m => {
      const id = (m.id || m.name || '').toLowerCase();
      const owner = (m.owned_by || m.provider || '').toLowerCase();
      return id.includes(search) || owner.includes(search);
    });
  }

  renderModels(filtered);
}

export const debouncedFilterModels = debounce(filterModels, 150);

// ========== Cost Calculator Functions ==========

/**
 * Initialize the cost calculator
 */
export function initCalculator() {
  populateCalculatorModels();
}

/**
 * Populate the calculator model dropdown
 */
function populateCalculatorModels() {
  const select = document.getElementById('calcModelSelect');
  if (!select) return;
  
  const allModels = getAllModels() || [];
  const modelPricingConfig = getModelPricingConfig();
  
  // Get all models with pricing (from config or defaults)
  const modelsWithPricing = [];
  
  // Add models from pricing config
  Object.keys(modelPricingConfig).forEach(id => {
    modelsWithPricing.push({ id, source: 'configured' });
  });
  
  // Add models from default pricing
  Object.keys(DEFAULT_MODEL_PRICING).forEach(id => {
    if (!modelPricingConfig[id]) {
      modelsWithPricing.push({ id, source: 'default' });
    }
  });
  
  // Add API models that might have default pricing
  allModels.forEach(m => {
    const id = m.id || m.name;
    if (id && !modelPricingConfig[id] && !DEFAULT_MODEL_PRICING[id]) {
      const defaultPrice = getDefaultPricing(id);
      if (defaultPrice) {
        modelsWithPricing.push({ id, source: 'matched' });
      }
    }
  });
  
  // Sort by name
  modelsWithPricing.sort((a, b) => a.id.localeCompare(b.id));
  
  // Build options
  select.innerHTML = '<option value="">-- Select a model --</option>';
  
  if (modelsWithPricing.length > 0) {
    const configured = modelsWithPricing.filter(m => m.source === 'configured');
    const defaults = modelsWithPricing.filter(m => m.source !== 'configured');
    
    if (configured.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Configured Pricing';
      configured.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }
    
    if (defaults.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Default Pricing';
      defaults.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        group.appendChild(opt);
      });
      select.appendChild(group);
    }
  }
}

/**
 * Update calculator preview/results
 */
export function updateCalculatorPreview() {
  const modelId = document.getElementById('calcModelSelect')?.value;
  const inputTokens = parseInt(document.getElementById('calcInputTokens')?.value) || 0;
  const outputTokens = parseInt(document.getElementById('calcOutputTokens')?.value) || 0;
  const cachedTokens = parseInt(document.getElementById('calcCachedTokens')?.value) || 0;
  const numRequests = parseInt(document.getElementById('calcRequests')?.value) || 1;
  
  const resultsContainer = document.getElementById('calculatorResults');
  const pricingContainer = document.getElementById('calcModelPricing');
  const comparisonContainer = document.getElementById('calculatorComparison');
  
  if (!modelId) {
    resultsContainer.innerHTML = `
      <div class="calculator-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Select a model and enter token counts to see cost estimates</p>
      </div>
    `;
    pricingContainer.style.display = 'none';
    updateComparisonBars(inputTokens, outputTokens, cachedTokens, numRequests);
    return;
  }
  
  // Get pricing for selected model
  const modelPricingConfig = getModelPricingConfig();
  let pricing = modelPricingConfig[modelId] || getDefaultPricing(modelId);
  
  if (!pricing) {
    resultsContainer.innerHTML = `
      <div class="calculator-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>No pricing configured for this model. <a href="#" onclick="switchModelsTab('models-pricing');return false;" style="color:var(--accent-cyan)">Configure pricing</a></p>
      </div>
    `;
    pricingContainer.style.display = 'none';
    return;
  }
  
  // Calculate costs
  const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
  const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
  const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached_input || pricing.input || 0);
  const totalCost = (inputCost + outputCost + cachedCost) * numRequests;
  
  // Update pricing info
  document.getElementById('calcPriceInput').textContent = `$${(pricing.input || 0).toFixed(2)}`;
  document.getElementById('calcPriceOutput').textContent = `$${(pricing.output || 0).toFixed(2)}`;
  document.getElementById('calcPriceCached').textContent = `$${(pricing.cached_input || 0).toFixed(2)}`;
  pricingContainer.style.display = 'block';
  
  // Update results
  if (inputTokens === 0 && outputTokens === 0 && cachedTokens === 0) {
    resultsContainer.innerHTML = `
      <div class="calculator-empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Enter token counts to calculate cost</p>
      </div>
    `;
  } else {
    resultsContainer.innerHTML = `
      <div class="calculator-result-display">
        <div class="calculator-total-cost">$${totalCost.toFixed(4)}</div>
        <div class="calculator-cost-label">Estimated Total Cost${numRequests > 1 ? ` (${numRequests} requests)` : ''}</div>
        <div class="calculator-breakdown">
          <div class="breakdown-item">
            <div class="label">Input</div>
            <div class="value cyan">$${(inputCost * numRequests).toFixed(4)}</div>
          </div>
          <div class="breakdown-item">
            <div class="label">Output</div>
            <div class="value purple">$${(outputCost * numRequests).toFixed(4)}</div>
          </div>
          <div class="breakdown-item">
            <div class="label">Cached</div>
            <div class="value green">$${(cachedCost * numRequests).toFixed(4)}</div>
          </div>
        </div>
      </div>
    `;
  }
  
  // Update comparison bars
  updateComparisonBars(inputTokens, outputTokens, cachedTokens, numRequests);
}

/**
 * Update comparison bars with costs for all models
 */
function updateComparisonBars(inputTokens, outputTokens, cachedTokens, numRequests) {
  const container = document.getElementById('calculatorComparison');
  if (!container) return;
  
  if (inputTokens === 0 && outputTokens === 0) {
    container.innerHTML = `
      <div class="comparison-empty-state">
        <p>Enter token counts above to compare costs across all configured models</p>
      </div>
    `;
    return;
  }
  
  const modelPricingConfig = getModelPricingConfig();
  const costs = [];
  
  // Calculate costs for all configured models
  Object.entries(modelPricingConfig).forEach(([id, pricing]) => {
    const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
    const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
    const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached_input || pricing.input || 0);
    const total = (inputCost + outputCost + cachedCost) * numRequests;
    costs.push({ id, total });
  });
  
  // Add defaults for comparison if not already configured
  Object.entries(DEFAULT_MODEL_PRICING).forEach(([id, pricing]) => {
    if (!modelPricingConfig[id]) {
      const inputCost = (inputTokens / 1_000_000) * (pricing.input || 0);
      const outputCost = (outputTokens / 1_000_000) * (pricing.output || 0);
      const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached_input || pricing.input || 0);
      const total = (inputCost + outputCost + cachedCost) * numRequests;
      costs.push({ id, total });
    }
  });
  
  if (costs.length === 0) {
    container.innerHTML = `
      <div class="comparison-empty-state">
        <p>No models with pricing configured. <a href="#" onclick="switchModelsTab('models-pricing');return false;" style="color:var(--accent-cyan)">Configure pricing</a></p>
      </div>
    `;
    return;
  }
  
  // Sort by cost
  costs.sort((a, b) => a.total - b.total);
  
  // Take top 10
  const topCosts = costs.slice(0, 10);
  const maxCost = Math.max(...topCosts.map(c => c.total));
  
  container.innerHTML = `
    <div class="comparison-bars">
      ${topCosts.map((c, i) => `
        <div class="comparison-bar-item${i === 0 ? ' cheapest' : ''}">
          <div class="comparison-bar-name" title="${escapeHtml(c.id)}">${escapeHtml(c.id)}</div>
          <div class="comparison-bar-wrapper">
            <div class="comparison-bar-fill${i === 0 ? ' cheapest' : ''}" style="width: ${maxCost > 0 ? (c.total / maxCost * 100) : 0}%"></div>
          </div>
          <div class="comparison-bar-cost">$${c.total.toFixed(4)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Set calculator preset values
 */
export function setCalcPreset(preset) {
  const presets = {
    small: { input: 10000, output: 5000 },
    medium: { input: 100000, output: 50000 },
    large: { input: 1000000, output: 500000 }
  };
  
  const p = presets[preset];
  if (p) {
    document.getElementById('calcInputTokens').value = p.input;
    document.getElementById('calcOutputTokens').value = p.output;
    updateCalculatorPreview();
  }
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
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle('active', isActive);
    // Update aria-selected attribute for accessibility
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.models-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });

  if (tabId === 'models-pricing') {
    await loadPricingConfig();
    renderPricingModels();
  } else if (tabId === 'models-calculator') {
    await loadPricingConfig();
    initCalculator();
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
  const allModels = getAllModels() || [];
  const modelPricingConfig = getModelPricingConfig();

  // Get all model IDs from the API
  const apiModelIds = new Set(allModels.map(m => m.id || m.name || 'unknown'));

  // Find custom models (models with pricing that are not in the API list)
  const customModelIds = Object.keys(modelPricingConfig).filter(id => !apiModelIds.has(id));

  // Group models by provider
  const grouped = {};
  allModels.forEach(m => {
    const id = m.id || m.name || 'unknown';
    const owner = m.owned_by || m.provider || 'other';
    if (!grouped[owner]) grouped[owner] = [];
    grouped[owner].push(id);
  });

  // Add custom models group if there are any
  if (customModelIds.length > 0) {
    grouped['custom'] = customModelIds;
  }

  if (Object.keys(grouped).length === 0) {
    container.innerHTML = `
      <div class="models-empty">
        <div class="models-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <h4>No models available</h4>
        <p>Load models from the "Available Models" tab first, or add custom models using the button above.</p>
      </div>
    `;
    return;
  }

  // Sort with 'custom' group at the top
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    if (a[0] === 'custom') return -1;
    if (b[0] === 'custom') return 1;
    return a[0].localeCompare(b[0]);
  });

  container.innerHTML = sortedEntries.map(([owner, modelList]) => {
    const isCustomGroup = owner === 'custom';
    const { icon, class: iconClass } = isCustomGroup 
      ? { icon: '✏️', class: 'custom' } 
      : getProviderIcon(owner);
    const configuredCount = modelList.filter(id => modelPricingConfig[id]).length;

    return `
      <div class="pricing-card ${isCustomGroup ? 'custom-models-card' : ''}">
        <div class="pricing-card-header">
          <div class="pricing-card-title">
            <div class="pricing-card-icon ${iconClass}">${icon}</div>
            <h3>${isCustomGroup ? 'Custom Models' : owner}</h3>
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

export const debouncedFilterPricingModels = debounce(filterPricingModels, 150);

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
 * Save pricing for a specific model with validation and immutable state update
 * @param {string} modelId - Model ID
 */
export async function savePricingForModel(modelId) {
  const input = parseFloat(document.getElementById('pricingInput').value);
  const output = parseFloat(document.getElementById('pricingOutput').value);
  const cached = parseFloat(document.getElementById('pricingCached').value);
  const cacheWrite = parseFloat(document.getElementById('pricingCacheWrite').value);

  if (!isValidPricingValue(input) && !isValidPricingValue(output)) {
    toast('Please set at least valid input or output pricing', 'error');
    return;
  }
  
  if (isValidPricingValue(input) && input < 0) {
    toast('Input price cannot be negative', 'error');
    return;
  }
  
  if (isValidPricingValue(output) && output < 0) {
    toast('Output price cannot be negative', 'error');
    return;
  }

  const newPricing = {
    input: isValidPricingValue(input) ? input : 0,
    output: isValidPricingValue(output) ? output : 0,
    cached_input: isValidPricingValue(cached) && cached > 0 ? cached : undefined,
    cache_write: isValidPricingValue(cacheWrite) && cacheWrite > 0 ? cacheWrite : undefined
  };
  
  setModelPricingConfig({
    ...getModelPricingConfig(),
    [modelId]: newPricing
  });

  await savePricingConfig();
  closeModal();
  renderPricingModels();
  toast(`Pricing saved for ${modelId}`, 'success');
}

/**
 * Remove pricing configuration for a model with immutable state update
 * @param {string} modelId - Model ID
 */
export async function removePricing(modelId) {
  if (confirm(`Remove pricing configuration for ${modelId}?`)) {
    const newConfig = { ...getModelPricingConfig() };
    delete newConfig[modelId];
    setModelPricingConfig(newConfig);
    await savePricingConfig();
    renderPricingModels();
    toast(`Pricing removed for ${modelId}`, 'success');
  }
}

/**
 * Open modal to add pricing for a custom model ID (manually entered)
 */
export function openCustomPricingModal() {
  const content = `
    <div class="pricing-modal-content">
      <h3 style="margin-bottom:20px;color:var(--text-primary)">Add Custom Model Pricing</h3>

      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:20px">
        Enter a model ID manually to configure pricing. Useful for aliased models or models not in the list.
      </p>

      <div class="pricing-form-grid">
        <div class="pricing-form-group" style="grid-column: 1 / -1">
          <label class="pricing-form-label">Model ID</label>
          <input type="text" class="pricing-form-input" id="customModelId"
            placeholder="e.g., claude-opus-4-5-thinking">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Input Tokens <span>(per 1M)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingInput"
            placeholder="e.g., 3.00">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Output Tokens <span>(per 1M)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingOutput"
            placeholder="e.g., 15.00">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Cached Input <span>(per 1M, optional)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingCached"
            placeholder="e.g., 0.30">
        </div>
        <div class="pricing-form-group">
          <label class="pricing-form-label">Cached Write <span>(per 1M, optional)</span></label>
          <input type="number" step="0.001" min="0" class="pricing-form-input" id="pricingCacheWrite"
            placeholder="e.g., 3.75">
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:24px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveCustomModelPricing()">Save Pricing</button>
      </div>
    </div>
  `;

  showModal('Add Custom Model Pricing', content);
}

/**
 * Save pricing for a custom model ID entered manually with validation
 */
export async function saveCustomModelPricing() {
  const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
  const modelId = document.getElementById('customModelId').value.trim();
  
  if (!modelId) {
    toast('Please enter a model ID', 'error');
    return;
  }
  
  if (DANGEROUS_KEYS.includes(modelId)) {
    toast('Invalid model ID', 'error');
    return;
  }
  
  if (modelId.length > 256) {
    toast('Model ID too long (max 256 characters)', 'error');
    return;
  }

  const input = parseFloat(document.getElementById('pricingInput').value);
  const output = parseFloat(document.getElementById('pricingOutput').value);
  const cached = parseFloat(document.getElementById('pricingCached').value);
  const cacheWrite = parseFloat(document.getElementById('pricingCacheWrite').value);

  if (!isValidPricingValue(input) && !isValidPricingValue(output)) {
    toast('Please set at least valid input or output pricing', 'error');
    return;
  }

  const newPricing = {
    input: isValidPricingValue(input) ? input : 0,
    output: isValidPricingValue(output) ? output : 0,
    cached_input: isValidPricingValue(cached) && cached > 0 ? cached : undefined,
    cache_write: isValidPricingValue(cacheWrite) && cacheWrite > 0 ? cacheWrite : undefined
  };
  
  setModelPricingConfig({
    ...getModelPricingConfig(),
    [modelId]: newPricing
  });

  await savePricingConfig();
  closeModal();
  renderPricingModels();
  toast(`Pricing saved for ${modelId}`, 'success');
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
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
  toast('Pricing configuration exported', 'success');
}

/**
 * Prompt to import pricing configuration from a JSON file
 * Uses sanitization to prevent prototype pollution and validate data
 */
export function importPricingPrompt() {
  const MAX_FILE_SIZE = 1024 * 1024;
  
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        toast('File too large. Maximum size is 1MB.', 'error');
        return;
      }
      
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const imported = sanitizeImportedPricing(parsed);
        
        const importedCount = Object.keys(imported).length;
        if (importedCount === 0) {
          toast('No valid pricing entries found in file', 'error');
          return;
        }
        
        const merged = { ...getModelPricingConfig(), ...imported };
        setModelPricingConfig(merged);
        await savePricingConfig();
        renderPricingModels();
        toast(`Imported pricing for ${importedCount} models`, 'success');
      } catch (err) {
        console.error('Failed to import pricing:', err);
        toast(`Failed to import: ${err.message || 'Invalid JSON file'}`, 'error');
      }
    }
  };
  input.click();
}

// Expose functions to window for HTML onclick handlers
window.modelsModule = {
  loadModels,
  fetchModels,
  filterModels,
  filterModelsByProvider,
  toggleProviderCard,
  copyModelId,
  clearModelSearch,
  switchModelsTab,
  loadPricingConfig,
  savePricingConfig,
  renderPricingModels,
  filterPricingModels,
  debouncedFilterModels,
  debouncedFilterPricingModels,
  openPricingModal,
  applyPresetPricing,
  savePricingForModel,
  removePricing,
  openCustomPricingModal,
  saveCustomModelPricing,
  applyDefaultPricing,
  clearAllPricing,
  exportPricing,
  importPricingPrompt,
  // New functions
  toggleFavorite,
  toggleFavoritesFilter,
  setModelsView,
  setModelsSort,
  toggleSortDropdown,
  initCalculator,
  updateCalculatorPreview,
  setCalcPreset
};

// Also expose directly for simpler onclick handlers
window.loadModels = loadModels;
window.filterModels = filterModels;
window.debouncedFilterModels = debouncedFilterModels;
window.debouncedFilterPricingModels = debouncedFilterPricingModels;
window.filterModelsByProvider = filterModelsByProvider;
window.toggleProviderCard = toggleProviderCard;
window.copyModelId = copyModelId;
window.clearModelSearch = clearModelSearch;
window.switchModelsTab = switchModelsTab;
window.filterPricingModels = filterPricingModels;
window.openPricingModal = openPricingModal;
window.applyPresetPricing = applyPresetPricing;
window.savePricingForModel = savePricingForModel;
window.removePricing = removePricing;
window.openCustomPricingModal = openCustomPricingModal;
window.saveCustomModelPricing = saveCustomModelPricing;
window.applyDefaultPricing = applyDefaultPricing;
window.clearAllPricing = clearAllPricing;
window.exportPricing = exportPricing;
window.importPricingPrompt = importPricingPrompt;

// New functions
window.toggleFavorite = toggleFavorite;
window.toggleFavoritesFilter = toggleFavoritesFilter;
window.setModelsView = setModelsView;
window.setModelsSort = setModelsSort;
window.toggleSortDropdown = toggleSortDropdown;
window.initCalculator = initCalculator;
window.updateCalculatorPreview = updateCalculatorPreview;
window.setCalcPreset = setCalcPreset;

/**
 * Initialize event listeners for the Models tab section
 * This replaces inline onclick handlers for better accessibility and code quality
 */
export function initModelsTabEventListeners() {
  // Tab buttons
  const modelsTabBtn = document.getElementById('models-tab-btn');
  const pricingTabBtn = document.getElementById('pricing-tab-btn');
  const calculatorTabBtn = document.getElementById('calculator-tab-btn');
  
  if (modelsTabBtn) {
    modelsTabBtn.addEventListener('click', () => switchModelsTab('models-list'));
  }
  if (pricingTabBtn) {
    pricingTabBtn.addEventListener('click', () => switchModelsTab('models-pricing'));
  }
  if (calculatorTabBtn) {
    calculatorTabBtn.addEventListener('click', () => switchModelsTab('models-calculator'));
  }
  
  // Search inputs
  const modelSearch = document.getElementById('modelSearch');
  const pricingSearch = document.getElementById('pricingSearch');
  
  if (modelSearch) {
    modelSearch.addEventListener('input', debouncedFilterModels);
  }
  if (pricingSearch) {
    pricingSearch.addEventListener('input', debouncedFilterPricingModels);
  }
  
  // Clear search button
  const modelSearchClear = document.getElementById('modelSearchClear');
  if (modelSearchClear) {
    modelSearchClear.addEventListener('click', clearModelSearch);
  }
  
  // Favorites button
  const favoritesBtn = document.getElementById('modelsFavoritesBtn');
  if (favoritesBtn) {
    favoritesBtn.addEventListener('click', toggleFavoritesFilter);
  }
  
  // Sort button and options
  const sortBtn = document.getElementById('modelsSortBtn');
  if (sortBtn) {
    sortBtn.addEventListener('click', toggleSortDropdown);
  }
  
  // Sort options
  const sortMenu = document.getElementById('modelsSortMenu');
  if (sortMenu) {
    sortMenu.querySelectorAll('.sort-option').forEach(option => {
      option.addEventListener('click', () => {
        const sort = option.dataset.sort;
        if (sort) {
          setModelsSort(sort);
          toggleSortDropdown(); // Close dropdown after selection
        }
      });
    });
  }
  
  // View toggle buttons
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) {
        setModelsView(view);
      }
    });
  });
  
  // Filter pills (delegate to container for dynamically added pills)
  const filterPillsContainer = document.getElementById('modelsFilterPills');
  if (filterPillsContainer) {
    filterPillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.models-filter-pill');
      if (pill) {
        const provider = pill.dataset.provider;
        if (provider) {
          filterModelsByProvider(provider);
        }
      }
    });
  }
  
  // Pricing preset buttons
  const addCustomModelBtn = document.getElementById('addCustomModelBtn');
  const applyDefaultPricingBtn = document.getElementById('applyDefaultPricingBtn');
  const clearAllPricingBtn = document.getElementById('clearAllPricingBtn');
  const exportPricingBtn = document.getElementById('exportPricingBtn');
  const importPricingBtn = document.getElementById('importPricingBtn');
  
  if (addCustomModelBtn) {
    addCustomModelBtn.addEventListener('click', openCustomPricingModal);
  }
  if (applyDefaultPricingBtn) {
    applyDefaultPricingBtn.addEventListener('click', applyDefaultPricing);
  }
  if (clearAllPricingBtn) {
    clearAllPricingBtn.addEventListener('click', clearAllPricing);
  }
  if (exportPricingBtn) {
    exportPricingBtn.addEventListener('click', exportPricing);
  }
  if (importPricingBtn) {
    importPricingBtn.addEventListener('click', importPricingPrompt);
  }
}

// Initialize event listeners when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initModelsTabEventListeners);
} else {
  // DOM is already ready, initialize immediately
  initModelsTabEventListeners();
}

window.initModelsTabEventListeners = initModelsTabEventListeners;
