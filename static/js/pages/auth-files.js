/**
 * Auth Files Page Module
 * Handles OAuth authentication, manual callback submission, and auth file management
 */

import { api, getApiKey } from '../core/api.js';
import { toast } from '../core/toast.js';
import { closeModal } from '../core/modal.js';

let uploadHandlersBound = false;

/**
 * Load the auth files page
 */
export async function loadAuthFiles() {
  setupAuthFileUploadHandlers();
  const refreshBtn = document.getElementById('authFilesRefreshBtn');
  if (refreshBtn) {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
  }

  try {
    const [d, usageRes] = await Promise.all([
      api('GET', '/auth-files'),
      api('GET', '/usage').catch(() => ({ usage: {} }))
    ]);

    const usageApis = (usageRes.usage && usageRes.usage.apis) || {};
    const tbody = document.getElementById('authFilesTable');

    if (!d.files?.length) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="auth-table-empty">
          <div class="auth-table-empty-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <h4>No auth files yet</h4>
          <p>Connect via OAuth or upload an auth file to get started</p>
        </div>
      </td></tr>`;
      return;
    }

    const statsByAuthIndex = {};
    Object.values(usageApis).forEach(apiStats => {
      if (apiStats.models) {
        Object.values(apiStats.models).forEach(modelStats => {
          if (modelStats.details) {
            modelStats.details.forEach(detail => {
              const idx = detail.auth_index;
              if (idx !== undefined && idx !== null) {
                if (!statsByAuthIndex[idx]) {
                  statsByAuthIndex[idx] = { requests: 0, failed: 0 };
                }
                statsByAuthIndex[idx].requests++;
                if (detail.failed) {
                  statsByAuthIndex[idx].failed++;
                }
              }
            });
          }
        });
      }
    });

    const providerEmojis = {
      'anthropic': '🤖', 'claude': '🤖',
      'gemini': '✨', 'gemini-cli': '✨',
      'codex': '🧠', 'openai': '🧠',
      'antigravity': '🚀',
      'iflow': '🌊',
      'codebuddy': '🐼'
    };

    tbody.innerHTML = d.files.map(f => {
      const provider = f.provider || f.type || 'unknown';
      const email = f.email || '-';
      const filename = f.name || '-';
      const project = f.project || f.project_id || '-';
      const region = f.region || '-';
      const emoji = providerEmojis[provider.toLowerCase()] || '🔑';

      let stats = usageApis[f.id] || usageApis[f.name] || usageApis[f.email] || usageApis[f.account] || usageApis[project] || {};
      let requests = stats.total_requests || 0;
      let failed = 0;

      if (stats.models) {
        Object.values(stats.models).forEach(m => {
          if (m.details) {
            m.details.forEach(d => {
              if (d.failed) failed++;
            });
          }
        });
      }

      const authIndex = f.auth_index;
      if (authIndex !== undefined && authIndex !== null && statsByAuthIndex[authIndex]) {
        requests = statsByAuthIndex[authIndex].requests;
        failed = statsByAuthIndex[authIndex].failed;
      }

      const projectRegion = project !== '-' ? `${project}${region !== '-' ? ' / ' + region : ''}` : (region !== '-' ? region : '-');

      let lastRefresh = '-';
      const lr = f.last_refresh || f.lastRefresh || f.last_refreshed_at || f.lastRefreshedAt;
      if (lr) {
        const date = new Date(lr);
        if (!isNaN(date)) {
          lastRefresh = date.toLocaleString();
        } else {
          lastRefresh = lr;
        }
      }

      const statusClass = f.expired ? 'expired' : 'active';
      const statusText = f.expired ? 'Expired' : 'Active';

      return `<tr>
        <td>
          <div class="auth-provider-cell">
            <div class="auth-provider-badge">${emoji}</div>
            <span style="font-weight:500;text-transform:capitalize">${provider}</span>
          </div>
        </td>
        <td>
          <div class="auth-identity-cell">
            <div class="auth-identity-email" title="${email}">${email}</div>
            <div class="auth-identity-filename" title="${filename}">${filename}</div>
          </div>
        </td>
        <td style="font-size:13px;color:var(--text-secondary)">${projectRegion}</td>
        <td style="font-size:12px;color:var(--text-muted)">${lastRefresh}</td>
        <td>
          <div class="auth-metrics">
            <span class="auth-metric requests" title="Total Requests">${requests.toLocaleString()}</span>
            ${failed > 0 ? `<span class="auth-metric failed" title="Failed Requests">${failed.toLocaleString()}</span>` : ''}
          </div>
        </td>
        <td>
          <span class="auth-status-badge ${statusClass}">
            <span class="auth-status-dot"></span>
            ${statusText}
          </span>
        </td>
        <td>
          <div class="auth-actions">
            <button class="auth-action-btn" onclick="viewAuthFile('${f.name}')" title="View contents">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <button class="auth-action-btn" onclick="renameAuth('${f.name}')" title="Rename (for load balancing order)">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
            <button class="auth-action-btn" onclick="downloadAuth('${f.name}')" title="Download">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button class="auth-action-btn danger" onclick="deleteAuth('${f.name}')" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
    }
  }
}

