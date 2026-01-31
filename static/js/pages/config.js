/**
 * Configuration Page Module
 * Handles server configuration, settings toggles, and YAML editor
 */

import { api, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import { getConfigState, updateConfigState } from '../core/state.js';

// ===================================
// Constants
// ===================================

const CONSTANTS = {
  DEBOUNCE_SYNTAX_HIGHLIGHT: 50,
  DEBOUNCE_YAML_VALIDATE: 500,
  DEBOUNCE_AUTOSAVE: 30000, // 30 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_BASE: 1000, // 1 second base for exponential backoff
  API_TIMEOUT: 30000, // 30 seconds
  LINE_HEIGHT_DEFAULT: 20.8,
  PADDING_TOP_DEFAULT: 16,
  REGEX_TIMEOUT: 5000, // 5 seconds max for regex operations
  MAX_REGEX_LENGTH: 1000, // Max length for user-provided regex
};

// ===================================
// Module State (avoid global window variables)
// ===================================

const moduleState = {
  syntaxHighlightTimeout: null,
  configValidateTimeout: null,
  autosaveTimeout: null,
  pendingToggles: new Set(), // Track in-flight toggle operations
  undoStack: [],
  redoStack: [],
  maxUndoStackSize: 100,
  lastSavedDraft: null,
  beforeUnloadHandler: null,
  suppressUndoTracking: false,
  lastEditorValue: null,
  lastSelectionStart: 0,
  lastSelectionEnd: 0,
};

// ===================================
// Helper Functions
// ===================================

/**
 * Retry an async operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum retry attempts
 * @param {number} baseDelay - Base delay in ms for exponential backoff
 * @returns {Promise} - Result of the function
 */
async function withRetry(fn, maxAttempts = CONSTANTS.RETRY_ATTEMPTS, baseDelay = CONSTANTS.RETRY_DELAY_BASE) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Wrap a fetch call with timeout
 * @param {Promise} fetchPromise - The fetch promise
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} - Result or timeout error
 */
function withTimeout(fetchPromise, timeout = CONSTANTS.API_TIMEOUT) {
  return Promise.race([
    fetchPromise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Request timed out')), timeout)
    )
  ]);
}

/**
 * Save draft to localStorage
 */
function saveDraftToLocalStorage() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;
  
  try {
    const draft = {
      content: editor.value,
      timestamp: Date.now(),
    };
    localStorage.setItem('config_draft', JSON.stringify(draft));
    moduleState.lastSavedDraft = draft.timestamp;
  } catch (e) {
    console.warn('Failed to save draft to localStorage:', e.message);
  }
}

/**
 * Load draft from localStorage
 * @returns {Object|null} - Draft object or null
 */
function loadDraftFromLocalStorage() {
  try {
    const draft = localStorage.getItem('config_draft');
    if (draft) {
      return JSON.parse(draft);
    }
  } catch (e) {
    console.warn('Failed to load draft from localStorage:', e.message);
  }
  return null;
}

/**
 * Clear draft from localStorage
 */
function clearDraftFromLocalStorage() {
  try {
    localStorage.removeItem('config_draft');
    moduleState.lastSavedDraft = null;
  } catch (e) {
    console.warn('Failed to clear draft from localStorage:', e.message);
  }
}

/**
 * Setup beforeunload handler for unsaved changes warning
 */
export function setupUnsavedChangesWarning() {
  // Remove existing handler if any
  if (moduleState.beforeUnloadHandler) {
    window.removeEventListener('beforeunload', moduleState.beforeUnloadHandler);
  }
  
  moduleState.beforeUnloadHandler = (e) => {
    const configState = getConfigState();
    if (configState.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    }
  };
  
  window.addEventListener('beforeunload', moduleState.beforeUnloadHandler);
}

/**
 * Remove beforeunload handler
 */
export function removeUnsavedChangesWarning() {
  if (moduleState.beforeUnloadHandler) {
    window.removeEventListener('beforeunload', moduleState.beforeUnloadHandler);
    moduleState.beforeUnloadHandler = null;
  }
}

/**
 * Schedule autosave of draft
 */
function scheduleAutosave() {
  if (moduleState.autosaveTimeout) {
    clearTimeout(moduleState.autosaveTimeout);
  }
  
  moduleState.autosaveTimeout = setTimeout(() => {
    const configState = getConfigState();
    if (configState.hasUnsavedChanges) {
      saveDraftToLocalStorage();
    }
  }, CONSTANTS.DEBOUNCE_AUTOSAVE);
}

/**
 * Check for and offer to restore draft
 */
export async function checkForDraft() {
  const draft = loadDraftFromLocalStorage();
  if (!draft) return false;
  
  // Check if draft is less than 24 hours old
  const ageHours = (Date.now() - draft.timestamp) / (1000 * 60 * 60);
  if (ageHours > 24) {
    clearDraftFromLocalStorage();
    return false;
  }
  
  const editor = document.getElementById('configEditor');
  if (!editor) return false;
  
  // Check if draft differs from current content
  if (draft.content === editor.value) {
    clearDraftFromLocalStorage();
    return false;
  }
  
  // Ask user if they want to restore
  const timeAgo = formatTimeAgo(draft.timestamp);
  if (confirm(`A draft from ${timeAgo} was found. Would you like to restore it?`)) {
    editor.value = draft.content;
    onConfigEditorInput();
    toast('Draft restored', 'success');
    return true;
  } else {
    clearDraftFromLocalStorage();
    return false;
  }
}

/**
 * Format timestamp as "X minutes/hours ago"
 */
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'a few seconds ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours > 1 ? 's' : ''} ago`;
}

/**
 * Load server configuration
 */
export async function loadConfig() {
  try {
    // Use retry logic for resilience against network issues
    const [cfg, yaml] = await withRetry(async () => {
      return await Promise.all([
        api('GET', '/config'),
        api('GET', '/config.yaml')
      ]);
    });

    // Set toggle states and update status dots
    const debugChecked = cfg.debug || false;
    const usageStatsChecked = cfg.usage_statistics_enabled || cfg['usage-statistics-enabled'] || false;
    const loggingChecked = cfg.logging_to_file || cfg['logging-to-file'] || false;
    const requestLogChecked = cfg.request_log || cfg['request-log'] || false;
    const rateLimitChecked = cfg['rate-limit']?.enabled || false;

    const toggleDebug = document.getElementById('toggleDebug');
    const toggleUsageStats = document.getElementById('toggleUsageStats');
    const toggleLogging = document.getElementById('toggleLogging');
    const toggleRequestLog = document.getElementById('toggleRequestLog');
    const toggleRateLimit = document.getElementById('toggleRateLimit');

    if (toggleDebug) toggleDebug.checked = debugChecked;
    if (toggleUsageStats) toggleUsageStats.checked = usageStatsChecked;
    if (toggleLogging) toggleLogging.checked = loggingChecked;
    if (toggleRequestLog) toggleRequestLog.checked = requestLogChecked;
    if (toggleRateLimit) toggleRateLimit.checked = rateLimitChecked;

    // Update status dots
    updateStatusDot('statusDebug', debugChecked);
    updateStatusDot('statusUsageStats', usageStatsChecked);
    updateStatusDot('statusLogging', loggingChecked);
    updateStatusDot('statusRequestLog', requestLogChecked);
    updateStatusDot('statusRateLimit', rateLimitChecked);

    // Set YAML editor
    const editor = document.getElementById('configEditor');
    if (editor) {
      editor.value = yaml;
    }

    moduleState.undoStack = [];
    moduleState.redoStack = [];
    if (editor) {
      moduleState.lastEditorValue = editor.value;
      moduleState.lastSelectionStart = editor.selectionStart;
      moduleState.lastSelectionEnd = editor.selectionEnd;
    }

    updateConfigState({
      originalYaml: yaml,
      hasUnsavedChanges: false
    });

    updateConfigEditorInfo();
    updateSyntaxHighlight();
    hideUnsavedIndicator();
    hideYamlError();
    
    // Setup unsaved changes warning
    setupUnsavedChangesWarning();
    
    // Check for any saved drafts after a short delay
    setTimeout(() => checkForDraft(), 500);
    
    // Load cost limits state separately (uses different API endpoint)
    loadCostLimitsState();
  } catch (e) {
    toast('Failed to load config: ' + e.message, 'error');
  }
}

