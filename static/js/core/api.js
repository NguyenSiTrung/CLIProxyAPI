/**
 * API Client Module
 * Handles all HTTP requests to the management API with authentication
 */

let apiKey = localStorage.getItem('managementKey') || '';

/**
 * Get the current API key
 * @returns {string} The current API key
 */
export function getApiKey() {
  return apiKey;
}

/**
 * Set the API key
 * @param {string} key - The new API key
 */
export function setApiKey(key) {
  apiKey = key;
}

/**
 * Make an authenticated API request to the management API
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param {string} endpoint - API endpoint (without /v0/management prefix)
 * @param {object|string|null} body - Request body (optional)
 * @returns {Promise<any>} Parsed response (JSON or text)
 * @throws {Error} If the request fails
 */
export async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  
  const res = await fetch(`/v0/management${endpoint}`, opts);
  
  if (!res.ok) {
    throw new Error(await res.text() || `HTTP ${res.status}`);
  }
  
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/**
 * Make an authenticated fetch request with full response access
 * Useful when you need access to response headers
 * @param {string} endpoint - API endpoint (without /v0/management prefix)
 * @param {object} options - Additional fetch options
 * @returns {Promise<Response>} Raw fetch Response object
 */
export async function apiFetch(endpoint, options = {}) {
  const opts = {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  };
  
  return fetch(`/v0/management${endpoint}`, opts);
}
