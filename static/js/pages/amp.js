/**
 * Amp Settings Page Module
 * Handles Amp upstream configuration, model mappings, and combos
 */

import { api, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import { closeModal } from '../core/modal.js';
import { getAllModels, setAllModels, getAccessApiKeys, setAccessApiKeys } from '../core/state.js';

/**
 * Fetch models from the API
 */
async function fetchModels() {
  const apiKey = getApiKey();
  let accessApiKeys = getAccessApiKeys();
  
  let res = await fetch('/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (res.ok) {
    const data = await res.json();
    return data.data || data.models || [];
  }

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

  res = await fetch('/v1/models');

  if (res.ok) {
    const data = await res.json();
    return data.data || data.models || [];
  }

  throw new Error('API authentication required');
}

/**
 * Get presets from localStorage
 */
function getPresets() {
  let p = localStorage.getItem('amp_source_presets');
  if (!p) {
    const defaults = [
      { id: 1, label: 'Smart', value: 'claude-opus-4-5-20251101' },
      { id: 2, label: 'Librarian', value: 'claude-sonnet-4-5-20250929' },
      { id: 3, label: 'Search and title', value: 'claude-haiku-4-5-20251001' }
    ];
    localStorage.setItem('amp_source_presets', JSON.stringify(defaults));
    return defaults;
  }
  return JSON.parse(p);
}

/**
 * Get combos from localStorage
 */
function getCombos() {
  const c = localStorage.getItem('amp_mapping_combos');
  return c ? JSON.parse(c) : [];
}

/**
 * Save combos to localStorage
 */
function saveCombos(combos) {
  localStorage.setItem('amp_mapping_combos', JSON.stringify(combos));
  renderCombosSidePanel();
}

/**
 * Escape HTML attributes to prevent XSS
 */
function escapeHtmlAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
}

/**
 * Parse reasoning effort from target model string
 */
function parseTarget(to) {
  const match = to.match(/:reasoning=(\w+)$/);
  if (match) {
    return { model: to.replace(/:reasoning=\w+$/, ''), reasoning: match[1] };
  }
  return { model: to, reasoning: null };
}

/**
 * Generate reasoning effort badge HTML
 */
function reasoningBadge(effort) {
  if (!effort) return '';
  const colors = { low: 'yellow', medium: 'blue', high: 'purple' };
  return `<span class="badge badge-${colors[effort] || 'cyan'}" style="margin-left:8px;font-size:10px;">🧠 ${effort}</span>`;
}

/**
 * Update connection status indicator
 */
function updateAmpConnectionStatus(url, key) {
  const statusEl = document.getElementById('ampConnectionStatus');
  const textEl = document.getElementById('ampConnectionText');
  
  if (!statusEl || !textEl) return;
  
  statusEl.classList.remove('connected', 'disconnected', 'checking', 'not-configured');
  
  if (!url || !key) {
    statusEl.classList.add('not-configured');
    textEl.textContent = 'Not configured';
  } else {
    statusEl.classList.add('connected');
    textEl.textContent = 'Configured';
  }
}

/**
 * Copy mapping text to clipboard
 */
export function copyMappingText(el, text) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1000);
    toast('Copied to clipboard', 'success');
  }).catch(() => {
    toast('Failed to copy', 'error');
  });
}

/**
 * Filter mappings by search term
 */
export function filterMappings(searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  const cards = document.querySelectorAll('#modelMappings .mapping-card');
  const noResults = document.getElementById('mappingsNoResults');
  let visibleCount = 0;

  cards.forEach(card => {
    const from = (card.dataset.from || '').toLowerCase();
    const to = (card.dataset.to || '').toLowerCase();
    
    if (!term || from.includes(term) || to.includes(term)) {
      card.classList.remove('hidden');
      visibleCount++;
    } else {
      card.classList.add('hidden');
    }
  });

  if (noResults) {
    if (visibleCount === 0 && term && cards.length > 0) {
      noResults.classList.add('visible');
    } else {
      noResults.classList.remove('visible');
    }
  }
}

/**
 * Toggle password visibility for API key
 */
export function toggleAmpKeyVisibility() {
  const input = document.getElementById('ampUpstreamKey');
  const icon = document.getElementById('ampKeyEyeIcon');
  
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    input.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
}

/**
 * Test upstream connection
 */