/**
 * Update a status dot element and its parent card
 */
function updateStatusDot(id, enabled) {
  const dot = document.getElementById(id);
  if (dot) {
    dot.classList.toggle('enabled', enabled);
    
    // Update status text
    const card = dot.closest('.quick-toggle-card');
    if (card) {
      card.classList.toggle('active', enabled);
      const statusText = card.querySelector('.status-text');
      if (statusText) {
        statusText.textContent = enabled ? 'On' : 'Off';
      }
    }
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
    lineCountEl.textContent = `${lines} lines`;
  }

  if (charCountEl) {
    charCountEl.textContent = `${chars.toLocaleString()} chars`;
  }

  // Also update line numbers
  updateLineNumbers();
}

/**
 * Handle config editor input changes
 */
export function onConfigEditorInput() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  if (!moduleState.suppressUndoTracking) {
    const lastValue = moduleState.lastEditorValue;
    if (lastValue !== null && editor.value !== lastValue) {
      moduleState.undoStack.push({
        value: lastValue,
        selectionStart: moduleState.lastSelectionStart,
        selectionEnd: moduleState.lastSelectionEnd,
      });
      if (moduleState.undoStack.length > moduleState.maxUndoStackSize) {
        moduleState.undoStack.shift();
      }
      moduleState.redoStack = [];
    }
  }

  moduleState.lastEditorValue = editor.value;
  moduleState.lastSelectionStart = editor.selectionStart;
  moduleState.lastSelectionEnd = editor.selectionEnd;

  const configState = getConfigState();
  updateConfigEditorInfo();

  // Update syntax highlighting (debounced for performance)
  if (moduleState.syntaxHighlightTimeout) {
    clearTimeout(moduleState.syntaxHighlightTimeout);
  }
  moduleState.syntaxHighlightTimeout = setTimeout(() => {
    updateSyntaxHighlight();
  }, CONSTANTS.DEBOUNCE_SYNTAX_HIGHLIGHT);

  // Update current line highlight
  updateCurrentLineHighlight();

  // Check for unsaved changes
  if (editor.value !== configState.originalYaml) {
    updateConfigState({ hasUnsavedChanges: true });
    showUnsavedIndicator();
    // Schedule autosave when there are unsaved changes
    scheduleAutosave();
  } else {
    updateConfigState({ hasUnsavedChanges: false });
    hideUnsavedIndicator();
  }

  // Validate YAML on input (debounced)
  if (moduleState.configValidateTimeout) {
    clearTimeout(moduleState.configValidateTimeout);
  }
  moduleState.configValidateTimeout = setTimeout(() => {
    validateYaml(editor.value);
  }, CONSTANTS.DEBOUNCE_YAML_VALIDATE);
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
 * Validate YAML content with comprehensive checks
 * Includes syntax validation beyond just indentation
 */
