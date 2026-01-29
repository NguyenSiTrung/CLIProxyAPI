# Plan: Provider Auth Quota Remaining Feature

> **Last Revised:** 2025-12-31 (Revision #1 - Manual-only refresh)

## Phase 1: Core Infrastructure
<!-- execution: sequential -->

- [x] Task 1.1: Create quota.js module skeleton
  - Create `static/js/pages/quota.js` with module structure
  - Add imports for api, toast, modal utilities
  - Export placeholder functions for page loading

- [x] Task 1.2: Add Quota page HTML section to custom-management.html
  - Add `page-quota` div with page header and empty container
  - Add navigation item "Quota" in sidebar
  - Include quota.js script in HTML

- [x] Task 1.3: Add quota.css styles
  - Create quota card styles (reuse existing card patterns)
  - Add progress bar styles with color coding
  - Add quota-specific badges and status indicators

- [x] Task: Conductor - User Manual Verification 'Phase 1: Core Infrastructure' (Protocol in workflow.md)

## Phase 2: API Integration Layer
<!-- execution: sequential -->

- [x] Task 2.1: Implement quota API call helper
  - Create `callQuotaAPI(authIndex, url, method, headers, data)` function
  - Use existing `/v0/management/api-call` endpoint
  - Handle $TOKEN$ substitution via auth_index

- [x] Task 2.2: Implement Antigravity quota fetcher
  - Create `fetchAntigravityQuota(authFile)` function
  - Call fallback URLs: daily → sandbox → prod
  - User-Agent: `antigravity/1.11.5 windows/amd64`
  - Parse `models.*` with `quotaInfo` for remaining fraction
  - Group models into quota groups (Claude/GPT, Gemini Pro, etc.)

- [x] Task 2.3: Implement Codex quota fetcher
  - Create `fetchCodexQuota(authFile)` function
  - Extract `chatgpt_account_id` from `id_token` (JWT decode)
  - Add `Chatgpt-Account-Id` header
  - User-Agent: `codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal`
  - Parse `rate_limit` with `primary_window`, `secondary_window`

- [x] Task 2.4: Implement Gemini CLI quota fetcher
  - Create `fetchGeminiCliQuota(authFile)` function
  - Extract project ID from `account` field (regex for parentheses)
  - Call with `{ project: projectId }` payload
  - Parse `buckets[]` with `remainingFraction`, `remainingAmount`
  - Group buckets by model groups

- [x] Task: Conductor - User Manual Verification 'Phase 2: API Integration Layer' (Protocol in workflow.md)

## Phase 3: Quota Display Components
<!-- execution: parallel -->

- [x] Task 3.1: Create quota card renderer for Antigravity
  <!-- files: static/js/pages/quota.js -->
  - Create `renderAntigravityQuotaCard(authFile, quotaData)` function
  - Display quota groups with progress bars
  - Show remaining percentage with color coding
  - Format reset time as local date/time per group

- [x] Task 3.2: Create quota card renderer for Codex
  <!-- files: static/js/pages/quota.js -->
  - Create `renderCodexQuotaCard(authFile, quotaData)` function
  - Display plan type badge
  - Show rate limit windows with progress bars
  - Add free plan warning if applicable

- [x] Task 3.3: Create quota card renderer for Gemini CLI
  <!-- files: static/js/pages/quota.js -->
  - Create `renderGeminiCliQuotaCard(authFile, quotaData)` function
  - Display model groups with progress bars
  - Show remaining amount and token type
  - Format reset time

- [x] Task 3.4: Create error, idle, and N/A card renderers
  <!-- files: static/js/pages/quota.js -->
  - Create `renderQuotaErrorCard(authFile, error)` function
  - Create `renderQuotaUnavailableCard(authFile)` for unsupported providers
  - Create `renderIdleCard(authFile)` for not-yet-fetched state
  - Show status code and error message styling

- [x] Task: Conductor - User Manual Verification 'Phase 3: Quota Display Components' (Protocol in workflow.md)

## Phase 4: Quota Page Logic
<!-- execution: sequential -->

- [x] Task 4.1: Implement loadQuotaPage function
  - Fetch auth files via `/v0/management/auth-files`
  - Filter by supported providers (antigravity, codex, gemini-cli)
  - Show idle state cards (no auto-fetch)

- [x] Task 4.2: Implement quota fetching orchestration
  - Create `fetchAllQuotas(authFiles)` for parallel fetching
  - Create `fetchQuotaForAuth(authFile)` that routes to correct fetcher
  - Store quota data in module state
  - Show loading spinner during fetch

- [x] Task 4.3: Implement individual refresh functionality
  - Add refresh button click handler per card
  - Show loading spinner during refresh
  - Update card with new data

- [x] Task 4.4: Implement "Fetch All" functionality
  - Add "Fetch All" button in page header
  - Fetch quota for all visible auth files
  - Show progress indicator

- [x] Task: Conductor - User Manual Verification 'Phase 4: Quota Page Logic' (Protocol in workflow.md)

## Phase 5: Refresh Mechanisms
<!-- execution: sequential -->

- [x] Task 5.1: Implement manual-only refresh with idle state
  - Cards show idle state until user clicks refresh
  - Display "Click refresh to fetch quota" message
  - No auto-fetch on page load

- [-] Task 5.2: Implement periodic auto-refresh [REMOVED: User requested manual-only]

- [x] Task 5.3: Implement retry with backoff
  - Create `retryWithBackoff(fn, maxAttempts, baseDelay)` utility
  - Apply to quota fetch functions
  - Maximum 3 retry attempts

- [x] Task 5.4: Implement stale data tracking
  - Store last fetch timestamp per auth
  - Display "Last updated: X ago" in each card
  - Visual indicator for stale data (>10 minutes)

- [x] Task: Conductor - User Manual Verification 'Phase 5: Refresh Mechanisms' (Protocol in workflow.md)

## Phase 6: Dashboard Integration (OPTIONAL)
<!-- execution: sequential -->
<!-- depends: phase4 -->

- [ ] Task 6.1: Create dashboard quota summary widget
  - Add quota summary card to dashboard page
  - Show count of healthy/warning/error auths
  - Add "View All" link to Quota page

- [ ] Task 6.2: Implement dashboard quota data loading
  - Fetch quota summary on dashboard load (or manual trigger)
  - Cache results to avoid duplicate fetches
  - Show loading state

- [ ] Task: Conductor - User Manual Verification 'Phase 6: Dashboard Integration' (Protocol in workflow.md)

## Phase 7: Pagination & Filtering
<!-- execution: sequential -->

- [x] Task 7.1: Implement pagination for quota page
  - Add page size selector (6/9/12/18/24)
  - Create pagination controls
  - No auto-fetch on page/filter change

- [x] Task 7.2: Implement provider filtering
  - Add filter buttons for Antigravity/Codex/Gemini CLI
  - Add toggle to show/hide unsupported providers
  - Persist filter preference

- [x] Task: Conductor - User Manual Verification 'Phase 7: Pagination & Filtering' (Protocol in workflow.md)

## Phase 8: Polish & Testing (OPTIONAL)
<!-- execution: sequential -->

- [ ] Task 8.1: Responsive design adjustments
  - Test on mobile/tablet viewports
  - Adjust card grid for smaller screens
  - Ensure touch-friendly interactions

- [ ] Task 8.2: Error handling edge cases
  - Handle network timeouts gracefully
  - Handle expired/invalid tokens
  - Handle empty auth file list

- [ ] Task 8.3: Final UI polish
  - Verify color coding matches spec
  - Ensure consistent spacing and typography
  - Add appropriate loading animations

- [ ] Task: Conductor - User Manual Verification 'Phase 8: Polish & Testing' (Protocol in workflow.md)
