/**
 * Authentication Module
 * Handles login, logout, and session management
 */

import { api, getApiKey, setApiKey } from './api.js';
import { toast } from './toast.js';

/**
 * Check if user is authenticated and restore session
 * @param {Function} onSuccess - Callback when auth succeeds (e.g., loadDashboard)
 */
export async function checkAuth(onSuccess) {
  const apiKey = getApiKey();
  
  if (apiKey) {
    try {
      await api('GET', '/config');
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('app').classList.add('active');
      if (onSuccess) onSuccess();
    } catch {
      localStorage.removeItem('managementKey');
      setApiKey('');
    }
  }
}

/**
 * Perform login with the provided key
 * @param {Function} onSuccess - Callback when login succeeds (e.g., loadDashboard)
 */
export async function login(onSuccess) {
  const keyInput = document.getElementById('loginKey');
  const key = keyInput.value;
  
  if (!key) return;
  
  setApiKey(key);

  try {
    await api('GET', '/config');
    localStorage.setItem('managementKey', key);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').classList.add('active');
    if (onSuccess) onSuccess();
    toast('Successfully authenticated', 'success');
  } catch (e) {
    document.getElementById('loginError').textContent = 'Invalid management key';
    document.getElementById('loginError').style.display = 'block';
  }
}

/**
 * Logout and clear session
 */
export function logout() {
  localStorage.removeItem('managementKey');
  location.reload();
}

/**
 * Setup login form event listeners
 * @param {Function} onSuccess - Callback when login succeeds
 */
export function setupLoginHandlers(onSuccess) {
  const loginKeyInput = document.getElementById('loginKey');
  if (loginKeyInput) {
    loginKeyInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') login(onSuccess);
    });
  }
}