function validateYaml(content) {
  try {
    const lines = content.split('\n');
    const errors = [];
    let inMultilineString = false;
    let multilineIndent = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Handle multiline strings (|, >, |-, >-, |+, >+)
      if (inMultilineString) {
        const currentIndent = line.match(/^(\s*)/)[1].length;
        if (currentIndent <= multilineIndent && trimmedLine !== '') {
          inMultilineString = false;
        } else {
          continue; // Skip validation inside multiline strings
        }
      }
      
      // Check for tabs (YAML uses spaces)
      if (line.includes('\t')) {
        errors.push(`Line ${lineNum}: Tab characters are not allowed in YAML. Use spaces for indentation.`);
        continue;
      }
      
      // Check for inconsistent indentation (warning, not error for flexibility)
      const leadingSpaces = line.match(/^(\s*)/)[1].length;
      
      // Detect start of multiline string
      if (/:\s*[|>][-+]?\s*$/.test(line)) {
        inMultilineString = true;
        multilineIndent = leadingSpaces;
        continue;
      }
      
      // Check for invalid key format (keys shouldn't start with special chars except for anchors/aliases)
      if (/^\s*[{}\[\],]/.test(line) && !trimmedLine.startsWith('-')) {
        // This might be flow style YAML, which is valid but let's warn
      }
      
      // Check for duplicate colons in key (common typo)
      const keyPart = line.split(':')[0];
      if (keyPart && (keyPart.match(/:/g) || []).length > 0) {
        // Could be a URL or special value, skip
      }
      
      // Check for unquoted special characters that might cause issues
      if (/:\s+[@`]/.test(line)) {
        errors.push(`Line ${lineNum}: Special characters after colon should be quoted.`);
      }
      
      // Check for trailing spaces (warning)
      if (line !== line.trimEnd()) {
        // Trailing spaces - minor issue, don't block
      }
      
      // Check for incorrect boolean/null format (common mistakes)
      const valueMatch = line.match(/:\s*(.+)$/);
      if (valueMatch) {
        const value = valueMatch[1].trim();
        // Check for unquoted Yes/No which YAML 1.1 treats as boolean
        if (/^(Yes|No)$/i.test(value) && !/^["']/.test(value)) {
          // This is valid YAML but might be unintended
        }
      }
      
      // Check for missing space after colon in key-value pairs
      if (/^[^#]*:[^\s]/.test(line) && !/:\/\//.test(line)) {
        // Could be URL, but check if it looks like a key-value
        const colonIndex = line.indexOf(':');
        const beforeColon = line.substring(0, colonIndex).trim();
        // If it's a simple key (no special chars), it needs space after colon
        if (/^[\w-]+$/.test(beforeColon) && line.charAt(colonIndex + 1) !== ' ' && line.charAt(colonIndex + 1) !== '\n') {
          errors.push(`Line ${lineNum}: Missing space after colon in key-value pair.`);
        }
      }
    }
    
    if (errors.length > 0) {
      showYamlError(errors[0]); // Show first error
      return false;
    }
    
    hideYamlError();
    return true;
  } catch (e) {
    showYamlError('Validation error: ' + e.message);
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
 * Includes race condition prevention and retry logic
 */
export async function toggleSettingEnhanced(setting, value, inputEl) {
  // Prevent race conditions - if this setting is already being toggled, ignore
  if (moduleState.pendingToggles.has(setting)) {
    // Revert the checkbox to its previous state
    inputEl.checked = !value;
    toast('Please wait for the previous operation to complete', 'warning');
    return;
  }
  
  const label = inputEl.closest('.toggle-enhanced');
  const statusDotId = {
    'debug': 'statusDebug',
    'usage-statistics-enabled': 'statusUsageStats',
    'logging-to-file': 'statusLogging',
    'request-log': 'statusRequestLog',
    'rate-limit-enabled': 'statusRateLimit'
  }[setting];

  // Mark this setting as pending
  moduleState.pendingToggles.add(setting);
  
  // Disable the input to prevent rapid clicks
  inputEl.disabled = true;
  if (label) label.classList.add('loading');

  try {
    // Use retry logic for network resilience
    await withRetry(async () => {
      await api('PUT', `/${setting}`, { value });
    }, 2); // Max 2 retries for toggle operations

    updateStatusDot(statusDotId, value);

    if (label) {
      label.classList.remove('loading');
      label.classList.add('success');
      setTimeout(() => label.classList.remove('success'), 400);
    }

    toast(`${setting.replace(/-/g, ' ')} ${value ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    // Revert the checkbox on failure
    inputEl.checked = !value;
    updateStatusDot(statusDotId, !value);
    if (label) label.classList.remove('loading');
    toast('Failed: ' + e.message, 'error');
  } finally {
    // Re-enable the input and remove from pending set
    inputEl.disabled = false;
    moduleState.pendingToggles.delete(setting);
  }
}

/**
 * Load cost limits state from API
 * Now includes retry logic and proper user notification on failure
 */
export async function loadCostLimitsState() {
  try {
    const data = await withRetry(async () => {
      return await api('GET', '/access-key-limits');
    }, 2); // 2 retries for cost limits
    
    const enabled = data.enabled || false;
    const countOnlySuccess = data.count_only_success_requests || false;
    
    const toggle = document.getElementById('toggleCostLimits');
    if (toggle) toggle.checked = enabled;
    
    const countOnlySuccessToggle = document.getElementById('toggleCountOnlySuccessRequests');
    if (countOnlySuccessToggle) countOnlySuccessToggle.checked = countOnlySuccess;
    
    updateStatusDot('statusCostLimits', enabled);
    updateStatusDot('statusCountOnlySuccessRequests', countOnlySuccess);
  } catch (e) {
    // Show user-friendly notification instead of silent failure
    console.warn('Could not load cost limits state:', e.message);
    toast('Could not load cost limits settings', 'warning');
    
    // Disable the toggles to indicate unavailable state
    const toggle = document.getElementById('toggleCostLimits');
    const countOnlySuccessToggle = document.getElementById('toggleCountOnlySuccessRequests');
    if (toggle) {
      toggle.disabled = true;
      toggle.title = 'Cost limits unavailable';
    }
    if (countOnlySuccessToggle) {
      countOnlySuccessToggle.disabled = true;
      countOnlySuccessToggle.title = 'Cost limits unavailable';
    }
  }
}

/**
 * Toggle cost limits enabled state
 * Includes race condition prevention and retry logic
 */
export async function toggleCostLimitsEnabled(value, inputEl) {
  const settingKey = 'cost-limits-enabled';
  
  // Prevent race conditions
  if (moduleState.pendingToggles.has(settingKey)) {
    inputEl.checked = !value;
    toast('Please wait for the previous operation to complete', 'warning');
    return;
  }
  
  const label = inputEl.closest('.toggle-enhanced');
  
  moduleState.pendingToggles.add(settingKey);
  inputEl.disabled = true;
  if (label) label.classList.add('loading');
  
  try {
    await withRetry(async () => {
      await api('PUT', '/access-key-limits/enabled', { enabled: value });
    }, 2);
    
    updateStatusDot('statusCostLimits', value);
    
    if (label) {
      label.classList.remove('loading');
      label.classList.add('success');
      setTimeout(() => label.classList.remove('success'), 400);
    }
    
    toast(`Cost limits ${value ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    inputEl.checked = !value;
    updateStatusDot('statusCostLimits', !value);
    if (label) label.classList.remove('loading');
    toast('Failed: ' + e.message, 'error');
  } finally {
    inputEl.disabled = false;
    moduleState.pendingToggles.delete(settingKey);
  }
}

/**
 * Toggle count only success requests state
 * Includes race condition prevention and retry logic
 */
export async function toggleCountOnlySuccessRequests(value, inputEl) {
  const settingKey = 'count-only-success-requests';
  
  // Prevent race conditions
  if (moduleState.pendingToggles.has(settingKey)) {
    inputEl.checked = !value;
    toast('Please wait for the previous operation to complete', 'warning');
    return;
  }
  
  const label = inputEl.closest('.toggle-enhanced');
  
  moduleState.pendingToggles.add(settingKey);
  inputEl.disabled = true;
  if (label) label.classList.add('loading');
  
  try {
    await withRetry(async () => {
      await api('PUT', '/access-key-limits/count-only-success-requests', { count_only_success_requests: value });
    }, 2);
    
    updateStatusDot('statusCountOnlySuccessRequests', value);
    
    if (label) {
      label.classList.remove('loading');
      label.classList.add('success');
      setTimeout(() => label.classList.remove('success'), 400);
    }
    
    toast(`Request limit now counts ${value ? 'only successful requests' : 'all requests'}`, 'success');
  } catch (e) {
    inputEl.checked = !value;
    updateStatusDot('statusCountOnlySuccessRequests', !value);
    if (label) label.classList.remove('loading');
    toast('Failed: ' + e.message, 'error');
  } finally {
    inputEl.disabled = false;
    moduleState.pendingToggles.delete(settingKey);
  }
}

/**
 * Save configuration with enhanced UI feedback
 * Includes retry logic and draft cleanup
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

  // Prevent double-save
  if (btn && btn.classList.contains('saving')) {
    return;
  }

  if (btn) btn.classList.add('saving');
  if (btnText) btnText.textContent = 'Saving...';
  if (btnIcon) {
    btnIcon.innerHTML = '<circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle>';
  }

  try {
    // Use retry logic with timeout for network resilience
    await withRetry(async () => {
      const response = await withTimeout(
        fetch('/v0/management/config.yaml', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${getApiKey()}`,
            'Content-Type': 'application/yaml'
          },
          body: editor.value
        }),
        CONSTANTS.API_TIMEOUT
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to save configuration');
      }
    }, 2); // 2 retries for save

    updateConfigState({
      originalYaml: editor.value,
      hasUnsavedChanges: false
    });
    hideUnsavedIndicator();
    
    // Clear the draft since we successfully saved
    clearDraftFromLocalStorage();

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
 * Setup keyboard shortcuts for the config editor
 */
export function setupConfigKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Skip if already handled by textarea's onkeydown
    if (e.defaultPrevented) return;
    
    const configEditor = document.getElementById('configEditor');
    if (!configEditor || document.activeElement !== configEditor) return;

    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveConfigEnhanced();
      return;
    }

    // Ctrl+Z: Undo (custom implementation)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      editorUndo();
      return;
    }

    // Ctrl+Y or Ctrl+Shift+Z: Redo (custom implementation)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      editorRedo();
      return;
    }

    // Ctrl+/: Toggle comment (use e.code for reliability across keyboard layouts)
    if ((e.ctrlKey || e.metaKey) && (e.code === 'Slash' || e.key === '/' || e.key === '?')) {
      e.preventDefault();
      editorToggleComment();
      return;
    }

    // Ctrl+D: Duplicate line
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      editorDuplicateLine();
      return;
    }

    // Ctrl+Shift+K: Delete line
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      editorDeleteLine();
      return;
    }

    // Tab: Insert spaces (2 spaces for YAML)
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (e.shiftKey) {
        editorOutdent();
      } else {
        editorIndent();
      }
      return;
    }

    // Enter: Auto-indent
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      editorAutoIndentNewline();
      return;
    }

    // Ctrl+F: Find
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      editorOpenFind();
      return;
    }

    // Ctrl+Shift+F: Format YAML
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      formatYamlConfig();
      return;
    }

    // Ctrl+H: Replace
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault();
      editorOpenReplace();
      return;
    }

    // Ctrl+G: Go to line
    if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
      e.preventDefault();
      editorGoToLine();
      return;
    }

    // Escape: Close find/goto modals
    if (e.key === 'Escape') {
      const findBar = document.getElementById('editorFindBar');
      const gotoModal = document.getElementById('editorGotoModal');
      if (findBar && findBar.style.display !== 'none') {
        editorCloseFind();
        e.preventDefault();
      } else if (gotoModal && gotoModal.style.display !== 'none') {
        editorCloseGoto();
        e.preventDefault();
      }
      return;
    }
  });
}

