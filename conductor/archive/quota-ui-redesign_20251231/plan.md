# Implementation Plan: Quota Tab UI/UX Improvement

## Phase 1: Foundation & Threshold Updates
<!-- execution: sequential -->

- [x] Task 1.1: Update quota threshold constants in quota.js
  - Change getQuotaColorClass: Critical < 30%, Warning < 60%, Healthy ≥ 60%
  - Add new helper function getQuotaStatus() returning 'critical'|'warning'|'healthy'
  <!-- files: static/js/pages/quota.js -->

- [x] Task 1.2: Add new CSS variables and base styles for redesign
  - Add status color variables for consistency
  - Add circular progress base styles
  - Add card border status styles
  <!-- files: static/css/pages/quota.css -->

- [x] Task 1.3: Restructure HTML header layout in custom-management.html
  - Two-row header: title+summary row, controls row
  - Add placeholder containers for summary bar and status filters
  <!-- files: static/custom-management.html -->

## Phase 2: Summary Bar Component
<!-- execution: sequential -->
<!-- depends: phase1 -->

- [x] Task 2.1: Create summary bar CSS styles
  - Summary container with flex layout
  - Status badge styles (critical/warning/healthy)
  - Clickable badge hover/active states
  - Responsive stacking for mobile
  <!-- files: static/css/pages/quota.css -->

- [x] Task 2.2: Implement summary bar JavaScript
  - Add calculateQuotaSummary() function to aggregate status counts
  - Add renderSummaryBar() function to generate HTML
  - Wire up click handlers for status badge filtering
  <!-- files: static/js/pages/quota.js -->

- [x] Task 2.3: Integrate summary bar into page load flow
  - Call renderSummaryBar() after quota data loads
  - Update summary when filters change or data refreshes
  <!-- files: static/js/pages/quota.js -->

## Phase 3: Card Redesign
<!-- execution: parallel -->
<!-- depends: phase1 -->

- [x] Task 3.1: Create circular progress indicator CSS
  - SVG-based circular gauge styles
  - Color variations for critical/warning/healthy
  - Size: 52px diameter with 6px stroke
  - Percentage text centered inside
  <!-- files: static/css/pages/quota.css -->

- [x] Task 3.2: Implement circular progress indicator JavaScript
  - Add renderCircularProgress(percentage, status) function
  - Generate SVG with proper stroke-dasharray calculation
  - Animate on load with CSS transition
  <!-- files: static/js/pages/quota.js -->
  <!-- depends: task1 -->

- [x] Task 3.3: Add color-coded card border styles
  - Left border 4px based on status
  - Subtle background tint for status indication
  - Hover state enhancements
  <!-- files: static/css/pages/quota.css -->

- [x] Task 3.4: Implement collapsible quota groups
  - Show only worst quota group by default
  - Add "Show N more" toggle button
  - Smooth expand/collapse animation (max-height transition)
  - Track expanded state per card
  <!-- files: static/js/pages/quota.js, static/css/pages/quota.css -->
  <!-- depends: task1, task2 -->

- [x] Task 3.5: Refactor card rendering functions
  - Update renderAntigravityQuotaCard, renderCodexQuotaCard, renderGeminiCliQuotaCard
  - Integrate circular indicator, status border, collapsible groups
  - Add getWorstQuotaGroup() helper function
  <!-- files: static/js/pages/quota.js -->
  <!-- depends: task2, task4 -->

## Phase 4: Sorting & Filtering Enhancements
<!-- execution: sequential -->
<!-- depends: phase2, phase3 -->

- [x] Task 4.1: Implement auto-sort by urgency
  - Add sortByQuotaUrgency() function
  - Sort cards: critical first, then warning, then healthy
  - Secondary sort by percentage within each category
  <!-- files: static/js/pages/quota.js -->

- [x] Task 4.2: Add status filter chips UI
  - Add Critical/Warning/Healthy filter buttons to header
  - Style consistent with existing provider filter buttons
  - Add "active" state styling
  <!-- files: static/custom-management.html, static/css/pages/quota.css -->

- [x] Task 4.3: Implement combined filtering logic
  - Add currentStatusFilter state variable
  - Update applyFilter() to combine provider + status filters
  - Wire up status filter button click handlers
  <!-- files: static/js/pages/quota.js -->

## Phase 5: View Toggle Feature
<!-- execution: sequential -->
<!-- depends: phase3 -->

- [x] Task 5.1: Add compact view CSS styles
  - Compact card layout: header + circular indicator only
  - Reduced padding and margins
  - Hide quota groups in compact mode
  <!-- files: static/css/pages/quota.css -->

- [x] Task 5.2: Implement view toggle JavaScript
  - Add currentViewMode state ('compact'|'detailed')
  - Add toggleViewMode() function
  - Update card rendering based on view mode
  <!-- files: static/js/pages/quota.js -->

- [x] Task 5.3: Add view toggle button and persistence
  - Add toggle button to header controls
  - Save preference to localStorage
  - Load preference on page init
  <!-- files: static/custom-management.html, static/js/pages/quota.js -->

## Phase 6: Mobile Responsiveness & Polish
<!-- execution: parallel -->
<!-- depends: phase2, phase3, phase4, phase5 -->

- [x] Task 6.1: Enhance mobile responsive styles
  - Summary bar vertical stacking below 640px
  - Filter chips wrap with proper spacing
  - Single column cards below 768px
  - Minimum touch target 44px for all buttons
  <!-- files: static/css/pages/quota.css -->

- [x] Task 6.2: Add accessibility improvements
  - ARIA labels for circular progress indicators
  - ARIA-expanded for collapsible sections
  - Focus states for all interactive elements
  - Screen reader text for status indicators
  <!-- files: static/js/pages/quota.js, static/css/pages/quota.css -->

- [x] Task 6.3: Final polish and testing
  - Verify all transitions are smooth (300ms)
  - Test with 50+ cards for performance
  - Cross-browser testing (Chrome, Firefox, Safari)
  - Fix any visual inconsistencies
  <!-- files: static/css/pages/quota.css, static/js/pages/quota.js -->

## Verification

- [x] Build check: Ensure no JavaScript errors in console
- [x] Manual test: All 10 acceptance criteria from spec.md
- [x] Mobile test: Verify layout at 375px, 768px, 1024px widths
