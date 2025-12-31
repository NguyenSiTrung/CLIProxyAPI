/**
 * Router/Navigation Module
 * Handles page navigation and sidebar interactions
 */

// Page handler registry
const pageHandlers = {};

/**
 * Register a handler function for a page
 * @param {string} page - Page name (e.g., 'dashboard', 'models')
 * @param {Function} loadFunction - Function to call when navigating to the page
 */
export function registerPageHandler(page, loadFunction) {
  pageHandlers[page] = loadFunction;
}

/**
 * Navigate to a specific page
 * @param {string} page - Page name to navigate to
 */
export function navigateTo(page) {
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.click();
}

/**
 * Toggle mobile sidebar visibility
 */
export function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  
  if (!sidebar) return;
  
  const isOpen = sidebar.classList.contains('mobile-open');
  
  if (isOpen) {
    sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  } else {
    sidebar.classList.add('mobile-open');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close mobile sidebar
 */
export function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Handle navigation item click
 * @param {HTMLElement} item - The clicked nav item
 * @param {Function} onBeforeNavigate - Optional callback before navigation (e.g., stop log refresh)
 */
function handleNavClick(item, onBeforeNavigate) {
  // Update active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  item.classList.add('active');
  
  const page = item.dataset.page;
  
  // Hide all pages, show selected
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  
  // Call before navigate callback (e.g., to stop log refresh)
  if (onBeforeNavigate) onBeforeNavigate(page);
  
  // Call page handler if registered
  if (pageHandlers[page]) {
    pageHandlers[page]();
  }
}

/**
 * Setup navigation event listeners
 * @param {Function} onBeforeNavigate - Optional callback before navigation
 */
export function setupNavigation(onBeforeNavigate) {
  // Main nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      handleNavClick(item, onBeforeNavigate);
    });
  });
  
  // Close sidebar on nav click (mobile)
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });
  });
}

/**
 * Setup tab switching within a page
 * @param {string} tabSelector - CSS selector for tab buttons
 * @param {string} contentSelector - CSS selector for tab content elements
 * @param {string} dataAttribute - Data attribute name for tab identifier (default: 'tab')
 */
export function setupTabs(tabSelector, contentSelector, dataAttribute = 'tab') {
  document.querySelectorAll(tabSelector).forEach(tab => {
    tab.addEventListener('click', () => {
      // Update tab active state
      document.querySelectorAll(tabSelector).forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update content visibility
      document.querySelectorAll(contentSelector).forEach(c => c.classList.remove('active'));
      const tabId = tab.dataset[dataAttribute];
      const content = document.getElementById(`tab-${tabId}`) || 
                      document.getElementById(`${dataAttribute}-${tabId}`);
      if (content) content.classList.add('active');
    });
  });
}

/**
 * Setup keys tabs (special handler for API keys page)
 */
export function setupKeysTabs() {
  document.querySelectorAll('.keys-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.keys-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.keys-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`keytab-${tab.dataset.keytab}`).classList.add('active');
    });
  });
}

/**
 * Initialize router (call once on page load)
 * @param {Function} onBeforeNavigate - Optional callback before navigation
 */
export function initRouter(onBeforeNavigate) {
  document.addEventListener('DOMContentLoaded', () => {
    setupNavigation(onBeforeNavigate);
    setupKeysTabs();
    setupTabs('.tab', '.tab-content', 'tab');
  });
}