/**
 * Push state to undo stack
 */
function pushToUndoStack(editor) {
  if (moduleState.suppressUndoTracking) {
    moduleState.lastEditorValue = editor.value;
    moduleState.lastSelectionStart = editor.selectionStart;
    moduleState.lastSelectionEnd = editor.selectionEnd;
    return;
  }

  const state = {
    value: editor.value,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
  };
  
  moduleState.undoStack.push(state);
  
  // Limit stack size
  if (moduleState.undoStack.length > moduleState.maxUndoStackSize) {
    moduleState.undoStack.shift();
  }
  
  // Clear redo stack when new action is performed
  moduleState.redoStack = [];
}

/**
 * Replace editor content with custom undo stack support
 * No longer relies on deprecated document.execCommand()
 */
function replaceEditorContent(editor, newValue, selStart, selEnd) {
  // Save current state to undo stack before making changes
  pushToUndoStack(editor);

  // Update the value
  moduleState.suppressUndoTracking = true;
  editor.value = newValue;
  moduleState.suppressUndoTracking = false;

  // Restore selection
  editor.setSelectionRange(selStart, selEnd);
  editor.focus();
}

/**
 * Toggle YAML comment on selected lines
 */
export function editorToggleComment() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const originalSelStart = editor.selectionStart;
  const originalSelEnd = editor.selectionEnd;
  const value = editor.value;
  const lines = value.split('\n');

  // Precompute original line start offsets
  const lineStarts = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = pos;
    pos += lines[i].length + 1; // + '\n'
  }

  const offsetToLineIndex = (offset) => {
    offset = Math.max(0, Math.min(offset, value.length));
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount <= offset && offset <= charCount + lines[i].length) return i;
      charCount += lines[i].length + 1;
    }
    return lines.length - 1;
  };

  const startLine = offsetToLineIndex(originalSelStart);
  const endPos = Math.max(originalSelStart, originalSelEnd - 1);
  const endLine = offsetToLineIndex(endPos);

  const nonEmptySelected = lines
    .slice(startLine, endLine + 1)
    .filter(line => line.trim() !== '');

  if (nonEmptySelected.length === 0) return;

  const allCommented = nonEmptySelected.every(line => line.trimStart().startsWith('#'));

  let newSelStart = originalSelStart;
  let newSelEnd = originalSelEnd;

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    const leading = (line.match(/^(\s*)/)?.[1]) ?? '';
    const editIndex = lineStarts[i] + leading.length;

    const newLine = allCommented
      ? line.replace(/^(\s*)#\s?/, '$1')
      : (leading + '# ' + line.slice(leading.length));

    const delta = newLine.length - line.length;
    if (delta !== 0) {
      if (originalSelStart > editIndex) newSelStart += delta;
      if (originalSelEnd > editIndex) newSelEnd += delta;
      
      // Update lineStarts for subsequent lines
      for (let j = i + 1; j < lineStarts.length; j++) {
        lineStarts[j] += delta;
      }
      lines[i] = newLine;
    }
  }

  const newValue = lines.join('\n');
  replaceEditorContent(editor, newValue, newSelStart, newSelEnd);

  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Indent selected lines
 */
export function editorIndent() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const { selectionStart, selectionEnd, value } = editor;
  const lines = value.split('\n');
  
  // Find line indices
  let charCount = 0;
  let startLine = 0;
  let endLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (charCount <= selectionStart && charCount + lines[i].length >= selectionStart) {
      startLine = i;
    }
    if (charCount + lines[i].length >= selectionEnd - 1 || i === lines.length - 1) {
      endLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }

  // If only one line and cursor is at start, just insert spaces
  if (startLine === endLine && selectionStart === selectionEnd) {
    const beforeCursor = value.substring(0, selectionStart);
    const afterCursor = value.substring(selectionEnd);
    editor.value = beforeCursor + '  ' + afterCursor;
    editor.selectionStart = editor.selectionEnd = selectionStart + 2;
    onConfigEditorInput();
    return;
  }

  // Indent all selected lines
  let addedSpaces = 0;
  for (let i = startLine; i <= endLine; i++) {
    if (lines[i].trim() !== '') {
      lines[i] = '  ' + lines[i];
      addedSpaces += 2;
    }
  }

  editor.value = lines.join('\n');
  editor.selectionStart = selectionStart + 2;
  editor.selectionEnd = selectionEnd + addedSpaces;
  
  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Outdent selected lines
 */
export function editorOutdent() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const { selectionStart, selectionEnd, value } = editor;
  const lines = value.split('\n');
  
  // Find line indices
  let charCount = 0;
  let startLine = 0;
  let endLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (charCount <= selectionStart && charCount + lines[i].length >= selectionStart) {
      startLine = i;
    }
    if (charCount + lines[i].length >= selectionEnd - 1 || i === lines.length - 1) {
      endLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }

  // Remove leading spaces
  let removedSpaces = 0;
  let firstLineRemoved = 0;
  for (let i = startLine; i <= endLine; i++) {
    const match = lines[i].match(/^( {1,2})/);
    if (match) {
      const removed = match[1].length;
      lines[i] = lines[i].substring(removed);
      removedSpaces += removed;
      if (i === startLine) firstLineRemoved = removed;
    }
  }

  editor.value = lines.join('\n');
  editor.selectionStart = Math.max(0, selectionStart - firstLineRemoved);
  editor.selectionEnd = Math.max(0, selectionEnd - removedSpaces);
  
  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Duplicate current line
 */
export function editorDuplicateLine() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const { selectionStart, value } = editor;
  const lines = value.split('\n');
  
  // Find current line
  let charCount = 0;
  let currentLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= selectionStart) {
      currentLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }

  // Duplicate line
  const lineToDuplicate = lines[currentLine];
  lines.splice(currentLine + 1, 0, lineToDuplicate);

  editor.value = lines.join('\n');
  editor.selectionStart = editor.selectionEnd = selectionStart + lineToDuplicate.length + 1;
  
  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Delete current line
 */
export function editorDeleteLine() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const { selectionStart, value } = editor;
  const lines = value.split('\n');
  
  if (lines.length === 1) {
    editor.value = '';
    editor.selectionStart = editor.selectionEnd = 0;
    onConfigEditorInput();
    updateLineNumbers();
    return;
  }

  // Find current line
  let charCount = 0;
  let currentLine = 0;
  
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= selectionStart) {
      currentLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }

  // Delete line
  const deletedLineLength = lines[currentLine].length + 1;
  lines.splice(currentLine, 1);

  editor.value = lines.join('\n');
  
  // Position cursor at same line (or previous if at end)
  let newPos = charCount;
  if (currentLine >= lines.length) {
    newPos = editor.value.length;
  }
  editor.selectionStart = editor.selectionEnd = Math.min(newPos, editor.value.length);
  
  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Auto-indent on Enter key
 */