export async function testAmpConnection() {
  const url = document.getElementById('ampUpstreamUrl').value.trim();
  const key = document.getElementById('ampUpstreamKey').value.trim();
  const btn = document.getElementById('btnTestConnection');
  const textEl = document.getElementById('testConnectionText');
  const statusEl = document.getElementById('ampConnectionStatus');
  const statusTextEl = document.getElementById('ampConnectionText');
  
  if (!url) {
    toast('Please enter an upstream URL', 'error');
    return;
  }
  
  btn.classList.add('testing');
  btn.disabled = true;
  textEl.textContent = 'Testing...';
  statusEl.classList.remove('connected', 'disconnected', 'not-configured');
  statusEl.classList.add('checking');
  statusTextEl.textContent = 'Checking...';
  
  try {
    const testUrl = url.replace(/\/$/, '') + '/v1/models';
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: key ? { 'Authorization': `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      statusEl.classList.remove('checking');
      statusEl.classList.add('connected');
      statusTextEl.textContent = 'Connected';
      toast('Connection successful!', 'success');
    } else {
      statusEl.classList.remove('checking');
      statusEl.classList.add('disconnected');
      statusTextEl.textContent = 'Connection failed';
      toast(`Connection failed: HTTP ${response.status}`, 'error');
    }
  } catch (e) {
    statusEl.classList.remove('checking');
    statusEl.classList.add('disconnected');
    statusTextEl.textContent = 'Connection failed';
    
    if (e.name === 'TimeoutError') {
      toast('Connection timed out', 'error');
    } else if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
      statusEl.classList.remove('disconnected');
      statusEl.classList.add('connected');
      statusTextEl.textContent = 'Configured (CORS blocked test)';
      toast('Note: Direct test blocked by CORS, but config saved', 'info');
    } else {
      toast('Connection error: ' + e.message, 'error');
    }
  } finally {
    btn.classList.remove('testing');
    btn.disabled = false;
    textEl.textContent = 'Test';
  }
}

/**
 * Save Amp connection settings
 */
export async function saveAmpSettings() {
  const btn = document.getElementById('btnSaveAmp');
  const textEl = document.getElementById('saveAmpText');
  const iconEl = document.getElementById('saveAmpIcon');
  
  btn.classList.add('saving');
  btn.disabled = true;
  textEl.textContent = 'Saving...';
  iconEl.innerHTML = '<circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle>';
  
  try {
    const u = document.getElementById('ampUpstreamUrl').value,
      k = document.getElementById('ampUpstreamKey').value;

    if (u) await api('PUT', '/ampcode/upstream-url', { value: u });
    if (k) await api('PUT', '/ampcode/upstream-api-key', { value: k });
    
    updateAmpConnectionStatus(u, k);
    
    iconEl.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    textEl.textContent = 'Saved!';
    toast('Connection settings saved', 'success');
    
    setTimeout(() => {
      btn.classList.remove('saving');
      btn.disabled = false;
      textEl.textContent = 'Save Connection';
      iconEl.innerHTML = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>';
    }, 2000);
  } catch (e) {
    btn.classList.remove('saving');
    btn.disabled = false;
    textEl.textContent = 'Save Connection';
    iconEl.innerHTML = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>';
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Toggle an Amp setting
 */
export async function toggleAmpSetting(key, value) {
  try {
    await api('PUT', `/ampcode/${key}`, { value });
    toast('Setting updated', 'success');
  } catch (e) {
    toast('Failed to update: ' + e.message, 'error');
    loadAmpSettings();
  }
}

/**
 * Render combos side panel
 */
export function renderCombosSidePanel() {
  const combos = getCombos();
  const el = document.getElementById('combosSidePanel');
  if (!el) return;

  if (combos.length === 0) {
    el.innerHTML = `
      <div style="padding:24px; text-align:center; color:var(--text-secondary); font-size:13px; border:1px dashed var(--border-color); border-radius:8px; background:rgba(0,0,0,0.1)">
        No combos created yet.<br>
        <a href="javascript:void(0)" onclick="window.ampModule.openAddComboModal()" style="color:var(--accent-cyan); text-decoration:none; display:inline-block; margin-top:4px">Create your first combo</a>
      </div>
    `;
    return;
  }

  el.innerHTML = combos.map(c => `
    <div class="combo-item" style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; padding:12px; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s; cursor:default; position:relative; overflow:hidden">
      <div style="display:flex; align-items:center; gap:12px">
        <div style="width:32px; height:32px; background:rgba(255,255,255,0.03); border-radius:6px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary)">
          <span style="font-weight:bold; font-size:14px">${c.name.charAt(0).toUpperCase()}</span>
        </div>
        <div>
          <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:2px">${c.name}</div>
          <div style="font-size:11px; color:var(--text-secondary)">${c.mappings.length} mapping${c.mappings.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" style="padding:4px 12px; font-size:12px; opacity:0; transform:translateX(10px); transition:all 0.2s" onclick="window.ampModule.applyCombo('${c.id}')">Apply</button>
      <style>
        .combo-item:hover { border-color: var(--accent-purple); box-shadow: 0 2px 8px rgba(167, 139, 250, 0.1); }
        .combo-item:hover .btn-primary { opacity: 1; transform: translateX(0); }
      </style>
    </div>
  `).join('');
}

/**
 * Open manage combos modal
 */
export function openManageCombosModal() {
  const combos = getCombos();
  document.getElementById('modalTitle').textContent = 'Model Mapping Combos';

  const content = `
    <div style="margin-bottom:16px">
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">Combos allow you to apply multiple model mappings at once. Applying a combo will update existing mappings with matching source models.</p>
      ${combos.length === 0 ?
        `<div class="empty-state" style="padding:24px;border:1px dashed var(--border-color);border-radius:8px">No combos saved</div>` :
        `<div class="combos-list" style="display:grid;gap:12px">
          ${combos.map(c => `
            <div class="mapping-card">
              <div style="flex:1">
                <div style="font-weight:600;color:var(--text-primary)">${c.name}</div>
                <div style="font-size:12px;color:var(--text-secondary)">${c.mappings.length} mappings</div>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-secondary btn-sm" onclick="window.ampModule.openAddComboModal('${c.id}')" title="Edit">✎</button>
                <button class="btn btn-primary btn-sm" onclick="window.ampModule.applyCombo('${c.id}')" title="Apply Combo">Apply</button>
                <button class="btn btn-secondary btn-sm" onclick="window.ampModule.deleteCombo('${c.id}')" title="Delete">×</button>
              </div>
            </div>
          `).join('')}
        </div>`
      }
    </div>
    <button class="btn btn-secondary btn-sm" style="width:100%;border-style:dashed" onclick="window.ampModule.openAddComboModal()">+ Create New Combo</button>
  `;

  document.getElementById('modalContent').innerHTML = content;
  document.getElementById('modalFooter').innerHTML = `<button class="btn btn-secondary" onclick="window.ampModule.closeModal()">Close</button>`;
  document.getElementById('modal').classList.add('active');
}

/**
 * Open add/edit combo modal
 */
export function openAddComboModal(editId = null) {
  document.getElementById('modalTitle').textContent = editId ? 'Edit Combo' : 'Create Combo';

  const presets = getPresets();
  const presetOptions = presets.map(p => `<option value="${p.value}">${p.label} (${p.value})</option>`).join('');

  let comboName = '';
  let mappings = [];

  if (editId) {
    const combos = getCombos();
    const c = combos.find(x => x.id === editId);
    if (c) {
      comboName = c.name;
      mappings = c.mappings;
    }
  }

  document.getElementById('modalContent').innerHTML = `
    <div class="form-group">
      <label>Combo Name</label>
      <input type="text" id="comboName" class="form-input" placeholder="e.g. Creative Suite" value="${comboName}">
    </div>
    <label style="display:block;margin-bottom:8px;font-size:14px;font-weight:500">Mappings</label>
    <div id="comboMappingsList" style="max-height:300px;overflow-y:auto;margin-bottom:12px;display:grid;gap:8px">
    </div>
    <button class="btn btn-secondary btn-sm" onclick="window.ampModule.addComboRow()" style="width:100%">+ Add Row</button>
    <template id="comboRowTemplate">
      <div class="combo-row" style="display:flex;gap:8px;align-items:center">
        <select class="form-input" style="flex:1" onchange="this.nextElementSibling.value=this.value">
          <option value="">Select source...</option>
          ${presetOptions}
        </select>
        <input type="text" class="form-input" style="flex:1" placeholder="Source (From)">
        <input type="text" class="form-input" style="flex:1" placeholder="Target (To)">
        <button class="btn btn-danger btn-sm" onclick="this.closest('.combo-row').remove()">×</button>
      </div>
    </template>
  `;

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.ampModule.openManageCombosModal()">Back</button>
    <button class="btn btn-primary" onclick="window.ampModule.saveCombo('${editId || ''}')">${editId ? 'Save Changes' : 'Save Combo'}</button>
  `;

  if (mappings.length > 0) {
    mappings.forEach(m => addComboRow(m.from, m.to));
  } else {
    addComboRow();
  }

  document.getElementById('modal').classList.add('active');
}

/**
 * Add a row to combo mappings
 */
export function addComboRow(from = '', to = '') {
  const tmpl = document.getElementById('comboRowTemplate');
  const div = tmpl.content.cloneNode(true);
  const inputs = div.querySelectorAll('input');
  if (from) inputs[0].value = from;
  if (to) inputs[1].value = to;
  document.getElementById('comboMappingsList').appendChild(div);
}

/**
 * Save combo
 */
export function saveCombo(editId) {
  const name = document.getElementById('comboName').value.trim();
  if (!name) return toast('Combo name is required', 'error');

  const rows = document.querySelectorAll('.combo-row');
  const mappings = [];

  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const from = inputs[0].value.trim();
    const to = inputs[1].value.trim();
    if (from && to) mappings.push({ from, to });
  });

  if (mappings.length === 0) return toast('Add at least one mapping', 'error');

  const combos = getCombos();

  if (editId) {
    const idx = combos.findIndex(c => c.id === editId);
    if (idx >= 0) {
      combos[idx].name = name;
      combos[idx].mappings = mappings;
    }
  } else {
    combos.push({
      id: Date.now().toString(),
      name,
      mappings
    });
  }

  saveCombos(combos);
  toast('Combo saved', 'success');
  openManageCombosModal();
}

/**
 * Delete a combo
 */
export function deleteCombo(id) {
  if (!confirm('Delete this combo?')) return;
  const combos = getCombos().filter(c => c.id !== id);
  saveCombos(combos);
  openManageCombosModal();
}

/**
 * Apply a combo to current mappings
 */
export async function applyCombo(id) {
  if (!confirm('Apply this combo? This will update target models for any matching sources.')) return;

  try {
    const combo = getCombos().find(c => c.id === id);
    if (!combo) return;

    const res = await api('GET', '/ampcode/model-mappings');
    const currentMappings = res['model-mappings'] || [];

    let updatedCount = 0;
    let addedCount = 0;
    const newMappings = [...currentMappings];

    combo.mappings.forEach(cm => {
      const idx = newMappings.findIndex(m => m.from === cm.from);
      if (idx >= 0) {
        if (newMappings[idx].to !== cm.to) {
          newMappings[idx].to = cm.to;
          updatedCount++;
        }
      } else {
        newMappings.push({ from: cm.from, to: cm.to });
        addedCount++;
      }
    });

    if (updatedCount === 0 && addedCount === 0) {
      toast('No changes needed', 'info');
      return;
    }

    await api('PATCH', '/ampcode/model-mappings', { value: combo.mappings });
    toast(`Applied: ${updatedCount} updated, ${addedCount} added`, 'success');
    closeModal();
    loadAmpSettings();

  } catch (e) {
    toast('Failed to apply combo: ' + e.message, 'error');
  }
}

/**
 * Open add mapping modal
 */
export async function openAddMappingModal(oldFrom = null, oldTo = null, oldReasoningEffort = null) {
  document.getElementById('modalTitle').textContent = 'Add Model Mapping';

  let allModels = getAllModels();
  if (!allModels || allModels.length === 0) {
    try {
      const cfg = await api('GET', '/config').catch(() => ({}));
      setAccessApiKeys(cfg['api-keys'] || cfg.api_keys || []);
      allModels = await fetchModels();
      setAllModels(allModels);
    } catch (e) {
      console.error("Failed to fetch models for dropdown", e);
    }
  }

  const presets = getPresets();
  const presetOptions = presets.map(p => `<option value="${p.value}">${p.label}</option>`).join('');

  const groupedModels = {};
  if (allModels && allModels.length > 0) {
    allModels.forEach(m => {
      const owner = m.owned_by || m.provider || 'Other';
      if (!groupedModels[owner]) groupedModels[owner] = [];
      groupedModels[owner].push(m.id || m.name);
    });
  }

  const reasoningModels = [
    'o1', 'o1-preview', 'o1-mini', 'o3', 'o3-mini', 'o4-mini',
    'claude-3-7-sonnet', 'claude-sonnet-4',
    'gemini-2.0-flash-thinking', 'gemini-2.5-pro', 'gemini-2.5-flash'
  ];

  document.getElementById('modalContent').innerHTML = `
    <style>
      .model-selector { position: relative; }
      .model-search { width: 100%; padding: 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; }
      .model-list { display: none; position: absolute; top: 100%; left: 0; right: 0; max-height: 200px; overflow-y: auto; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; z-index: 100; margin-top: 4px; }
      .model-list.active { display: block; }
      .model-group-title { padding: 8px 12px; background: rgba(255,255,255,0.05); font-weight: bold; font-size: 12px; color: var(--accent-cyan); text-transform: uppercase; }
      .model-option { padding: 8px 12px; cursor: pointer; transition: background 0.2s; }
      .model-option:hover { background: rgba(255,255,255,0.1); }
      .model-option.selected { background: var(--accent-purple); color: white; }
      .input-mode-toggle { display: flex; gap: 8px; margin-bottom: 8px; }
      .input-mode-btn { padding: 6px 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s; }
      .input-mode-btn.active { background: var(--accent-cyan); color: #0d0d1a; border-color: var(--accent-cyan); }
      .input-mode-btn:hover:not(.active) { border-color: var(--accent-cyan); color: var(--text-primary); }
      .reasoning-effort-group { margin-top: 12px; padding: 12px; background: rgba(167, 139, 250, 0.1); border: 1px solid rgba(167, 139, 250, 0.3); border-radius: 8px; display: none; }
      .reasoning-effort-group.visible { display: block; }
      .reasoning-effort-group label { color: var(--accent-purple); font-size: 13px; margin-bottom: 8px; display: block; }
      .reasoning-effort-hint { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
    </style>
    <div class="form-group">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <label style="margin-bottom:0">Source Model (From)</label>
        <a href="javascript:void(0)" onclick="window.ampModule.openManagePresetsModal()" style="font-size:12px; color:var(--accent-cyan); text-decoration:none; display:flex; align-items:center; gap:4px">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          Manage Presets
        </a>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select class="form-input" style="flex:1" onchange="if(this.value) document.getElementById('mappingFrom').value = this.value">
          <option value="">Select a preset...</option>
          ${presetOptions}
        </select>
      </div>
      <input type="text" id="mappingFrom" class="form-input" placeholder="Or type manually (e.g. gpt-4)">
    </div>
    <div class="form-group">
      <label>Target Model (To)</label>
      <div class="input-mode-toggle">
        <button type="button" class="input-mode-btn active" onclick="window.ampModule.setTargetInputMode('select')">Select from list</button>
        <button type="button" class="input-mode-btn" onclick="window.ampModule.setTargetInputMode('manual')">Manual input</button>
      </div>
      <div id="targetSelectMode" class="model-selector">
        <input type="text" id="modelSearchInput" class="model-search" placeholder="Search and select model..." autocomplete="off">
        <div id="modelListDropdown" class="model-list"></div>
      </div>
      <div id="targetManualMode" style="display:none;">
        <input type="text" id="mappingToManual" class="form-input" placeholder="Enter model ID (e.g. gpt-4o, claude-sonnet-4)" oninput="window.ampModule.updateReasoningEffortVisibility(this.value)">
      </div>
      <input type="hidden" id="mappingTo">
      <div id="reasoningEffortGroup" class="reasoning-effort-group">
        <label>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          Reasoning Effort (Extended Thinking)
        </label>
        <select id="reasoningEffort" class="form-input">
          <option value="">Default (model decides)</option>
          <option value="low">Low - Faster responses</option>
          <option value="medium">Medium - Balanced</option>
          <option value="high">High - More thorough reasoning</option>
        </select>
        <div class="reasoning-effort-hint">
          Controls how much time the model spends on extended thinking. Higher effort = more thorough but slower.
        </div>
      </div>
    </div>
  `;

  const listContainer = document.getElementById('modelListDropdown');
  const searchInput = document.getElementById('modelSearchInput');
  const hiddenInput = document.getElementById('mappingTo');

  function renderList(filter = '') {
    const f = filter.toLowerCase();
    let html = '';
    const sortedOwners = Object.keys(groupedModels).sort();
    let hasMatches = false;

    sortedOwners.forEach(owner => {
      const models = groupedModels[owner].filter(id => id.toLowerCase().includes(f));
      if (models.length > 0) {
        hasMatches = true;
        html += `<div class="model-group-title">${owner}</div>`;
        models.forEach(id => {
          html += `<div class="model-option" onclick="window.ampModule.selectModel('${id}')">${id}</div>`;
        });
      }
    });

    if (!hasMatches) {
      html = '<div style="padding:12px;color:var(--text-secondary);text-align:center">No models found</div>';
    }

    listContainer.innerHTML = html;
  }

  renderList();

  searchInput.addEventListener('focus', () => listContainer.classList.add('active'));
  searchInput.addEventListener('input', (e) => {
    listContainer.classList.add('active');
    renderList(e.target.value);
    hiddenInput.value = e.target.value;
    updateReasoningEffortVisibility(e.target.value);
  });

  setTimeout(() => {
    document.addEventListener('click', function closeList(e) {
      if (!e.target.closest('.model-selector')) {
        listContainer.classList.remove('active');
      }
    });
  }, 0);

  window.ampModule.modelSupportsReasoning = function(modelId) {
    if (!modelId) return false;
    const m = modelId.toLowerCase();
    return reasoningModels.some(rm => m.includes(rm.toLowerCase()));
  };

  window.ampModule.updateReasoningEffortVisibility = function(modelId) {
    const group = document.getElementById('reasoningEffortGroup');
    if (window.ampModule.modelSupportsReasoning(modelId)) {
      group.classList.add('visible');
    } else {
      group.classList.remove('visible');
    }
  };

  window.ampModule.setTargetInputMode = function(mode) {
    const btns = document.querySelectorAll('.input-mode-toggle .input-mode-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (mode === 'select') {
      btns[0].classList.add('active');
      document.getElementById('targetSelectMode').style.display = 'block';
      document.getElementById('targetManualMode').style.display = 'none';
      hiddenInput.value = searchInput.value;
      updateReasoningEffortVisibility(searchInput.value);
    } else {
      btns[1].classList.add('active');
      document.getElementById('targetSelectMode').style.display = 'none';
      document.getElementById('targetManualMode').style.display = 'block';
      const manualInput = document.getElementById('mappingToManual');
      hiddenInput.value = manualInput.value;
      updateReasoningEffortVisibility(manualInput.value);
    }
  };

  window.ampModule.selectModel = function(id) {
    hiddenInput.value = id;
    searchInput.value = id;
    listContainer.classList.remove('active');
    updateReasoningEffortVisibility(id);
  };

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.ampModule.closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.ampModule.saveAmpMapping('${oldFrom || ''}')">${oldFrom ? 'Save Changes' : 'Add Mapping'}</button>
  `;
  document.getElementById('modal').classList.add('active');

  if (oldFrom) {
    document.getElementById('mappingFrom').value = oldFrom;
    if (oldTo) {
      window.ampModule.selectModel(oldTo);
      document.getElementById('mappingToManual').value = oldTo;
    }
  }
  if (oldReasoningEffort) {
    document.getElementById('reasoningEffort').value = oldReasoningEffort;
  }
}

/**
 * Open edit mapping modal
 */
export async function openEditMappingModal(from, to) {
  let reasoningEffort = '';
  let cleanTo = to;
  const reasoningMatch = to.match(/:reasoning=(\w+)$/);
  if (reasoningMatch) {
    reasoningEffort = reasoningMatch[1];
    cleanTo = to.replace(/:reasoning=\w+$/, '');
  }
  await openAddMappingModal(from, cleanTo, reasoningEffort);
  document.getElementById('modalTitle').textContent = 'Edit Model Mapping';
}

/**
 * Open manage presets modal
 */
export function openManagePresetsModal() {
  const presets = getPresets();
  document.getElementById('modalTitle').textContent = 'Manage Source Presets';

  const content = `
    <div class="presets-list" style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
      <table style="width:100%; border-collapse: separate; border-spacing: 0 8px;">
        <thead>
          <tr style="color: var(--text-secondary); font-size: 12px;">
            <th style="padding: 0 8px; text-align: left;">Label</th>
            <th style="padding: 0 8px; text-align: left;">Source Model ID</th>
            <th style="width: 40px;"></th>
          </tr>
        </thead>
        <tbody id="presetsTableBody">
          ${presets.map(p => `
            <tr class="preset-row" id="preset-${p.id}">
              <td>
                <input type="text" class="form-input" value="${p.label}" placeholder="Label" onchange="window.ampModule.markUnsaved()">
              </td>
              <td>
                <input type="text" class="form-input" value="${p.value}" placeholder="Model ID" onchange="window.ampModule.markUnsaved()">
              </td>
              <td style="text-align: right;">
                <button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); window.ampModule.markUnsaved();" style="padding: 8px 12px;">×</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn btn-secondary btn-sm" onclick="window.ampModule.addPresetRow()" style="width: 100%; border-style: dashed;">+ Add New Preset</button>
    <p id="presetStatus" style="font-size:12px; color:var(--text-muted); margin-top:8px; text-align:right; opacity:0; transition:opacity 0.2s">Unsaved changes</p>
  `;

  document.getElementById('modalContent').innerHTML = content;

  document.getElementById('modalFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="window.ampModule.openAddMappingModal()">Back</button>
    <button class="btn btn-primary" onclick="window.ampModule.saveAllPresets()">Save Changes</button>
  `;
}

/**
 * Add preset row
 */
export function addPresetRow() {
  const tbody = document.getElementById('presetsTableBody');
  const tr = document.createElement('tr');
  tr.className = 'preset-row';
  tr.innerHTML = `
    <td><input type="text" class="form-input" placeholder="Label" autofocus></td>
    <td><input type="text" class="form-input" placeholder="Model ID"></td>
    <td style="text-align: right;">
      <button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); window.ampModule.markUnsaved();" style="padding: 8px 12px;">×</button>
    </td>
  `;
  tbody.appendChild(tr);
  markUnsaved();
}

/**
 * Mark presets as unsaved
 */
export function markUnsaved() {
  const el = document.getElementById('presetStatus');
  if (el) el.style.opacity = '1';
}

/**
 * Save all presets
 */
export function saveAllPresets() {
  const rows = document.querySelectorAll('.preset-row');
  const newPresets = [];
  let valid = true;

  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0].value.trim();
    const value = inputs[1].value.trim();

    if (label && value) {
      newPresets.push({
        id: Date.now() + Math.random(),
        label,
        value
      });
    } else if (label || value) {
      valid = false;
      inputs[0].style.borderColor = !label ? 'var(--accent-red)' : '';
      inputs[1].style.borderColor = !value ? 'var(--accent-red)' : '';
    }
  });

  if (!valid) {
    toast('Please fill in both fields for all presets', 'error');
    return;
  }

  localStorage.setItem('amp_source_presets', JSON.stringify(newPresets));
  toast('Presets saved', 'success');
  openAddMappingModal();
}

/**
 * Save amp mapping
 */
export async function saveAmpMapping(oldFromKey) {
  const from = document.getElementById('mappingFrom').value.trim();
  let to = document.getElementById('mappingTo').value.trim();
  const manualInput = document.getElementById('mappingToManual');
  if (!to && manualInput) {
    to = manualInput.value.trim();
  }
  const reasoningEffortEl = document.getElementById('reasoningEffort');
  const reasoningEffort = reasoningEffortEl ? reasoningEffortEl.value : '';

  if (!from || !to) {
    toast('Both fields are required', 'error');
    return;
  }

  let finalTo = to;
  if (reasoningEffort) {
    finalTo = to.replace(/:reasoning=\w+$/, '');
    finalTo = `${finalTo}:reasoning=${reasoningEffort}`;
  }

  try {
    const res = await api('GET', '/ampcode/model-mappings');
    const currentMappings = res['model-mappings'] || [];

    const exists = currentMappings.some(m => m.from === from);

    if ((!oldFromKey && exists) || (oldFromKey && oldFromKey !== from && exists)) {
      toast(`Mapping for source "${from}" already exists.`, 'error');
      return;
    }
    if (oldFromKey && oldFromKey !== from) {
      await api('DELETE', '/ampcode/model-mappings', { value: [oldFromKey] });
    }

    await api('PATCH', '/ampcode/model-mappings', {
      value: [{ from, to: finalTo }]
    });
    closeModal();
    toast('Mapping saved', 'success');
    loadAmpSettings();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Delete amp mapping
 */
export async function deleteAmpMapping(from) {
  if (!confirm(`Delete mapping for ${from}?`)) return;
  const apiKey = getApiKey();
  try {
    await fetch('/v0/management/ampcode/model-mappings', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: [from] })
    });
    toast('Mapping deleted', 'success');
    loadAmpSettings();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Load Amp settings from server
 */
export async function loadAmpSettings() {
  try {
    const res = await api('GET', '/ampcode');
    const d = res.ampcode || {};
    const upstreamUrl = d.upstream_url || d['upstream-url'] || '';
    const upstreamKey = d.upstream_api_key || d['upstream-api-key'] || '';
    
    document.getElementById('ampUpstreamUrl').value = upstreamUrl;
    document.getElementById('ampUpstreamKey').value = upstreamKey;

    updateAmpConnectionStatus(upstreamUrl, upstreamKey);

    document.getElementById('ampForce').checked = d.force_model_mappings || d['force-model-mappings'] || false;
    document.getElementById('ampRestrict').checked = d.restrict_management_to_localhost || d['restrict-management-to-localhost'] || false;

    const m = d.model_mappings || d['model-mappings'] || [];
    const c = document.getElementById('modelMappings');
    const countEl = document.getElementById('mappingCount');

    if (countEl) countEl.textContent = m.length;

    if (m.length === 0) {
      c.innerHTML = `<div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:16px;opacity:0.5;color:var(--text-secondary)"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg><h4>No Model Mappings</h4><p>Configure model aliases to map incoming model names to upstream models.</p></div>`;
    } else {
      c.innerHTML = m.map(item => {
        const parsed = parseTarget(item.to);
        const escapedFrom = escapeHtmlAttr(item.from);
        const escapedTo = escapeHtmlAttr(item.to);
        const escapedModel = escapeHtmlAttr(parsed.model);
        return `
        <div class="mapping-card" data-from="${escapedFrom}" data-to="${escapedTo}">
          <div class="mapping-flow">
            <div class="mapping-source" onclick="window.ampModule.copyMappingText(this, '${escapedFrom}')" title="Click to copy">${escapeHtmlAttr(item.from)}</div>
            <svg class="mapping-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
            <div class="mapping-target" onclick="window.ampModule.copyMappingText(this, '${escapedModel}')" title="Click to copy">${escapedModel}${reasoningBadge(parsed.reasoning)}</div>
          </div>
          <div class="mapping-actions">
            <button class="mapping-action-btn edit" onclick="window.ampModule.openEditMappingModal('${escapedFrom}', '${escapedTo}')" title="Edit mapping">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="mapping-action-btn delete" onclick="window.ampModule.deleteAmpMapping('${escapedFrom}')" title="Delete mapping">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `}).join('');
    }

    const searchInput = document.getElementById('mappingSearchInput');
    if (searchInput) searchInput.value = '';
    
    const noResults = document.getElementById('mappingsNoResults');
    if (noResults) noResults.classList.remove('visible');

    renderCombosSidePanel();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

// Helper for reasoning effort visibility
function updateReasoningEffortVisibility(modelId) {
  if (window.ampModule && window.ampModule.updateReasoningEffortVisibility) {
    window.ampModule.updateReasoningEffortVisibility(modelId);
  }
}

// Expose module functions globally for onclick handlers
window.ampModule = {
  loadAmpSettings,
  saveAmpSettings,
  testAmpConnection,
  toggleAmpSetting,
  toggleAmpKeyVisibility,
  filterMappings,
  copyMappingText,
  openAddMappingModal,
  openEditMappingModal,
  openManagePresetsModal,
  addPresetRow,
  markUnsaved,
  saveAllPresets,
  saveAmpMapping,
  deleteAmpMapping,
  renderCombosSidePanel,
  openManageCombosModal,
  openAddComboModal,
  addComboRow,
  saveCombo,
  deleteCombo,
  applyCombo,
  closeModal,
  selectModel: null,
  setTargetInputMode: null,
  updateReasoningEffortVisibility: null,
  modelSupportsReasoning: null
};

// Also expose directly for HTML onclick handlers
window.loadAmpSettings = loadAmpSettings;
window.saveAmpSettings = saveAmpSettings;
window.testAmpConnection = testAmpConnection;
window.toggleAmpSetting = toggleAmpSetting;
window.toggleAmpKeyVisibility = toggleAmpKeyVisibility;
window.openAddMappingModal = openAddMappingModal;
window.openManageCombosModal = openManageCombosModal;
window.openAddComboModal = openAddComboModal;