/**
 * View an auth file's contents in a modal (with edit capability)
 * @param {string} name - Auth file name
 */
export async function viewAuthFile(name) {
  try {
    const apiKey = getApiKey();
    const res = await fetch(`/v0/management/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await res.json();
    const jsonStr = JSON.stringify(data, null, 2);

    document.getElementById('modalTitle').textContent = `Auth File: ${name}`;
    document.getElementById('modalContent').innerHTML = `
      <div id="authFileViewMode">
        <pre style="background:rgba(0,0,0,0.4);padding:16px;border-radius:8px;overflow-x:auto;font-size:12px;max-height:400px;overflow-y:auto">${jsonStr}</pre>
      </div>
      <div id="authFileEditMode" style="display:none">
        <textarea id="authFileEditTextarea" style="width:100%;min-height:400px;background:rgba(0,0,0,0.4);color:var(--text-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;font-family:monospace;font-size:12px;resize:vertical">${jsonStr}</textarea>
        <div id="authFileEditError" style="color:var(--accent-red);font-size:12px;margin-top:8px;display:none"></div>
      </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
      <button class="btn btn-secondary" id="authFileEditBtn" onclick="toggleAuthFileEditMode('${name}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
        Edit
      </button>
      <button class="btn btn-primary" id="authFileSaveBtn" onclick="saveAuthFile('${name}')" style="display:none">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        Save
      </button>
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    `;
    document.getElementById('modal').classList.add('active');
  } catch (e) {
    toast('Failed to view: ' + e.message, 'error');
  }
}

/**
 * Toggle between view and edit mode for auth file
 * @param {string} name - Auth file name
 */
export function toggleAuthFileEditMode(name) {
  const viewMode = document.getElementById('authFileViewMode');
  const editMode = document.getElementById('authFileEditMode');
  const editBtn = document.getElementById('authFileEditBtn');
  const saveBtn = document.getElementById('authFileSaveBtn');
  
  if (editMode.style.display === 'none') {
    viewMode.style.display = 'none';
    editMode.style.display = 'block';
    editBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      View
    `;
    saveBtn.style.display = 'inline-flex';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
    editBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
      </svg>
      Edit
    `;
    saveBtn.style.display = 'none';
    document.getElementById('authFileEditError').style.display = 'none';
  }
}

/**
 * Save edited auth file content
 * @param {string} name - Auth file name
 */
export async function saveAuthFile(name) {
  const textarea = document.getElementById('authFileEditTextarea');
  const errorDiv = document.getElementById('authFileEditError');
  const saveBtn = document.getElementById('authFileSaveBtn');
  
  const content = textarea.value.trim();
  
  // Validate JSON
  try {
    JSON.parse(content);
  } catch (e) {
    errorDiv.textContent = `Invalid JSON: ${e.message}`;
    errorDiv.style.display = 'block';
    return;
  }
  
  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
      <path d="M21 12a9 9 0 11-6.219-8.56"/>
    </svg>
    Saving...
  `;
  
  try {
    const apiKey = getApiKey();
    const res = await fetch(`/v0/management/auth-files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: content
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    
    toast('Auth file saved successfully', 'success');
    closeModal();
    loadAuthFiles();
  } catch (e) {
    errorDiv.textContent = `Failed to save: ${e.message}`;
    errorDiv.style.display = 'block';
    toast('Failed to save: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save
    `;
  }
}

/**
 * Download an auth file
 * @param {string} name - Auth file name
 */
export async function downloadAuth(name) {
  try {
    const apiKey = getApiKey();
    const res = await fetch(`/v0/management/auth-files/download?name=${encodeURIComponent(name)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Download failed');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (e) {
    toast('Failed to download: ' + e.message, 'error');
  }
}

/**
 * Delete an auth file
 * @param {string} name - Auth file name
 */
export async function deleteAuth(name) {
  if (!confirm(`Delete ${name}?`)) return;

  try {
    await api('DELETE', `/auth-files?name=${encodeURIComponent(name)}`);
    toast('Deleted', 'success');
    loadAuthFiles();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Rename an auth file
 * This allows controlling the order of auth files for load balancing (fill first mode)
 * @param {string} oldName - Current auth file name
 */
export async function renameAuth(oldName) {
  const newName = prompt(`Enter new name for "${oldName}":\n\n(Tip: Use prefixes like 01_, 02_ to control load balancing order)`, oldName);
  
  if (!newName || newName === oldName) return;
  
  try {
    await api('PUT', `/auth-files/rename?old_name=${encodeURIComponent(oldName)}&new_name=${encodeURIComponent(newName)}`);
    toast('Renamed successfully', 'success');
    loadAuthFiles();
  } catch (e) {
    toast('Failed to rename: ' + e.message, 'error');
  }
}

/**
 * Delete all auth files
 */
export async function deleteAllAuthFiles() {
  if (!confirm('Delete ALL auth files? This cannot be undone!')) return;

  try {
    const d = await api('GET', '/auth-files');

    for (const f of (d.files || [])) {
      await api('DELETE', `/auth-files?name=${encodeURIComponent(f.name)}`);
    }

    toast('All auth files deleted', 'success');
    loadAuthFiles();
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

/**
 * Handle file drop for auth file upload
 * @param {DragEvent} e - Drop event
 */
export function handleFileDrop(e) {
  e.preventDefault();
  const dropzone = e.currentTarget || document.getElementById('uploadDropzone');
  if (dropzone) {
    dropzone.classList.remove('dragover');
  }
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFileSelect(file);
}

/**
 * Handle file selection for auth file upload
 * @param {File} file - Selected file
 */
export async function handleFileSelect(file) {
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.json')) {
    toast('Please upload a JSON file', 'error');
    return;
  }

  const status = document.getElementById('uploadStatus');
  status.className = 'auth-upload-status show uploading';
  status.innerHTML = `
    <div class="auth-upload-spinner"></div>
    <span>Uploading ${file.name}...</span>
  `;

  try {
    await uploadAuthFile(file);

    status.className = 'auth-upload-status show success';
    status.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <span>${file.name} uploaded successfully!</span>
    `;
    toast('Auth file uploaded', 'success');
    loadAuthFiles();
    setTimeout(() => {
      status.className = 'auth-upload-status';
      status.innerHTML = '';
    }, 4000);
  } catch (e) {
    status.className = 'auth-upload-status show error';
    status.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <span>Failed: ${e.message}</span>
    `;
    toast('Upload failed: ' + e.message, 'error');
  } finally {
    const input = document.getElementById('authFileInput');
    if (input) input.value = '';
  }
}

/**
 * Wire up auth file upload dropzone and input handlers
 */
export function setupAuthFileUploadHandlers() {
  if (uploadHandlersBound) return;

  const dropzone = document.getElementById('uploadDropzone');
  const input = document.getElementById('authFileInput');
  if (!dropzone || !input) return;

  const openFilePicker = () => {
    input.value = '';
    input.click();
  };

  dropzone.addEventListener('click', openFilePicker);
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', e => {
    dropzone.classList.remove('dragover');
    handleFileDrop(e);
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) handleFileSelect(file);
  });

  uploadHandlersBound = true;
}

/**
 * Upload an auth file to the server
 * @param {File} file - File to upload
 * @returns {Promise<object>} Upload response
 */
export async function uploadAuthFile(file) {
  const apiKey = getApiKey();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/v0/management/auth-files', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Start OAuth flow for a provider
 * @param {string} provider - Provider name (anthropic, gemini-cli, codex, etc.)
 */
export async function startOAuth(provider) {
  const endpoints = {
    'anthropic': '/anthropic-auth-url',
    'gemini-cli': '/gemini-cli-auth-url',
    'codex': '/codex-auth-url',
    'antigravity': '/antigravity-auth-url',
    'iflow': '/iflow-auth-url',
    'github': '/github-auth-url',
    'kiro': '/kiro-auth-url',
    'codebuddy': '/codebuddy-auth-url',
    'codebuddy-global': '/codebuddy-auth-url?server=global'
  };
  const ep = endpoints[provider];

  // Device flow providers don't use redirect callbacks
  const deviceFlowProviders = ['github', 'kiro', 'codebuddy', 'codebuddy-global'];
  if (!deviceFlowProviders.includes(provider)) {
    showManualCallback();
  }

  try {
    toast(`Starting ${provider} OAuth...`, 'info');
    const d = await api('GET', ep);

    if (d.url || d.auth_url) {
      window.open(d.url || d.auth_url, '_blank');
      if (d.user_code) {
        toast(`Enter code: ${d.user_code}`, 'info', 30000);
      } else {
        toast('Complete login in new window', 'info');
      }
    } else if (d.message) {
      toast(d.message, 'info');
    }
  } catch (e) {
    toast('OAuth failed: ' + e.message, 'error');
  }
}

/**
 * Show the manual callback input section
 */
export function showManualCallback() {
  const section = document.getElementById('manualCallbackSection');
  if (section) {
    section.classList.add('visible');
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Hide the manual callback input section
 */
export function hideManualCallback() {
  const section = document.getElementById('manualCallbackSection');
  if (section) {
    section.classList.remove('visible');
    const input = document.getElementById('callbackUrlInput');
    if (input) input.value = '';
  }
}

/**
 * Submit a manual OAuth callback URL
 */
export async function submitManualCallback() {
  const urlInput = document.getElementById('callbackUrlInput');
  const callbackUrl = urlInput.value.trim();

  if (!callbackUrl) {
    toast('Please enter a callback URL', 'error');
    return;
  }

  try {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error') || url.searchParams.get('error_description');

    if (!code && !error) {
      toast('Invalid callback URL: missing code parameter', 'error');
      return;
    }

    // Detect provider from callback URL path or port
    const pathLower = url.pathname.toLowerCase();
    const port = url.port;
    let provider = '';

    // First try to detect by path
    if (pathLower.includes('anthropic')) provider = 'anthropic';
    else if (pathLower.includes('codex')) provider = 'codex';
    else if (pathLower.includes('google') || pathLower.includes('gemini')) provider = 'gemini';
    else if (pathLower.includes('iflow')) provider = 'iflow';
    else if (pathLower.includes('antigravity')) provider = 'antigravity';

    // If not detected by path, try by port number
    if (!provider && port) {
      const portProviderMap = {
        '54545': 'anthropic',
        '8085': 'gemini',
        '1455': 'codex',
        '51121': 'antigravity',
        '11451': 'iflow'
      };
      provider = portProviderMap[port] || '';
    }

    if (!provider) {
      toast('Could not detect provider from URL. Supported ports: 54545 (Anthropic), 8085 (Gemini), 1455 (Codex), 51121 (Antigravity), 11451 (IFlow)', 'error');
      return;
    }

    // Submit to the server's callback endpoint
    const callbackPath = `/${provider}/callback`;
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    if (error) params.set('error', error);

    const response = await fetch(`${callbackPath}?${params.toString()}`);

    if (response.ok) {
      toast(`OAuth callback submitted for ${provider}. Check if authentication completed.`, 'success');
      urlInput.value = '';
      // Refresh auth files after a short delay
      setTimeout(() => loadAuthFiles(), 1500);
    } else {
      toast(`Failed to submit callback: ${response.statusText}`, 'error');
    }
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('URL')) {
      toast('Invalid URL format. Please paste the complete callback URL.', 'error');
    } else {
      toast('Failed to submit callback: ' + e.message, 'error');
    }
  }
}

/**
 * Refresh an auth token (if supported by provider)
 * @param {string} name - Auth file name
 */
export async function refreshAuthToken(name) {
  try {
    await api('POST', `/auth-files/refresh?name=${encodeURIComponent(name)}`);
    toast('Token refreshed', 'success');
    loadAuthFiles();
  } catch (e) {
    toast('Failed to refresh: ' + e.message, 'error');
  }
}

// Expose functions to window for HTML onclick handlers
window.loadAuthFiles = loadAuthFiles;
window.viewAuthFile = viewAuthFile;
window.toggleAuthFileEditMode = toggleAuthFileEditMode;
window.saveAuthFile = saveAuthFile;
window.downloadAuth = downloadAuth;
window.deleteAuth = deleteAuth;
window.renameAuth = renameAuth;
window.deleteAllAuthFiles = deleteAllAuthFiles;
window.startOAuth = startOAuth;
window.showManualCallback = showManualCallback;
window.hideManualCallback = hideManualCallback;
window.submitManualCallback = submitManualCallback;
window.refreshAuthToken = refreshAuthToken;
window.handleFileSelect = handleFileSelect;
window.handleFileDrop = handleFileDrop;