function editorAutoIndentNewline() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const { selectionStart, selectionEnd, value } = editor;
  
  // Find current line
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const currentLine = value.substring(lineStart, selectionStart);
  
  // Get leading whitespace from current line
  const leadingSpaces = currentLine.match(/^(\s*)/)[1];
  
  // Check if line ends with : (YAML key), add extra indent
  const trimmedLine = currentLine.trim();
  const extraIndent = trimmedLine.endsWith(':') ? '  ' : '';
  
  const beforeCursor = value.substring(0, selectionStart);
  const afterCursor = value.substring(selectionEnd);
  
  editor.value = beforeCursor + '\n' + leadingSpaces + extraIndent + afterCursor;
  editor.selectionStart = editor.selectionEnd = selectionStart + 1 + leadingSpaces.length + extraIndent.length;
  
  onConfigEditorInput();
  updateLineNumbers();
}

/**
 * Update line numbers display
 * Optimized with incremental updates for better performance on large files
 */
export function updateLineNumbers() {
  const editor = document.getElementById('configEditor');
  const lineNumbersEl = document.getElementById('configLineNumbers');
  if (!editor || !lineNumbersEl) return;

  const lines = editor.value.split('\n');
  const newLineCount = lines.length;
  const currentLineCount = lineNumbersEl.children.length;
  
  // Optimization: Only update if line count changed
  if (newLineCount === currentLineCount) {
    return;
  }
  
  // For large files (>1000 lines), use document fragment for better performance
  if (newLineCount > 1000 || Math.abs(newLineCount - currentLineCount) > 100) {
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= newLineCount; i++) {
      const div = document.createElement('div');
      div.className = 'line-number';
      div.textContent = i;
      fragment.appendChild(div);
    }
    lineNumbersEl.innerHTML = '';
    lineNumbersEl.appendChild(fragment);
    return;
  }
  
  // Incremental update: add or remove line numbers as needed
  if (newLineCount > currentLineCount) {
    // Add new line numbers
    for (let i = currentLineCount + 1; i <= newLineCount; i++) {
      const div = document.createElement('div');
      div.className = 'line-number';
      div.textContent = i;
      lineNumbersEl.appendChild(div);
    }
  } else {
    // Remove excess line numbers
    while (lineNumbersEl.children.length > newLineCount) {
      lineNumbersEl.removeChild(lineNumbersEl.lastChild);
    }
  }
}

/**
 * Sync scroll between editor and line numbers
 */
export function syncEditorScroll() {
  const editor = document.getElementById('configEditor');
  const lineNumbersEl = document.getElementById('configLineNumbers');
  const highlightLayer = document.getElementById('configHighlightLayer');
  const currentLineEl = document.getElementById('configCurrentLine');
  if (!editor) return;

  if (lineNumbersEl) lineNumbersEl.scrollTop = editor.scrollTop;
  if (highlightLayer) {
    highlightLayer.scrollTop = editor.scrollTop;
    highlightLayer.scrollLeft = editor.scrollLeft;
  }
  
  // Update current line position on scroll
  updateCurrentLineHighlight();
}

/**
 * Update cursor position display
 */
export function updateCursorPosition() {
  const editor = document.getElementById('configEditor');
  const cursorPosEl = document.getElementById('configCursorPos');
  if (!editor || !cursorPosEl) return;

  const { selectionStart, value } = editor;
  
  // Calculate line and column
  const textBeforeCursor = value.substring(0, selectionStart);
  const lines = textBeforeCursor.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;

  cursorPosEl.textContent = `Ln ${line}, Col ${column}`;
}

/**
 * Update all editor state (cursor, selection, current line)
 */
export function updateEditorState() {
  updateCursorPosition();
  updateSelectionInfo();
  updateCurrentLineHighlight();
}

/**
 * Update selection info display
 */
function updateSelectionInfo() {
  const editor = document.getElementById('configEditor');
  const selectionInfoEl = document.getElementById('configSelectionInfo');
  const selectionTextEl = document.getElementById('selectionText');
  if (!editor || !selectionInfoEl || !selectionTextEl) return;

  const { selectionStart, selectionEnd, value } = editor;
  
  if (selectionStart !== selectionEnd) {
    const selectedText = value.substring(selectionStart, selectionEnd);
    const selectedLines = selectedText.split('\n').length;
    const selectedChars = selectedText.length;
    
    selectionTextEl.textContent = selectedLines > 1 
      ? `${selectedLines} lines, ${selectedChars} chars`
      : `${selectedChars} chars`;
    selectionInfoEl.style.display = 'flex';
  } else {
    selectionInfoEl.style.display = 'none';
  }
}

/**
 * Update current line highlight
 */
function updateCurrentLineHighlight() {
  const editor = document.getElementById('configEditor');
  const currentLineEl = document.getElementById('configCurrentLine');
  if (!editor || !currentLineEl) return;

  const { selectionStart, value } = editor;
  const textBeforeCursor = value.substring(0, selectionStart);
  const currentLineIndex = textBeforeCursor.split('\n').length - 1;
  
  // Calculate line height (using computed style)
  const computedStyle = window.getComputedStyle(editor);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 20.8; // 13px * 1.6
  const paddingTop = parseFloat(computedStyle.paddingTop) || 16;
  
  const top = paddingTop + (currentLineIndex * lineHeight);
  
  currentLineEl.style.top = `${top - editor.scrollTop}px`;
  currentLineEl.style.height = `${lineHeight}px`;
  currentLineEl.style.display = 'block';
}

/**
 * Syntax highlighting for YAML
 */
export function updateSyntaxHighlight() {
  const editor = document.getElementById('configEditor');
  const highlightLayer = document.getElementById('configHighlightLayer');
  if (!editor || !highlightLayer) return;

  const content = editor.value;
  const highlighted = highlightYaml(content);
  highlightLayer.innerHTML = highlighted;
}

/**
 * Highlight YAML syntax with indentation depth tracking
 */
