/**
 * Main Application Entry Point
 * Imports all modules and initializes the application
 */

// Core modules
import { getApiKey } from './core/api.js';
import { checkAuth, login, logout, setupLoginHandlers } from './core/auth.js';
import { toast } from './core/toast.js';
import { initModal, closeModal } from './core/modal.js';
import { 
  registerPageHandler, 
  setupNavigation, 
  setupKeysTabs, 
  toggleMobileSidebar, 
  closeMobileSidebar,
  navigateTo 
} from './core/router.js';

// Page modules
import { loadDashboard, setFetchModelsFunc } from './pages/dashboard.js';
import { loadModels, fetchModels } from './pages/models.js';
import { loadAuthFiles } from './pages/auth-files.js';
import { loadKeys, setupKeysTabHandlers } from './pages/keys.js';
import { loadConfig, setupConfigKeyboardShortcuts } from './pages/config.js';
import { loadUsageStats, initAutoBackup, destroyUsageCharts } from './pages/usage.js';
import { loadAnalytics } from './pages/analytics.js';
import { loadAmpSettings } from './pages/amp.js';
import { loadLogs, setupLogScrollTracking, setupLogEventDelegation, initLogKeyboardShortcuts } from './pages/logs.js';
import { stopLogAutoRefresh } from './pages/logs.js';
import { loadQuotaPage, stopAutoRefresh as stopQuotaAutoRefresh } from './pages/quota.js';

// Wire up dashboard's fetchModels dependency
setFetchModelsFunc(fetchModels);

/**
 * Callback before navigating away from a page
 * Used to clean up page-specific resources
 */
function onBeforeNavigate(page) {
  // Stop log auto-refresh when leaving logs page
  if (page !== 'logs') {
    stopLogAutoRefresh();
  }
  // Stop quota auto-refresh when leaving quota page
  if (page !== 'quota') {
    stopQuotaAutoRefresh();
  }
  // Clean up chart instances when leaving usage page
  if (page !== 'usage') {
    destroyUsageCharts();
  }
}

/**
 * Initial page load - loads dashboard
 */
function onAuthSuccess() {
  loadDashboard();
}

/**
 * Initialize the application
 */
function init() {
  // Register page handlers
  registerPageHandler('dashboard', loadDashboard);
  registerPageHandler('models', loadModels);
  registerPageHandler('auth', loadAuthFiles);
  registerPageHandler('keys', loadKeys);
  registerPageHandler('config', loadConfig);
  registerPageHandler('usage', loadUsageStats);
  registerPageHandler('analytics', loadAnalytics);
  registerPageHandler('amp', loadAmpSettings);
  registerPageHandler('logs', loadLogs);
  registerPageHandler('quota', loadQuotaPage);

  // Setup navigation
  setupNavigation(onBeforeNavigate);
  
  // Setup keys tabs
  setupKeysTabHandlers();
  
  // Setup config keyboard shortcuts (Ctrl+S to save)
  setupConfigKeyboardShortcuts();

  // Setup log page features
  setupLogScrollTracking();
  setupLogEventDelegation();
  initLogKeyboardShortcuts();

  // Initialize modal system
  initModal();

  // Initialize auto-backup system
  initAutoBackup();

  // Setup login handlers
  setupLoginHandlers(onAuthSuccess);

  // Setup mobile sidebar toggle
  const hamburgerBtn = document.querySelector('.hamburger-btn');
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', toggleMobileSidebar);
    hamburgerBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      toggleMobileSidebar();
    });
  }

  // Setup sidebar overlay click to close
  const sidebarOverlay = document.querySelector('.sidebar-overlay');
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
    sidebarOverlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      closeMobileSidebar();
    });
  }

  // Check authentication and load dashboard if authenticated
  checkAuth(onAuthSuccess);
}

// Expose global functions for HTML onclick handlers
window.login = () => login(onAuthSuccess);
window.logout = logout;
window.navigateTo = navigateTo;
window.toggleMobileSidebar = toggleMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.closeModal = closeModal;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
