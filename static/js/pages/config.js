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
    updateSyntaxHighlight();
    hideUnsavedIndicator();
    hideYamlError();
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

  const configState = getConfigState();
  updateConfigEditorInfo();

  // Update syntax highlighting (debounced for performance)
  clearTimeout(window._syntaxHighlightTimeout);
  window._syntaxHighlightTimeout = setTimeout(() => {
    updateSyntaxHighlight();
  }, 50);

  // Update current line highlight
  updateCurrentLineHighlight();

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

  editor.value = lines.join('\n');
  editor.setSelectionRange(newSelStart, newSelEnd);

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
 */
export function updateLineNumbers() {
  const editor = document.getElementById('configEditor');
  const lineNumbersEl = document.getElementById('configLineNumbers');
  if (!editor || !lineNumbersEl) return;

  const lines = editor.value.split('\n');
  const lineCount = lines.length;
  
  let html = '';
  for (let i = 1; i <= lineCount; i++) {
    html += `<div class="line-number">${i}</div>`;
  }
  
  lineNumbersEl.innerHTML = html;
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
 * Highlight YAML syntax
 */
function highlightYaml(code) {
  // Escape HTML first
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply syntax highlighting
  const lines = html.split('\n');
  const highlightedLines = lines.map(line => {
    // Comments
    if (line.trim().startsWith('#')) {
      return `<span class="yaml-comment">${line}</span>`;
    }
    
    // Key-value pairs
    const keyMatch = line.match(/^(\s*)([^:#\n]+?)(:)(.*)$/);
    if (keyMatch) {
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
      
      return `${indent}<span class="yaml-key">${key}</span><span class="yaml-colon">${colon}</span>${highlightedRest}`;
    }
    
    // List items
    const listMatch = line.match(/^(\s*)(-)(\s+.*)$/);
    if (listMatch) {
      const [, indent, dash, rest] = listMatch;
      return `${indent}<span class="yaml-dash">${dash}</span>${rest}`;
    }
    
    return line;
  });

  return highlightedLines.join('\n') + '\n'; // Extra newline for scrolling
}

/**
 * Undo action
 */
export function editorUndo() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;
  editor.focus();
  document.execCommand('undo');
  onConfigEditorInput();
}

/**
 * Redo action
 */
export function editorRedo() {
  const editor = document.getElementById('configEditor');
  if (!editor) return;
  editor.focus();
  document.execCommand('redo');
  onConfigEditorInput();
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
 */
export function editorReplaceAll() {
  const findInput = document.getElementById('editorFindInput');
  const replaceInput = document.getElementById('editorReplaceInput');
  const editor = document.getElementById('configEditor');
  const caseSensitive = document.getElementById('findCaseSensitive')?.checked || false;
  if (!findInput || !replaceInput || !editor) return;

  const searchTerm = findInput.value;
  const replaceText = replaceInput.value;
  if (!searchTerm) return;

  let content = editor.value;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(searchTerm), flags);
  
  const newContent = content.replace(regex, replaceText);
  const replacementCount = (content.match(regex) || []).length;
  
  editor.value = newContent;
  onConfigEditorInput();
  
  findState = { matches: [], currentIndex: -1 };
  updateFindMatchCount();
  
  // Show toast with count
  if (window.toast) {
    window.toast(`Replaced ${replacementCount} occurrence(s)`, 'success');
  }
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