function highlightYaml(code) {
  // Escape HTML first
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply syntax highlighting with depth tracking
  const lines = html.split('\n');
  const SPACE_PER_INDENT = 2;
  
  const highlightedLines = lines.map((line, lineIndex) => {
    // Calculate indentation depth (0 = root level)
    const indentMatch = line.match(/^(\s*)/);
    const indentSpaces = indentMatch ? indentMatch[1].length : 0;
    const depth = Math.floor(indentSpaces / SPACE_PER_INDENT);
    const clampedDepth = Math.min(depth, 6); // Cap at 6 for CSS classes
    
    // Determine line type for special styling
    const trimmedLine = line.trim();
    const isComment = trimmedLine.startsWith('#');
    const isKeyValue = /^(\s*)([^:#\n]+?)(:)(.*)$/.test(line);
    const isListItem = /^(\s*)(-)(\s+.*)$/.test(line);
    const isEmpty = trimmedLine === '';
    
    // Check if this is a block start (key with no value or multiline indicator)
    const isBlockStart = isKeyValue && (
      /:\s*$/.test(trimmedLine) || // Ends with colon (no value)
      /:\s*[|>]/.test(trimmedLine) // Has multiline indicator | or >
    );
    
    // Build depth and block CSS classes
    let depthClass = `yaml-line-depth-${clampedDepth}`;
    let blockClass = '';
    let blockStartClass = isBlockStart ? 'yaml-block-start' : '';
    
    // Wrap in block line container with depth indicator
    let processedLine = '';
    
    // Comments
    if (isComment) {
      processedLine = `<span class="yaml-comment">${line}</span>`;
    }
    // Key-value pairs
    else if (isKeyValue) {
      const keyMatch = line.match(/^(\s*)([^:#\n]+?)(:)(.*)$/);
      const [, indent, key, colon, rest] = keyMatch;
      let highlightedRest = rest;
      
      // Check for values
      if (rest.trim()) {
        // String values
        if (rest.includes('"') || rest.includes("'")) {
          highlightedRest = rest.replace(/("[^"]*"|'[^']*')/g, '<span class="yaml-string">$1</span>');
        }
        // Boolean values
        else if (/^\s*(true|false|yes|no|on|off)\s*$/i.test(rest)) {
          highlightedRest = rest.replace(/(true|false|yes|no|on|off)/gi, '<span class="yaml-boolean">$1</span>');
        }
        // Null values
        else if (/^\s*(null|~)\s*$/i.test(rest)) {
          highlightedRest = rest.replace(/(null|~)/gi, '<span class="yaml-null">$1</span>');
        }
        // Number values
        else if (/^\s*-?\d+\.?\d*\s*$/.test(rest)) {
          highlightedRest = `<span class="yaml-number">${rest}</span>`;
        }
        // Inline comments
        else if (rest.includes(' #')) {
          const commentIdx = rest.indexOf(' #');
          const valuePart = rest.substring(0, commentIdx);
          const commentPart = rest.substring(commentIdx);
          highlightedRest = valuePart + `<span class="yaml-comment">${commentPart}</span>`;
        }
      }
      
      processedLine = `${indent}<span class="yaml-key">${key}</span><span class="yaml-colon">${colon}</span>${highlightedRest}`;
    }
    // List items
    else if (isListItem) {
      const listMatch = line.match(/^(\s*)(-)(\s+.*)$/);
      const [, indent, dash, rest] = listMatch;
      processedLine = `${indent}<span class="yaml-dash">${dash}</span>${rest}`;
      blockClass = 'yaml-list-item-block';
    }
    // Empty lines - preserve them with depth for visual continuity
    else if (isEmpty) {
      processedLine = line;
    }
    // Other lines (continuation, etc.)
    else {
      processedLine = line;
    }
    
    // Wrap in span container with depth classes (use inline-block for proper alignment)
    const allClasses = [depthClass, blockClass, blockStartClass].filter(Boolean).join(' ');
    return `<span class="yaml-line ${allClasses}">${processedLine}</span>`;
  });

  return highlightedLines.join('\n') + '\n'; // Preserve newlines for proper rendering
}

/**
 * Undo action - custom implementation without deprecated execCommand
 */
export function editorUndo() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;
  
  if (moduleState.undoStack.length === 0) {
    toast('Nothing to undo', 'info');
    return;
  }
  
  // Save current state to redo stack
  moduleState.redoStack.push({
    value: editor.value,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
  });
  
  // Restore previous state
  const prevState = moduleState.undoStack.pop();
  editor.value = prevState.value;
  editor.setSelectionRange(prevState.selectionStart, prevState.selectionEnd);
  editor.focus();
  
  onConfigEditorInput();
}

/**
 * Redo action - custom implementation without deprecated execCommand
 */
export function editorRedo() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;
  
  if (moduleState.redoStack.length === 0) {
    toast('Nothing to redo', 'info');
    return;
  }
  
  // Save current state to undo stack (without clearing redo)
  moduleState.undoStack.push({
    value: editor.value,
    selectionStart: editor.selectionStart,
    selectionEnd: editor.selectionEnd,
  });
  
  // Restore next state
  const nextState = moduleState.redoStack.pop();
  editor.value = nextState.value;
  editor.setSelectionRange(nextState.selectionStart, nextState.selectionEnd);
  editor.focus();
  
  onConfigEditorInput();
}

/**
 * Format YAML configuration
 * Normalizes indentation and fixes common formatting issues
 */
export function formatYamlConfig() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;

  const originalValue = editor.value;
  const lines = originalValue.split('\n');
  const formattedLines = [];
  
  let inMultilineString = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Skip empty lines but preserve them
    if (line.trim() === '') {
      formattedLines.push('');
      continue;
    }
    
    // Handle multiline strings (|, >)
    if (inMultilineString) {
      formattedLines.push(line);
      // Check if we're exiting multiline (next non-empty line with less indent)
      const nextNonEmpty = lines.slice(i + 1).find(l => l.trim() !== '');
      if (nextNonEmpty) {
        const currentIndent = line.match(/^(\s*)/)[1].length;
        const nextIndent = nextNonEmpty.match(/^(\s*)/)[1].length;
        if (nextIndent <= currentIndent && !nextNonEmpty.match(/^\s/)) {
          inMultilineString = false;
        }
      }
      continue;
    }
    
    // Detect start of multiline string
    if (line.match(/:\s*[|>]\s*$/)) {
      inMultilineString = true;
    }
    
    // Normalize tabs to 2 spaces
    line = line.replace(/\t/g, '  ');
    
    // Remove trailing whitespace
    line = line.trimEnd();
    
    // Ensure single space after colon for key-value pairs (but not for empty values)
    line = line.replace(/^(\s*)([^:#\n]+):(\s*)(?!$)(.+)$/, (match, indent, key, spaces, value) => {
      // Don't modify if it's a URL or contains special characters
      if (value.includes('://') || key.includes('://')) {
        return match;
      }
      return `${indent}${key}: ${value.trim()}`;
    });
    
    // Ensure proper list item spacing
    line = line.replace(/^(\s*)-(\s*)(?!$)(.+)$/, (match, indent, spaces, value) => {
      return `${indent}- ${value.trim()}`;
    });
    
    formattedLines.push(line);
  }
  
  const formattedValue = formattedLines.join('\n');
  
  // Only update if there are changes
  if (formattedValue !== originalValue) {
    const cursorPos = Math.min(editor.selectionStart, formattedValue.length);
    replaceEditorContent(editor, formattedValue, cursorPos, cursorPos);
    
    onConfigEditorInput();
    toast('YAML formatted', 'success');
  } else {
    toast('Already formatted', 'info');
  }
}

/**
 * Toggle word wrap
 */
let wordWrapEnabled = false;
export function editorToggleWordWrap() {
  const editor = document.getElementById('configEditor');
  const highlightLayer = document.getElementById('configHighlightLayer');
  const btn = document.getElementById('btnWordWrap');
  if (!editor) return;

  wordWrapEnabled = !wordWrapEnabled;
  
  if (wordWrapEnabled) {
    editor.style.whiteSpace = 'pre-wrap';
    editor.style.wordWrap = 'break-word';
    if (highlightLayer) {
      highlightLayer.style.whiteSpace = 'pre-wrap';
      highlightLayer.style.wordWrap = 'break-word';
    }
    if (btn) btn.classList.add('active');
  } else {
    editor.style.whiteSpace = 'pre';
    editor.style.wordWrap = 'normal';
    if (highlightLayer) {
      highlightLayer.style.whiteSpace = 'pre';
      highlightLayer.style.wordWrap = 'normal';
    }
    if (btn) btn.classList.remove('active');
  }
}

// ===================================
// Find & Replace
// ===================================

let findState = {
  matches: [],
  currentIndex: -1
};

/**
 * Open Find bar
 */
export function editorOpenFind() {
  const findBar = document.getElementById('editorFindBar');
  const replaceRow = document.getElementById('replaceRow');
  const findInput = document.getElementById('editorFindInput');
  if (!findBar || !findInput) return;

  findBar.style.display = 'block';
  if (replaceRow) replaceRow.style.display = 'none';
  findInput.focus();
  
  // If text is selected, use it as search term
  const editor = document.getElementById('configEditor');
  if (editor) {
    const selectedText = editor.value.substring(editor.selectionStart, editor.selectionEnd);
    if (selectedText && !selectedText.includes('\n')) {
      findInput.value = selectedText;
      editorFindNext(false);
    }
  }
}

/**
 * Open Replace bar
 */
export function editorOpenReplace() {
  const findBar = document.getElementById('editorFindBar');
  const replaceRow = document.getElementById('replaceRow');
  const findInput = document.getElementById('editorFindInput');
  if (!findBar || !findInput) return;

  findBar.style.display = 'block';
  if (replaceRow) replaceRow.style.display = 'flex';
  findInput.focus();
}

/**
 * Close Find bar
 */
export function editorCloseFind() {
  const findBar = document.getElementById('editorFindBar');
  const editor = document.getElementById('configEditor');
  if (findBar) findBar.style.display = 'none';
  if (editor) editor.focus();
  findState = { matches: [], currentIndex: -1 };
  updateFindMatchCount();
}

/**
 * Find next match
 */
export function editorFindNext(moveToNext = true) {
  const findInput = document.getElementById('editorFindInput');
  const editor = document.getElementById('configEditor');
  const caseSensitive = document.getElementById('findCaseSensitive')?.checked || false;
  if (!findInput || !editor) return;

  const searchTerm = findInput.value;
  if (!searchTerm) {
    findState = { matches: [], currentIndex: -1 };
    updateFindMatchCount();
    return;
  }

  const content = editor.value;
  const searchContent = caseSensitive ? content : content.toLowerCase();
  const searchQuery = caseSensitive ? searchTerm : searchTerm.toLowerCase();

  // Find all matches
  findState.matches = [];
  let pos = 0;
  while ((pos = searchContent.indexOf(searchQuery, pos)) !== -1) {
    findState.matches.push({ start: pos, end: pos + searchTerm.length });
    pos += 1;
  }

  if (findState.matches.length === 0) {
    findState.currentIndex = -1;
    updateFindMatchCount();
    return;
  }

  // Move to next match
  if (moveToNext) {
    findState.currentIndex = (findState.currentIndex + 1) % findState.matches.length;
  } else {
    // Find match closest to current cursor
    const cursor = editor.selectionStart;
    findState.currentIndex = 0;
    for (let i = 0; i < findState.matches.length; i++) {
      if (findState.matches[i].start >= cursor) {
        findState.currentIndex = i;
        break;
      }
    }
  }

  // Select the match
  const match = findState.matches[findState.currentIndex];
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  scrollToSelection(editor);
  
  updateFindMatchCount();
}

/**
 * Find previous match
 */
export function editorFindPrev() {
  if (findState.matches.length === 0) return;

  const editor = document.getElementById('configEditor');
  if (!editor) return;

  findState.currentIndex = (findState.currentIndex - 1 + findState.matches.length) % findState.matches.length;
  
  const match = findState.matches[findState.currentIndex];
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  scrollToSelection(editor);
  
  updateFindMatchCount();
}

/**
 * Replace current match
 */
export function editorReplace() {
  const editor = document.getElementById('configEditor');
  const replaceInput = document.getElementById('editorReplaceInput');
  if (!editor || !replaceInput || findState.matches.length === 0) return;

  const match = findState.matches[findState.currentIndex];
  if (!match) return;

  pushToUndoStack(editor);

  const replaceText = replaceInput.value;
  const before = editor.value.substring(0, match.start);
  const after = editor.value.substring(match.end);
  
  editor.value = before + replaceText + after;
  editor.setSelectionRange(match.start, match.start + replaceText.length);
  
  onConfigEditorInput();
  editorFindNext(false);
}

/**
 * Replace all matches
 * Includes security validation for search terms
 */
export function editorReplaceAll() {
  const findInput = document.getElementById('editorFindInput');
  const replaceInput = document.getElementById('editorReplaceInput');
  const editor = document.getElementById('configEditor');
  const caseSensitive = document.getElementById('findCaseSensitive')?.checked || false;
  if (!findInput || !replaceInput || !editor) return;

  const searchTerm = findInput.value;
  const replaceText = replaceInput.value;
  
  // Validate search term
  if (!isSearchTermSafe(searchTerm)) return;

  // Save to undo stack before replacing
  pushToUndoStack(editor);

  let content = editor.value;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(searchTerm), flags);
  
  const newContent = content.replace(regex, replaceText);
  const replacementCount = (content.match(regex) || []).length;
  
  editor.value = newContent;
  onConfigEditorInput();
  
  findState = { matches: [], currentIndex: -1 };
  updateFindMatchCount();
  
  toast(`Replaced ${replacementCount} occurrence(s)`, 'success');
}

/**
 * Update find match count display
 */
function updateFindMatchCount() {
  const countEl = document.getElementById('findMatchCount');
  if (!countEl) return;

  if (findState.matches.length === 0) {
    countEl.textContent = '';
    countEl.className = 'find-match-count';
  } else {
    countEl.textContent = `${findState.currentIndex + 1} of ${findState.matches.length}`;
    countEl.className = 'find-match-count has-matches';
  }
}

/**
 * Scroll editor to show selection
 */
function scrollToSelection(editor) {
  const { selectionStart, value } = editor;
  const textBeforeCursor = value.substring(0, selectionStart);
  const lineNumber = textBeforeCursor.split('\n').length;
  
  const computedStyle = window.getComputedStyle(editor);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 20.8;
  const paddingTop = parseFloat(computedStyle.paddingTop) || 16;
  
  const targetScroll = (lineNumber - 3) * lineHeight;
  editor.scrollTop = Math.max(0, targetScroll);
}

/**
 * Handle keyboard events in find input
 */
export function handleFindKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      editorFindPrev();
    } else {
      editorFindNext(true);
    }
  } else if (event.key === 'Escape') {
    editorCloseFind();
  }
}

