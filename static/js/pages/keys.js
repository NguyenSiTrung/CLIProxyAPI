/**
 * API Keys Page Module
 * Handles access keys and provider API keys management (Gemini, Claude, Codex)
 */

import { api } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showModal, closeModal } from '../core/modal.js';

// Track revealed keys state
let revealedKeys = {};

/**
 * Load all API keys and render them
 */
export async function loadKeys() {
  try {
    const [a, g, c, x] = await Promise.all([
      api('GET', '/api-keys').catch(() => ({})),
      api('GET', '/gemini-api-key').catch(() => ({})),
      api('GET', '/claude-api-key').catch(() => ({})),
      api('GET', '/codex-api-key').catch(() => ({}))
    ]);

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

  container.innerHTML = keys.map((k, i) => {
    const fullKey = typeof k === 'string' ? k : (k.key || k.api_key || JSON.stringify(k));
    const maskedKey = fullKey.length > 12 ? fullKey.slice(0, 6) + '••••••••' + fullKey.slice(-4) : '••••••••';
    const keyMeta = typeof k === 'object' ? (k.project || k.name || typeInfo.name + ' Key') : typeInfo.name + ' Key #' + (i + 1);
    const keyId = type + '-' + i;
    const isRevealed = revealedKeys[keyId];
    const displayKey = isRevealed ? fullKey : maskedKey;
    const escapedKey = fullKey.replace(/'/g, "\\'").replace(/"/g, '\\"');

    return '<div class="key-card">' +
      '<span class="key-index">' + (i + 1) + '</span>' +
      '<div class="key-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg></div>' +
      '<div class="key-info">' +
      '<div class="key-value ' + (isRevealed ? 'revealed' : '') + '" id="key-display-' + keyId + '">' + displayKey + '</div>' +
      '<div class="key-meta">' + keyMeta + '</div>' +
      '</div>' +
      '<div class="key-actions">' +
      '<button class="key-action-btn reveal" onclick="window.keysModule.toggleKeyReveal(\'' + keyId + '\', \'' + escapedKey + '\', \'' + maskedKey + '\')" title="' + (isRevealed ? 'Hide' : 'Reveal') + ' key">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      (isRevealed ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>' : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>') +
      '</svg>' +
      '</button>' +
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
 * Open modal to add a new key
 */
export function openAddKeyModal(type) {
  const typeInfo = getKeyTypeInfo(type);
  
  const content = `
    <div class="key-format-hint">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      <span>${typeInfo.hint}</span>
    </div>
    <div class="form-group">
      <label>API Key</label>
      <input type="text" id="newKeyValue" class="form-input" placeholder="${typeInfo.prefix ? 'e.g. ' + typeInfo.prefix + '...' : 'Enter your API key'}" autocomplete="off" spellcheck="false">
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
    });
  });
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
  setupKeysTabHandlers
};

// Expose functions to window for HTML onclick handlers
window.keysModule = keysModule;
window.loadKeys = loadKeys;
window.openAddKeyModal = openAddKeyModal;
