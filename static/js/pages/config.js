/**
 * Configuration Page Module
 * Handles server configuration, settings toggles, and YAML editor
 */

import { api, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import { getConfigState, updateConfigState } from '../core/state.js';

/**
 * Load server configuration
 */
export async function loadConfig() {
  try {
    const [cfg, yaml] = await Promise.all([
      api('GET', '/config'),
      api('GET', '/config.yaml')
    ]);

    // Set toggle states and update status dots
    const debugChecked = cfg.debug || false;
    const usageStatsChecked = cfg.usage_statistics_enabled || cfg['usage-statistics-enabled'] || false;
    const loggingChecked = cfg.logging_to_file || cfg['logging-to-file'] || false;
    const requestLogChecked = cfg.request_log || cfg['request-log'] || false;
    const wsAuthChecked = cfg.websocket_auth || cfg['websocket-auth'] || false;

    const toggleDebug = document.getElementById('toggleDebug');
    const toggleUsageStats = document.getElementById('toggleUsageStats');
    const toggleLogging = document.getElementById('toggleLogging');
    const toggleRequestLog = document.getElementById('toggleRequestLog');
    const toggleWsAuth = document.getElementById('toggleWsAuth');

    if (toggleDebug) toggleDebug.checked = debugChecked;
    if (toggleUsageStats) toggleUsageStats.checked = usageStatsChecked;
    if (toggleLogging) toggleLogging.checked = loggingChecked;
    if (toggleRequestLog) toggleRequestLog.checked = requestLogChecked;
    if (toggleWsAuth) toggleWsAuth.checked = wsAuthChecked;

    // Update status dots
    updateStatusDot('statusDebug', debugChecked);
    updateStatusDot('statusUsageStats', usageStatsChecked);
    updateStatusDot('statusLogging', loggingChecked);
    updateStatusDot('statusRequestLog', requestLogChecked);
    updateStatusDot('statusWsAuth', wsAuthChecked);

    // Set YAML editor
    const editor = document.getElementById('configEditor');
    if (editor) {
      editor.value = yaml;
    }

    updateConfigState({
      originalYaml: yaml,
      hasUnsavedChanges: false
    });

    updateConfigEditorInfo();
    hideUnsavedIndicator();
    hideYamlError();
  } catch (e) {
    toast('Failed to load config: ' + e.message, 'error');
  }
}

/**
 * Update a status dot element
 */
function updateStatusDot(id, enabled) {
  const dot = document.getElementById(id);
  if (dot) {
    dot.classList.toggle('enabled', enabled);
  }
}

/**
 * Update the config editor info display (line count, char count)
 */
function updateConfigEditorInfo() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const content = editor.value;
  const lines = content.split('\n').length;
  const chars = content.length;

  const lineCountEl = document.getElementById('configLineCount');
  const charCountEl = document.getElementById('configCharCount');

  if (lineCountEl) {
    lineCountEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="17" y1="10" x2="3" y2="10"></line>
        <line x1="21" y1="6" x2="3" y2="6"></line>
        <line x1="21" y1="14" x2="3" y2="14"></line>
        <line x1="17" y1="18" x2="3" y2="18"></line>
      </svg>
      ${lines} lines`;
  }

  if (charCountEl) {
    charCountEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 7 4 4 20 4 20 7"></polyline>
        <line x1="9" y1="20" x2="15" y2="20"></line>
        <line x1="12" y1="4" x2="12" y2="20"></line>
      </svg>
      ${chars.toLocaleString()} chars`;
  }
}

/**
 * Handle config editor input changes
 */
export function onConfigEditorInput() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const configState = getConfigState();
  updateConfigEditorInfo();

  // Check for unsaved changes
  if (editor.value !== configState.originalYaml) {
    updateConfigState({ hasUnsavedChanges: true });
    showUnsavedIndicator();
  } else {
    updateConfigState({ hasUnsavedChanges: false });
    hideUnsavedIndicator();
  }

  // Validate YAML on input (debounced)
  clearTimeout(window._configValidateTimeout);
  window._configValidateTimeout = setTimeout(() => {
    validateYaml(editor.value);
  }, 500);
}

/**
 * Show unsaved changes indicator
 */
function showUnsavedIndicator() {
  const indicator = document.getElementById('configUnsavedIndicator');
  if (indicator) indicator.classList.add('visible');
}

/**
 * Hide unsaved changes indicator
 */
function hideUnsavedIndicator() {
  const indicator = document.getElementById('configUnsavedIndicator');
  if (indicator) indicator.classList.remove('visible');
}

/**
 * Validate YAML content
 */
