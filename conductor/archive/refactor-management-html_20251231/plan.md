# Implementation Plan: Refactor custom-management.html

> **Last Revised:** 2025-12-31 (Revision #1)
> Added server routes for static assets and ES module window bindings.
> See [revisions.md](./revisions.md) for details.

## Phase 1: Setup Directory Structure

- [x] Task 1.1: Create CSS directory structure
  - [x] Create `static/css/` directory
  - [x] Create `static/css/pages/` subdirectory

- [x] Task 1.2: Create JS directory structure
  - [x] Create `static/js/` directory
  - [x] Create `static/js/core/` subdirectory
  - [x] Create `static/js/pages/` subdirectory

## Phase 2: Extract CSS ✅ COMPLETED
<!-- execution: parallel -->
<!-- depends: phase1 -->

- [x] Task 2.1: Extract base CSS
  <!-- files: static/css/base.css -->
  - [x] Extract CSS variables (`:root` block)
  - [x] Extract reset styles (`*`, `html`, `body`)
  - [x] Extract typography and utility classes

- [x] Task 2.2: Extract component CSS
  <!-- files: static/css/components.css -->
  - [x] Extract button styles (.btn, .btn-primary, .btn-secondary, .btn-danger, .btn-sm)
  - [x] Extract card styles (.card, .card-header, .card-title)
  - [x] Extract form input styles (.form-group, .form-input)
  - [x] Extract modal styles (.modal-overlay, .modal, .modal-header, .modal-footer)
  - [x] Extract toggle/switch styles (.toggle, .toggle-enhanced)
  - [x] Extract badge styles (.badge, .badge-*)
  - [x] Extract toast styles (.toast-container, .toast)
  - [x] Extract table styles (table, th, td)

- [x] Task 2.3: Extract layout CSS
  <!-- files: static/css/layout.css -->
  - [x] Extract sidebar styles (.sidebar, .nav-item, .sidebar-logo)
  - [x] Extract header styles (.mobile-header, .hamburger-btn)
  - [x] Extract main content styles (.main, .page)
  - [x] Extract page header styles (.page-header, .page-title, .page-subtitle)
  - [x] Extract grid/stats styles (.stats-grid, .stat-card)
  - [x] Extract all @media responsive breakpoints

- [x] Task 2.4: Extract page-specific CSS
  <!-- files: static/css/pages/*.css -->
  - [x] dashboard.css: .dashboard-*, .quick-action-*, .server-status-*, .health-*
  - [x] models.css: .models-*, .pricing-*, .model-badge
  - [x] auth.css: .auth-*, .login-*, .oauth-*, .manual-callback-*
  - [x] keys.css: .keys-*, .key-card, .key-action-btn
  - [x] config.css: .config-*, .yaml-error-*, .code-editor
  - [x] usage.css: .usage-*, .date-range-*, .chart-*
  - [x] analytics.css: .analytics-*, .severity-*, pagination styles
  - [x] amp.css: .amp-*, .mapping-*, .combo-*
  - [x] logs.css: .log-*, .terminal-*, .scroll-bottom-btn

- [x] Task 2.5: Create CSS index file
  <!-- files: static/css/main.css -->
  <!-- depends: task2.1, task2.2, task2.3, task2.4 -->
  - [x] Create `css/main.css` that imports all CSS files in correct order

## Phase 3: Extract Core JavaScript Modules ✅ COMPLETED
<!-- execution: parallel -->
<!-- depends: phase1 -->

- [x] Task 3.1: Extract API client module
  <!-- files: static/js/core/api.js -->
  - [x] Export `api(method, endpoint, body)` function
  - [x] Include Authorization header handling
  - [x] Handle JSON/text response parsing
  - [x] Export `getApiKey()`, `setApiKey()` for key management

- [x] Task 3.2: Extract authentication module
  <!-- files: static/js/core/auth.js -->
  - [x] Export `checkAuth()` function
  - [x] Export `login()` function
  - [x] Export `logout()` function
  - [x] Handle localStorage session management

- [x] Task 3.3: Extract state module
  <!-- files: static/js/core/state.js -->
  - [x] Export shared state: `serverInfo`, `allModels`, `accessApiKeys`
  - [x] Export `modelPricingConfig`, `pricingConfigLoaded`
  - [x] Provide getter/setter functions for state updates

- [x] Task 3.4: Extract toast module
  <!-- files: static/js/core/toast.js -->
  - [x] Export `toast(message, type)` function
  - [x] Handle toast container and auto-dismiss

- [x] Task 3.5: Extract modal module
  <!-- files: static/js/core/modal.js -->
  - [x] Export `showModal(title, content, footer)` function
  - [x] Export `closeModal()` function
  - [x] Handle modal overlay and close button

- [x] Task 3.6: Extract router module
  <!-- files: static/js/core/router.js -->
  - [x] Export `navigateTo(page)` function
  - [x] Export `registerPageHandler(page, loadFunction)` function
  - [x] Handle nav item click events
  - [x] Handle page visibility switching
  - [x] Handle mobile sidebar toggle/close

## Phase 4: Extract Page JavaScript Modules ✅ COMPLETED
<!-- execution: parallel -->
<!-- depends: phase3 -->

- [x] Task 4.1: Extract dashboard module
  <!-- files: static/js/pages/dashboard.js -->
  - [x] Export `loadDashboard()` function
  - [x] Move `updateServerUptime()`, `checkLatestVersion()`
  - [x] Import api, state, toast from core

- [x] Task 4.2: Extract models module
  <!-- files: static/js/pages/models.js -->
  - [x] Export `loadModels()` function
  - [x] Move `fetchModels()`, `renderModels()`, `filterModels()`
  - [x] Move `filterModelsByProvider()`, `toggleProviderCard()`, `copyModelId()`
  - [x] Move pricing functions: `loadPricingConfig()`, `savePricingConfig()`
  - [x] Move `switchModelsTab()`, `renderPricingModels()`, `openPricingModal()`
  - [x] Move DEFAULT_MODEL_PRICING constant
  - [x] Import api, state, toast, modal from core

- [x] Task 4.3: Extract auth-files module
  <!-- files: static/js/pages/auth-files.js -->
  - [x] Export `loadAuthFiles()` function
  - [x] Move `startOAuth()`, `submitManualCallback()`, `hideManualCallback()`
  - [x] Move `handleFileDrop()`, `handleFileSelect()`, `uploadAuthFile()`
  - [x] Move `deleteAuthFile()`, `deleteAllAuthFiles()`, `refreshAuthToken()`
  - [x] Import api, toast, modal from core

- [x] Task 4.4: Extract keys module
  <!-- files: static/js/pages/keys.js -->
  - [x] Export `loadKeys()` function
  - [x] Move `renderKeysList()`, `openAddKeyModal()`, `addApiKey()`
  - [x] Move `deleteApiKey()`, `revealKey()`, `copyKey()`
  - [x] Handle keys tab switching
  - [x] Import api, state, toast, modal from core

- [x] Task 4.5: Extract config module
  <!-- files: static/js/pages/config.js -->
  - [x] Export `loadConfig()` function
  - [x] Move `saveConfigEnhanced()`, `reloadConfig()`
  - [x] Move `toggleSettingEnhanced()`, `onConfigEditorInput()`
  - [x] Handle YAML validation and unsaved indicator
  - [x] Import api, toast from core

- [x] Task 4.6: Extract usage module
  <!-- files: static/js/pages/usage.js -->
  - [x] Export `loadUsageStats()` function
  - [x] Move `setUsageDateRange()`, `setChartView()`
  - [x] Move chart initialization and rendering (requestsChart, tokensChart)
  - [x] Move `exportUsageData()`, `importUsageData()`, `triggerUsageImport()`
  - [x] Move cost calculation functions
  - [x] Import api, state, toast from core

- [x] Task 4.7: Extract analytics module
  <!-- files: static/js/pages/analytics.js -->
  - [x] Export `loadAnalytics()` function
  - [x] Move `filterAnalytics()`, `debounceFilterAnalytics()`, `clearAnalyticsFilters()`
  - [x] Move `sortAnalyticsTable()`, `changeAnalyticsPage()`, `changeAnalyticsPageSize()`
  - [x] Move `exportAnalytics()`, `showFailureDetail()`
  - [x] Move breakdown chart rendering
  - [x] Import api, toast, modal from core

- [x] Task 4.8: Extract amp module
  <!-- files: static/js/pages/amp.js -->
  - [x] Export `loadAmpSettings()` function
  - [x] Move `saveAmpSettings()`, `testAmpConnection()`, `toggleAmpSetting()`
  - [x] Move `toggleAmpKeyVisibility()`
  - [x] Move model mappings: `renderModelMappings()`, `openAddMappingModal()`, `filterMappings()`
  - [x] Move combos: `renderCombos()`, `openAddComboModal()`, `openManageCombosModal()`
  - [x] Import api, state, toast, modal from core

- [x] Task 4.9: Extract logs module
  <!-- files: static/js/pages/logs.js -->
  - [x] Export `loadLogs()` function
  - [x] Move `filterLogs()`, `setLogFilter()`, `clearLogs()`
  - [x] Move `toggleAutoRefresh()`, `startLogAutoRefresh()`, `stopLogAutoRefresh()`
  - [x] Move `scrollLogsToBottom()`, `jumpToNextError()`, `exportLogs()`
  - [x] Move log entry rendering and click handlers
  - [x] Import api, toast, modal from core

## Phase 5: Create Main Entry Point ✅ COMPLETED
<!-- depends: phase3, phase4 -->

- [x] Task 5.1: Create app.js entry point
  <!-- files: static/js/app.js -->
  - [x] Import all core modules (api, auth, state, toast, modal, router)
  - [x] Import all page modules
  - [x] Register page handlers with router
  - [x] Call `checkAuth()` on DOMContentLoaded
  - [x] Initialize keyboard shortcuts (Enter on login, Escape on modal)

- [x] Task 5.2: Handle module initialization
  - [x] Set up mobile sidebar toggle event
  - [x] Initialize any global event listeners
  - [x] Handle keys tab click events
  - [x] Handle login form Enter key

## Phase 6: Update HTML File ✅ COMPLETED
<!-- depends: phase2, phase5 -->

- [x] Task 6.1: Remove inline CSS and add link tag
  <!-- files: static/custom-management.html -->
  - [x] Remove entire `<style>...</style>` block (~7000 lines)
  - [x] Add `<link rel="stylesheet" href="css/main.css">` in `<head>`
  - [x] Keep Chart.js CDN script

- [x] Task 6.2: Remove inline JavaScript and add module script
  <!-- files: static/custom-management.html -->
  <!-- depends: task6.1 -->
  - [x] Remove entire `<script>...</script>` block (~5400 lines)
  - [x] Add `<script type="module" src="js/app.js"></script>` before `</body>`

- [x] Task 6.3: Verify HTML structure
  - [x] Ensure all element IDs referenced in JS are preserved
  - [x] HTML reduced from 14,519 lines to 2,044 lines
  - [x] Kept modal overlay and toast container elements

## Phase 7: Verification & Cleanup ✅ COMPLETED (Build verified, manual testing required)
<!-- depends: phase6 -->

- [~] Task 7.1: Functional testing (requires manual browser testing)
  - [ ] Test login/logout flow
  - [ ] Test Dashboard page loads with stats
  - [ ] Test Models page loads, search, filter, pricing modal
  - [ ] Test Auth page OAuth buttons, file upload, file list
  - [ ] Test Keys page tabs, add/delete keys
  - [ ] Test Config page toggles, YAML editor save
  - [ ] Test Usage page charts render, date filters work
  - [ ] Test Analytics page filters, pagination, table sorting
  - [ ] Test Amp page connection test, mappings, combos
  - [ ] Test Logs page live updates, filters, search

- [x] Task 7.2: Console error check (verified structure)
  - [x] Go build succeeds
  - [x] All CSS/JS files exist and are accessible
  - [x] No JavaScript syntax errors detected
  - [ ] Browser console check (manual)

- [~] Task 7.3: Mobile responsive check (requires manual testing)
  - [ ] Test mobile sidebar toggle works
  - [ ] Test mobile layout on each page
  - [ ] Test touch interactions

- [x] Task 7.4: Code cleanup
  - [x] All modules have file header comments
  - [x] Consistent ES module pattern across all files
  - [x] No dead code in new modules
