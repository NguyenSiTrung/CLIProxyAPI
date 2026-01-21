/**
 * Toast Notification Module
 * Displays temporary notification messages to the user
 */

const TOAST_TIMEOUT = 4000;

/**
 * Get or create the toast container element
 * @returns {HTMLElement} The toast container
 */
function getToastContainer() {
  let container = document.getElementById('toastContainer');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  return container;
}

/**
 * Display a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Toast type: 'info', 'success', 'error', 'warning'
 * @param {number} duration - How long to show the toast (ms), default 4000
 */
export function toast(message, type = 'info', duration = TOAST_TIMEOUT) {
  const container = getToastContainer();
  
  const toastEl = document.createElement('div');
  toastEl.className = `toast ${type}`;
  
  const span = document.createElement('span');
  // Truncate message to prevent UI overflow and cap potential attack surface
  const safeMessage = typeof message === 'string' ? message.slice(0, 500) : String(message);
  span.textContent = safeMessage;
  toastEl.appendChild(span);
  
  container.appendChild(toastEl);
  
  setTimeout(() => {
    toastEl.classList.add('fade-out');
    setTimeout(() => toastEl.remove(), 300);
  }, duration);
}

/**
 * Display a success toast
 * @param {string} message - The message to display
 */
export function toastSuccess(message) {
  toast(message, 'success');
}

/**
 * Display an error toast
 * @param {string} message - The message to display
 */
export function toastError(message) {
  toast(message, 'error');
}

/**
 * Display a warning toast
 * @param {string} message - The message to display
 */
export function toastWarning(message) {
  toast(message, 'warning');
}

/**
 * Display an info toast
 * @param {string} message - The message to display
 */
export function toastInfo(message) {
  toast(message, 'info');
}
