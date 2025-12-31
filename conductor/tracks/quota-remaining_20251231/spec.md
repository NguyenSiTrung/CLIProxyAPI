# Spec: Provider Auth Quota Remaining Feature

> **Last Revised:** 2025-12-31 (Revision #1 - Manual-only refresh)

## Overview

Implement a quota remaining display feature for custom-management.html that shows real-time quota information for provider authentication files. The feature mirrors functionality from the original management.html (from Cli-Proxy-API-Management-Center) with support for Antigravity, Codex, and Gemini CLI providers.

## Functional Requirements

### FR1: Supported Providers
The feature must support quota checking for:
- **Antigravity** (Google-based auth) - via `https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
  - Fallback URLs: sandbox and prod endpoints
  - Response format: `models.*` with `quotaInfo` containing `remainingFraction`
  - Quota type: Request-based (percentage only, no count)
- **Codex** (ChatGPT backend) - via `https://chatgpt.com/backend-api/wham/usage`
  - Requires `Chatgpt-Account-Id` header extracted from `id_token`
  - Response format: `rate_limit` with `primary_window`, `secondary_window`
- **Gemini CLI** (Google Cloud project-based) - via `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`
  - Requires `project` parameter extracted from `account` field
  - Response format: `buckets[]` with `remainingFraction` and `remainingAmount`
  - Quota type: Can be request-based or token-based

### FR2: UI Locations

#### FR2.1: Dashboard Summary (OPTIONAL)
- Display a compact quota summary widget on the Dashboard page
- Show aggregated quota health (e.g., "3/5 auths healthy", warning indicators)
- Quick link to full Quota page

#### FR2.2: Dedicated Quota Page
- New navigation item "Quota" in sidebar
- Full-page view with quota cards for each supported auth file
- Pagination support (6/9/12/18/24 items per page)

### FR3: Quota Information Display

#### FR3.1: Antigravity Quota
- Quota groups with labels (Claude/GPT, Gemini 3 Pro, Gemini 2.5 Flash, etc.)
- Remaining fraction as percentage with progress bar
- Color coding: green (>60%), yellow (20-60%), red (<20%)
- Reset time formatted as local date/time (per group)

#### FR3.2: Codex Quota
- Plan type badge (Free, Plus, Team)
- Rate limit windows:
  - Primary window (hourly limit)
  - Secondary window (weekly limit)
  - Code review window
- Used/remaining percentage with progress bar
- Reset time for each window
- Warning message for free plan limitations

#### FR3.3: Gemini CLI Quota
- Model groups (Gemini 2.5 Flash Series, Gemini 2.5 Pro, Gemini 3 Pro Preview)
- Remaining fraction as percentage with progress bar
- Remaining amount (numerical count where available)
- Token type indicator (if applicable)
- Reset time formatted as local date/time

### FR4: Refresh Behavior

#### FR4.1: Manual Refresh Only
- "Refresh" button on each quota card for individual auth
- "Fetch All" button to refresh all quota data on current page
- **No automatic fetching on page load** - cards show idle state until user clicks refresh
- Idle cards display "Click refresh to fetch quota" message

#### [-] FR4.2: Auto-refresh on Page Load [REMOVED: User requested manual-only]

#### [-] FR4.3: Periodic Auto-refresh [REMOVED: User requested manual-only]

### FR5: Error Handling

#### FR5.1: Error Display
- Show error message with HTTP status code (403/404) in card
- Different styling for error states

#### FR5.2: Unsupported Providers
- Show "Quota N/A" badge for non-supported providers (Anthropic, Qwen, iFlow)
- Option to filter/hide unsupported providers from Quota page

#### FR5.3: Retry Logic
- Automatic retry for failed requests with exponential backoff
- Maximum 3 retry attempts

#### FR5.4: Stale Data Handling
- Display "Last updated: X minutes ago" timestamp
- Visual indicator when data may be stale (>10 minutes)

## Non-Functional Requirements

### NFR1: Performance
- Parallel quota fetching for multiple auth files (when Fetch All clicked)
- Timeout of 60 seconds per request (matches existing api-call endpoint)
- Debounce rapid refresh clicks

### NFR2: UX Consistency
- Match existing custom-management.html styling and component patterns
- Use existing CSS classes and design tokens
- Responsive design for mobile/tablet

### NFR3: Code Organization
- New `static/js/pages/quota.js` module following existing patterns
- Reuse `api()` helper from `static/js/core/api.js`
- Add quota page HTML section to `custom-management.html`

## Acceptance Criteria

1. [x] Quota page accessible from sidebar navigation
2. [x] Antigravity auth files show quota groups with remaining percentage and reset time
3. [x] Codex auth files show plan type, rate limit windows with remaining percentage
4. [x] Gemini CLI auth files show model groups with remaining fraction/amount
5. [ ] Dashboard shows quota summary widget with health indicators (OPTIONAL)
6. [x] Manual refresh works for individual auth and "Fetch All"
7. [x] Cards show idle state until user manually fetches quota data
8. [-] Periodic auto-refresh updates data at configured interval [REMOVED]
9. [x] Error states display appropriate messages with status codes
10. [x] Unsupported providers show "Quota N/A" badge
11. [x] Failed requests retry with backoff (max 3 attempts)
12. [x] Last updated timestamp displayed for each quota card
13. [x] Progress bars use correct color coding (green/yellow/red)
14. [x] Page is responsive and matches existing UI patterns

## Out of Scope

- Quota alerts/notifications
- Historical quota tracking
- Quota data export
- Backend API changes (uses existing `/v0/management/api-call` endpoint)
- Cost estimation features
- Automatic/periodic refresh (removed per user request)