function validateYaml(content) {
  try {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check for tabs (YAML uses spaces)
      if (line.includes('\t')) {
        showYamlError(`Line ${i + 1}: Tab characters are not allowed in YAML. Use spaces for indentation.`);
        return false;
      }
      // Check for inconsistent indentation
      const leadingSpaces = line.match(/^(\s*)/)[1].length;
      if (leadingSpaces % 2 !== 0 && line.trim().length > 0) {
        showYamlError(`Line ${i + 1}: Indentation should use 2 spaces.`);
        return false;
      }
    }
    hideYamlError();
    return true;
  } catch (e) {
    showYamlError(e.message);
    return false;
  }
}

/**
 * Show YAML error banner
 */
function showYamlError(message) {
  const banner = document.getElementById('yamlErrorBanner');
  const msgEl = document.getElementById('yamlErrorMessage');
  if (banner && msgEl) {
    msgEl.textContent = message;
    banner.classList.add('visible');
  }
}

/**
 * Hide YAML error banner
 */
function hideYamlError() {
  const banner = document.getElementById('yamlErrorBanner');
  if (banner) banner.classList.remove('visible');
}

/**
 * Reload configuration from server
 */
export async function reloadConfig() {
  const configState = getConfigState();
  if (configState.hasUnsavedChanges) {
    if (!confirm('You have unsaved changes. Reload and discard them?')) {
      return;
    }
  }
  toast('Reloading configuration...', 'info');
  await loadConfig();
  toast('Configuration reloaded', 'success');
}

/**
 * Toggle a server setting with enhanced UI feedback
 */
export async function toggleSettingEnhanced(setting, value, inputEl) {
  const label = inputEl.closest('.toggle-enhanced');
  const statusDotId = {
    'debug': 'statusDebug',
    'usage-statistics-enabled': 'statusUsageStats',
    'logging-to-file': 'statusLogging',
    'request-log': 'statusRequestLog',
    'ws-auth': 'statusWsAuth'
  }[setting];

  if (label) label.classList.add('loading');

  try {
    await api('PUT', `/${setting}`, { value });

    updateStatusDot(statusDotId, value);

    if (label) {
      label.classList.remove('loading');
      label.classList.add('success');
      setTimeout(() => label.classList.remove('success'), 400);
    }

    const statusEl = document.getElementById('settingsStatus');
    if (statusEl) {
      statusEl.style.display = 'flex';
      setTimeout(() => { statusEl.style.display = 'none'; }, 2000);
    }

    toast(`${setting.replace(/-/g, ' ')} ${value ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    inputEl.checked = !value;
    if (label) label.classList.remove('loading');
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Save configuration with enhanced UI feedback
 */
export async function saveConfigEnhanced() {
  const editor = document.getElementById('configEditor');
  const btn = document.getElementById('btnSaveConfig');
  const btnText = document.getElementById('saveConfigText');
  const btnIcon = document.getElementById('saveConfigIcon');

  if (!editor) return;

  if (!validateYaml(editor.value)) {
    toast('Please fix YAML errors before saving', 'error');
    return;
  }

  if (btn) btn.classList.add('saving');
  if (btnText) btnText.textContent = 'Saving...';
  if (btnIcon) {
    btnIcon.innerHTML = '<circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle>';
  }

  try {
    const response = await fetch('/v0/management/config.yaml', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/yaml'
      },
      body: editor.value
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to save configuration');
    }

    updateConfigState({
      originalYaml: editor.value,
      hasUnsavedChanges: false
    });
    hideUnsavedIndicator();

    if (btnIcon) {
      btnIcon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    }
    if (btnText) btnText.textContent = 'Saved!';

    toast('Configuration saved successfully', 'success');

    setTimeout(() => {
      if (btn) btn.classList.remove('saving');
      if (btnText) btnText.textContent = 'Save';
      if (btnIcon) {
        btnIcon.innerHTML = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>';
      }
    }, 2000);

  } catch (e) {
    if (btn) btn.classList.remove('saving');
    if (btnText) btnText.textContent = 'Save';
    if (btnIcon) {
      btnIcon.innerHTML = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>';
    }
    toast('Failed to save: ' + e.message, 'error');
  }
}

/**
 * Setup keyboard shortcut for save (Ctrl+S)
 */
export function setupConfigKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      const configEditor = document.getElementById('configEditor');
      if (configEditor && document.activeElement === configEditor) {
        e.preventDefault();
        saveConfigEnhanced();
      }
    }
  });
}

// Export module interface for global access
export const configModule = {
  loadConfig,
  saveConfigEnhanced,
  reloadConfig,
  toggleSettingEnhanced,
  onConfigEditorInput,
  setupConfigKeyboardShortcuts
};

// Expose functions to window for HTML onclick handlers
window.configModule = configModule;
window.loadConfig = loadConfig;
window.saveConfigEnhanced = saveConfigEnhanced;
window.reloadConfig = reloadConfig;
window.toggleSettingEnhanced = toggleSettingEnhanced;
window.onConfigEditorInput = onConfigEditorInput;
