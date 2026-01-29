# Revisions: Refactor custom-management.html

## Revision #1 - 2025-12-31

**Type:** Plan (missing implementation details)
**Triggered by:** Runtime testing after initial implementation
**Current phase when discovered:** Phase 7 (Verification)

### Issues Discovered

During browser testing, we discovered that the plan was missing critical implementation details for the modular ES module architecture:

1. **Static Asset Serving:** The Go server only served `/management.html` - it didn't have routes for `/css/*` and `/js/*` to serve the extracted CSS and JS files.

2. **Window Bindings for onclick Handlers:** The HTML uses inline `onclick="functionName()"` handlers, but ES modules don't expose functions globally by default. All page modules needed to expose their functions to `window` for the HTML onclick handlers to work.

### Changes Made

#### Server Changes (internal/api/server.go)
- Added `/css/*filepath` route to serve CSS files
- Added `/js/*filepath` route to serve JS files
- Added `serveManagementStaticAsset()` handler function

#### JavaScript Module Changes
- Added `window.functionName = functionName` bindings to all page modules:
  - `models.js`: 15 functions exposed
  - `logs.js`: 10 functions exposed
  - `analytics.js`: 6 functions exposed
  - `amp.js`: 8 functions exposed
  - `dashboard.js`: 2 functions exposed
  - `auth-files.js`: 10 functions exposed
  - `keys.js`: 2 functions exposed
  - `config.js`: 5 functions exposed
  - `usage.js`: 6 functions exposed
  - `app.js`: 6 global functions exposed

### Impact
- No spec changes required
- Plan updated to note that ES modules require window exposure for HTML onclick handlers
- Implementation is now fully functional

### Rationale
The original plan focused on code extraction but didn't account for:
1. The server needing new routes for static assets
2. ES modules' encapsulation preventing direct HTML onclick access

These are common gotchas when migrating from inline JavaScript to ES modules.