/**
 * Handle keyboard events in replace input
 */
export function handleReplaceKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    editorReplace();
  } else if (event.key === 'Escape') {
    editorCloseFind();
  }
}

// ===================================
// Go to Line
// ===================================

/**
 * Open Go to Line modal
 */
export function editorGoToLine() {
  const modal = document.getElementById('editorGotoModal');
  const input = document.getElementById('gotoLineInput');
  const editor = document.getElementById('configEditor');
  if (!modal || !input) return;

  // Set max to current line count
  if (editor) {
    const lineCount = editor.value.split('\n').length;
    input.max = lineCount;
    input.placeholder = `1 - ${lineCount}`;
  }

  modal.style.display = 'flex';
  input.value = '';
  input.focus();
}

/**
 * Close Go to Line modal
 */
export function editorCloseGoto() {
  const modal = document.getElementById('editorGotoModal');
  const editor = document.getElementById('configEditor');
  if (modal) modal.style.display = 'none';
  if (editor) editor.focus();
}

/**
 * Execute go to line
 */
export function editorGotoLineExecute() {
  const input = document.getElementById('gotoLineInput');
  const editor = document.getElementById('configEditor');
  if (!input || !editor) return;

  const targetLine = parseInt(input.value, 10);
  if (isNaN(targetLine) || targetLine < 1) {
    editorCloseGoto();
    return;
  }

  const lines = editor.value.split('\n');
  const lineCount = lines.length;
  const line = Math.min(targetLine, lineCount);

  // Calculate position of line start
  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos += lines[i].length + 1;
  }

  editor.focus();
  editor.setSelectionRange(pos, pos);
  scrollToSelection(editor);
  
  editorCloseGoto();
  updateEditorState();
}

/**
 * Handle keyboard events in goto input
 */
