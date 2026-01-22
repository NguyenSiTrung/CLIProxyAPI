/**
 * Modal Dialog Module
 * Handles modal dialog display and interactions
 */

/**
 * Escape HTML entities to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show a modal dialog
 * @param {string} title - Modal title
 * @param {string} content - Modal body content (HTML)
 * @param {string} footer - Modal footer content (HTML), optional
 * @param {string} sizeClass - Optional size class (e.g., 'modal-lg', 'modal-xl')
 */
export function showModal(title, content, footer = '', sizeClass = '') {
  const titleEl = document.getElementById('modalTitle');
  const contentEl = document.getElementById('modalContent');
  const footerEl = document.getElementById('modalFooter');
  const modal = document.getElementById('modal');
  const modalInner = document.querySelector('#modal .modal');
  
  if (titleEl) titleEl.textContent = title;
  if (contentEl) contentEl.innerHTML = content;
  if (footerEl) footerEl.innerHTML = footer;
  if (modal) modal.classList.add('active');
  
  // Handle size classes
  if (modalInner) {
    modalInner.classList.remove('modal-lg', 'modal-xl');
    if (sizeClass) {
      modalInner.classList.add(sizeClass);
    }
  }
}

/**
 * Close the currently open modal
 */
export function closeModal() {
  const modal = document.getElementById('modal');
  const modalInner = document.querySelector('#modal .modal');
  
  if (modal) modal.classList.remove('active');
  if (modalInner) {
    // Remove all custom modal classes
    modalInner.classList.remove('provider-detail-modal', 'provider-detail-modal-v2', 'modal-lg', 'modal-xl');
  }
}

/**
 * Show a confirmation modal
 * @param {string} title - Modal title
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback when user confirms
 * @param {string} confirmText - Text for confirm button (default: 'Confirm')
 * @param {string} confirmClass - CSS class for confirm button (default: 'btn-primary')
 */
export function showConfirmModal(title, message, onConfirm, confirmText = 'Confirm', confirmClass = 'btn-primary') {
  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = 'text-align:center; padding: 24px 0;';
  
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--text-secondary); font-size:14px; max-width:300px; margin:0 auto;';
  p.textContent = message;
  contentDiv.appendChild(p);
  
  const footer = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn ${confirmClass}" id="modalConfirmBtn">${escapeHtml(confirmText)}</button>
  `;
  
  showModal(title, contentDiv.outerHTML, footer);
  
  // Attach confirm handler
  const confirmBtn = document.getElementById('modalConfirmBtn');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      closeModal();
      if (onConfirm) onConfirm();
    };
  }
}

/**
 * Setup escape key to close modal
 */
export function setupModalKeyHandlers() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal');
      if (modal && modal.classList.contains('active')) {
        closeModal();
      }
    }
  });
}

/**
 * Setup modal overlay click to close
 */
export function setupModalClickHandlers() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      // Close if clicking the overlay (not the modal content)
      if (e.target === modal) {
        closeModal();
      }
    });
  }
}

/**
 * Initialize modal handlers (call once on page load)
 */
export function initModal() {
  setupModalKeyHandlers();
  setupModalClickHandlers();
}
