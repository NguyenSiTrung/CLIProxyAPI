# Specification: Refactor custom-management.html

## Overview

Refactor the monolithic `static/custom-management.html` (14,519 lines) into a modular, maintainable structure. The file currently contains all CSS (~7,000 lines), HTML (~2,000 lines), and JavaScript (~5,400 lines) inline. This refactor will split it into separate files organized by concern while preserving exact functionality.

## Functional Requirements

### FR-1: File Structure
Create the following directory structure:
```
static/
├── css/
│   ├── base.css              # CSS variables, reset, typography, body styles
│   ├── components.css        # Buttons, cards, modals, forms, toggles, badges
│   ├── layout.css            # Sidebar, header, main content, mobile responsive
│   └── pages/
│       ├── dashboard.css     # Dashboard-specific styles
│       ├── models.css        # Models & pricing page styles
│       ├── auth.css          # Authentication page styles
│       ├── keys.css          # API Keys page styles
│       ├── config.css        # Configuration page styles
│       ├── usage.css         # Usage stats page styles
│       ├── analytics.css     # Analytics page styles
│       ├── amp.css           # Amp Code page styles
│       └── logs.css          # Logs page styles
│
├── js/
│   ├── core/
│   │   ├── api.js            # API client, fetch wrapper, error handling
│   │   ├── auth.js           # Login, logout, session management
│   │   ├── router.js         # Page navigation, URL handling
│   │   ├── state.js          # Shared state (serverInfo, allModels, etc.)
│   │   ├── toast.js          # Toast notification system
│   │   └── modal.js          # Modal dialog handling
│   │
│   ├── pages/
│   │   ├── dashboard.js      # Dashboard page logic
│   │   ├── models.js         # Models listing & pricing
│   │   ├── auth-files.js     # Auth files & OAuth flows
│   │   ├── keys.js           # API keys management
│   │   ├── config.js         # Configuration editor
│   │   ├── usage.js          # Usage statistics & charts
│   │   ├── analytics.js      # Failure analytics
│   │   ├── amp.js            # Amp Code settings
│   │   └── logs.js           # Log viewer
│   │
│   └── app.js                # Main entry point, initialization
│
└── custom-management.html    # Slim HTML shell with imports
```

### FR-2: ES Modules
- Use native ES modules (`<script type="module">`)
- Each JS file exports its public functions/classes
- `app.js` imports and initializes all modules
- No build step required - files served directly

### FR-3: CSS Organization
- Extract CSS into logical files by concern
- Use `@import` or multiple `<link>` tags in HTML
- Maintain all existing CSS variables in `base.css`
- Preserve all responsive breakpoints and mobile styles

### FR-4: HTML Structure
- Keep all HTML markup in `custom-management.html`
- Remove inline `<style>` and `<script>` blocks
- Add `<link>` tags for CSS files
- Add `<script type="module" src="js/app.js">` for JS entry

### FR-5: Preserved Functionality
All existing features must work identically:
- Login/logout authentication
- Dashboard stats and server status
- Models listing and pricing configuration
- OAuth flows and auth file management
- API keys CRUD operations
- YAML configuration editor
- Usage statistics with charts
- Failure analytics with filtering/pagination
- Amp Code settings and model mappings
- Real-time log viewer with filtering

## Non-Functional Requirements

### NFR-1: Performance
- Leverage browser caching via separate files
- Enable gzip compression on server (already supported)
- Lazy-load page modules when navigating (optional enhancement)

### NFR-2: Developer Experience
- Clear file organization matching navigation structure
- Each page's code isolated in its own file
- Shared utilities in `core/` for reuse

### NFR-3: Browser Compatibility
- Target modern browsers (ES modules support)
- Maintain existing responsive design for mobile

## Acceptance Criteria

1. [ ] All CSS extracted into separate files under `static/css/`
2. [ ] All JS extracted into ES modules under `static/js/`
3. [ ] `custom-management.html` reduced to HTML structure + imports only
4. [ ] Login/authentication works correctly
5. [ ] All 9 navigation pages load and function correctly
6. [ ] Mobile responsive layout preserved
7. [ ] No console errors during normal operation
8. [ ] Charts render correctly on Usage page
9. [ ] Real-time log updates work on Logs page
10. [ ] OAuth popup flows work on Auth page

## Out of Scope

- Adding new features or changing UI design
- Adding build tools (webpack, vite, esbuild)
- Adding TypeScript
- Adding unit tests
- Changing the backend Go code
- Changing API endpoints