export function handleGotoKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    editorGotoLineExecute();
  } else if (event.key === 'Escape') {
    editorCloseGoto();
  }
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Safely execute regex with timeout protection against ReDoS
 * @param {RegExp} regex - The regex to execute
 * @param {string} content - The content to search
 * @param {number} maxTime - Maximum execution time in ms
 * @returns {Array|null} - Match results or null if timed out
 */
function safeRegexExec(regex, content, maxTime = CONSTANTS.REGEX_TIMEOUT) {
  // For very long content, use a simpler approach
  if (content.length > 100000) {
    console.warn('Content too large for regex search, using simple string search');
    return null;
  }
  
  const startTime = Date.now();
  const results = [];
  let match;
  
  // Reset regex state
  regex.lastIndex = 0;
  
  while ((match = regex.exec(content)) !== null) {
    results.push(match);
    
    // Check timeout
    if (Date.now() - startTime > maxTime) {
      console.warn('Regex execution timed out');
      toast('Search operation timed out', 'warning');
      return results; // Return partial results
    }
    
    // Prevent infinite loops for zero-length matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }
  
  return results;
}

/**
 * Validate search term to prevent ReDoS attacks
 * @param {string} searchTerm - The search term to validate
 * @returns {boolean} - Whether the search term is safe
 */
function isSearchTermSafe(searchTerm) {
  if (!searchTerm) return false;
  
  // Limit length
  if (searchTerm.length > CONSTANTS.MAX_REGEX_LENGTH) {
    toast('Search term is too long', 'warning');
    return false;
  }
  
  // Check for potentially dangerous patterns (nested quantifiers, etc.)
  // These patterns can cause catastrophic backtracking
  const dangerousPatterns = [
    /(\+|\*|\?)\1/, // Repeated quantifiers
    /\(\?[^)]*\([^)]*\)/, // Nested groups with quantifiers
  ];

  if (dangerousPatterns.some(pattern => pattern.test(searchTerm))) {
    toast('Search term looks unsafe. Please simplify it.', 'warning');
    return false;
  }

  return true;
}

/**
 * Direct keydown handler for config editor textarea
 * This ensures shortcuts work reliably when the editor is focused
 */
export function handleConfigEditorKeydown(e) {
  // Ctrl+S: Save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveConfigEnhanced();
    return;
  }

  // Ctrl+/: Toggle comment (use e.code for reliability across keyboard layouts)
  if ((e.ctrlKey || e.metaKey) && (e.code === 'Slash' || e.key === '/' || e.key === '?')) {
    e.preventDefault();
    e.stopPropagation();
    editorToggleComment();
    return;
  }

  // Ctrl+D: Duplicate line
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    editorDuplicateLine();
    return;
  }

  // Ctrl+Shift+K: Delete line
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
    e.preventDefault();
    editorDeleteLine();
    return;
  }

  // Ctrl+Shift+F: Format YAML
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
    e.preventDefault();
    formatYamlConfig();
    return;
  }

  // Tab: Insert spaces (2 spaces for YAML)
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (e.shiftKey) {
      editorOutdent();
    } else {
      editorIndent();
    }
    return;
  }

  // Enter: Auto-indent
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    editorAutoIndentNewline();
    return;
  }

  // Ctrl+F: Find
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    editorOpenFind();
    return;
  }

  // Ctrl+H: Replace
  if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault();
    editorOpenReplace();
    return;
  }

  // Ctrl+G: Go to line
  if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
    e.preventDefault();
    editorGoToLine();
    return;
  }

  // Ctrl+Z: Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    // Let browser handle undo, but update state after
    setTimeout(() => {
      onConfigEditorInput();
      updateLineNumbers();
    }, 0);
    return;
  }

  // Ctrl+Y or Ctrl+Shift+Z: Redo
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    // Let browser handle redo, but update state after
    setTimeout(() => {
      onConfigEditorInput();
      updateLineNumbers();
    }, 0);
    return;
  }

  // Escape: Close find/goto modals
  if (e.key === 'Escape') {
    const findBar = document.getElementById('editorFindBar');
    const gotoModal = document.getElementById('editorGotoModal');
    if (findBar && findBar.style.display !== 'none') {
      editorCloseFind();
      e.preventDefault();
    } else if (gotoModal && gotoModal.style.display !== 'none') {
      editorCloseGoto();
      e.preventDefault();
    }
    return;
  }
}

// Export module interface for global access
export const configModule = {
  loadConfig,
  saveConfigEnhanced,
  reloadConfig,
  toggleSettingEnhanced,
  loadCostLimitsState,
  toggleCostLimitsEnabled,
  toggleCountOnlySuccessRequests,
  onConfigEditorInput,
  setupConfigKeyboardShortcuts,
  handleConfigEditorKeydown,
  editorToggleComment,
  editorIndent,
  editorOutdent,
  editorDuplicateLine,
  editorDeleteLine,
  updateLineNumbers,
  syncEditorScroll,
  updateCursorPosition,
  updateEditorState,
  updateSyntaxHighlight,
  editorUndo,
  editorRedo,
  editorToggleWordWrap,
  formatYamlConfig,
  editorOpenFind,
  editorOpenReplace,
  editorCloseFind,
  editorFindNext,
  editorFindPrev,
  editorReplace,
  editorReplaceAll,
  handleFindKeydown,
  handleReplaceKeydown,
  editorGoToLine,
  editorCloseGoto,
  editorGotoLineExecute,
  handleGotoKeydown
};

// Expose functions to window for HTML onclick handlers
window.configModule = configModule;
window.loadConfig = loadConfig;
window.saveConfigEnhanced = saveConfigEnhanced;
window.reloadConfig = reloadConfig;
window.toggleSettingEnhanced = toggleSettingEnhanced;
window.loadCostLimitsState = loadCostLimitsState;
window.toggleCostLimitsEnabled = toggleCostLimitsEnabled;
window.toggleCountOnlySuccessRequests = toggleCountOnlySuccessRequests;
window.onConfigEditorInput = onConfigEditorInput;
window.handleConfigEditorKeydown = handleConfigEditorKeydown;
window.editorToggleComment = editorToggleComment;
window.editorIndent = editorIndent;
window.editorOutdent = editorOutdent;
window.editorDuplicateLine = editorDuplicateLine;
window.editorDeleteLine = editorDeleteLine;
window.updateLineNumbers = updateLineNumbers;
window.syncEditorScroll = syncEditorScroll;
window.updateCursorPosition = updateCursorPosition;
window.updateEditorState = updateEditorState;
window.updateSyntaxHighlight = updateSyntaxHighlight;
window.editorUndo = editorUndo;
window.editorRedo = editorRedo;
window.editorToggleWordWrap = editorToggleWordWrap;
window.formatYamlConfig = formatYamlConfig;
window.editorOpenFind = editorOpenFind;
window.editorOpenReplace = editorOpenReplace;
window.editorCloseFind = editorCloseFind;
window.editorFindNext = editorFindNext;
window.editorFindPrev = editorFindPrev;
window.editorReplace = editorReplace;
window.editorReplaceAll = editorReplaceAll;
window.handleFindKeydown = handleFindKeydown;
window.handleReplaceKeydown = handleReplaceKeydown;
window.editorGoToLine = editorGoToLine;
window.editorCloseGoto = editorCloseGoto;
window.editorGotoLineExecute = editorGotoLineExecute;
window.handleGotoKeydown = handleGotoKeydown;
window.setupUnsavedChangesWarning = setupUnsavedChangesWarning;
window.removeUnsavedChangesWarning = removeUnsavedChangesWarning;
window.checkForDraft = checkForDraft;
