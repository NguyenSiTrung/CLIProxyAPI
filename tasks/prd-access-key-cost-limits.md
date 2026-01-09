# PRD: Access Key Cost Limits

## Introduction

Add the ability to set maximum cost limits per access key (API key) to control spending. When an access key's accumulated cost reaches its configured limit, all requests using that key are blocked with a 429 response until an admin manually resets the usage. This feature is entirely separate from the existing `api-keys` configuration to avoid merge conflicts with upstream updates.

## Goals

- Allow administrators to set a maximum cost (in USD) per access key
- Block requests (429) when an access key exceeds its cost limit
- Provide a global toggle to enable/disable the feature
- Display cost usage vs limit in the management UI
- Allow manual reset of accumulated cost per key via UI
- Persist accumulated cost data to survive server restarts
- Keep configuration separate from `api-keys` to avoid upstream merge conflicts

## User Stories

### US-001: Add access-key-limits configuration section
**Description:** As an administrator, I want to configure cost limits in a separate YAML section so that my configuration doesn't conflict with upstream updates.

**Acceptance Criteria:**
- [ ] New `access-key-limits` section in config.yaml (separate from `api-keys`)
- [ ] Schema supports: `enabled` (bool), `default-max-cost` (float), `keys` (array)
- [ ] Each key entry has: `api-key` (string), `max-cost` (float in USD)
- [ ] Config loads and validates correctly on server start
- [ ] Invalid config (negative cost, missing fields) logs warning and skips entry
- [ ] Typecheck/lint passes

### US-002: Implement cost calculation in Go backend
**Description:** As the system, I need to calculate request cost server-side so I can enforce limits before requests complete.

**Acceptance Criteria:**
- [ ] Fetch pricing data from existing `/model-pricing` endpoint on startup
- [ ] Fallback to hardcoded default pricing if endpoint unavailable
- [ ] Calculate cost using: `(input_tokens / 1M * input_price) + (output_tokens / 1M * output_price) + (cached_tokens / 1M * cached_price)`
- [ ] Cost calculation matches existing JavaScript implementation in usage.js
- [ ] Pricing data refreshes periodically (every 5 minutes) or on config reload
- [ ] Typecheck/lint passes

### US-003: Track accumulated cost per access key
**Description:** As the system, I need to track accumulated cost per access key so I can compare against limits.

**Acceptance Criteria:**
- [ ] In-memory map stores accumulated cost per API key
- [ ] Cost is added after each successful response (post-request, not pre-request)
- [ ] Accumulated cost persists to file using existing backup mechanism pattern
- [ ] On server start, load accumulated cost from persistence file if exists
- [ ] Thread-safe access to accumulated cost map
- [ ] Typecheck/lint passes

### US-004: Implement cost limit enforcement middleware
**Description:** As an administrator, I want requests blocked when a key exceeds its limit so I can control spending.

**Acceptance Criteria:**
- [ ] Middleware checks `access-key-limits.enabled` before enforcing
- [ ] If disabled, all requests pass through without limit checks
- [ ] If enabled, compare `accumulatedCost[apiKey]` against configured `max-cost`
- [ ] Return 429 with JSON body: `{"error": "Cost limit exceeded", "current_cost": X.XX, "max_cost": Y.YY, "api_key": "masked-key"}`
- [ ] Keys not listed in config use `default-max-cost` (0 = unlimited)
- [ ] Minimal latency impact (in-memory lookup only)
- [ ] Typecheck/lint passes

### US-005: Add global toggle in management UI
**Description:** As an administrator, I want to enable/disable cost limits from the UI so I don't need to edit YAML.

**Acceptance Criteria:**
- [ ] Toggle switch in Settings page or dedicated "Limits" section
- [ ] Toggle reflects current `access-key-limits.enabled` state
- [ ] Changing toggle updates config and takes effect immediately
- [ ] Toast notification confirms change
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-006: Add per-key limit configuration in UI
**Description:** As an administrator, I want to set cost limits per key in the UI so I can manage limits without editing YAML.

**Acceptance Criteria:**
- [ ] New "Cost Limits" tab or section in Keys page
- [ ] List shows all access keys with their current limit and accumulated cost
- [ ] Each row has: key (masked), max cost input, current cost display, usage percentage bar
- [ ] "Edit Limit" button opens modal to set/change max-cost for a key
- [ ] "Unlimited" option (max-cost = 0) available
- [ ] Changes save to config immediately
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-007: Add manual reset functionality
**Description:** As an administrator, I want to manually reset a key's accumulated cost so I can restore access after reviewing usage.

**Acceptance Criteria:**
- [ ] "Reset" button per key in the Cost Limits UI
- [ ] Confirmation dialog before reset: "Reset accumulated cost for key ****XXXX to $0.00?"
- [ ] Reset clears accumulated cost in memory and persistence file
- [ ] Toast notification confirms reset
- [ ] Reset action is logged (for audit purposes)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-008: Display cost usage in Usage Stats page
**Description:** As an administrator, I want to see cost vs limit per key in Usage Stats so I can monitor spending.

**Acceptance Criteria:**
- [ ] Provider/API Key breakdown shows: current cost, max cost (if set), percentage used
- [ ] Visual progress bar (green < 70%, yellow 70-90%, red > 90%)
- [ ] "Limit exceeded" badge shown for blocked keys
- [ ] Keys without limits show "Unlimited" instead of progress bar
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-009: Add management API endpoints
**Description:** As the system, I need API endpoints to manage cost limits programmatically.

**Acceptance Criteria:**
- [ ] `GET /v0/management/access-key-limits` - returns current config and accumulated costs
- [ ] `PUT /v0/management/access-key-limits/enabled` - toggle feature on/off
- [ ] `PUT /v0/management/access-key-limits/keys/:key` - set max-cost for a key
- [ ] `POST /v0/management/access-key-limits/keys/:key/reset` - reset accumulated cost
- [ ] All endpoints require management key authentication
- [ ] Typecheck/lint passes

### US-010: Add config.example.yaml documentation
**Description:** As a user, I want to see example configuration so I understand how to use this feature.

**Acceptance Criteria:**
- [ ] Add commented `access-key-limits` section to config.example.yaml
- [ ] Include all options with explanatory comments
- [ ] Example shows 2-3 keys with different limits
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: New `access-key-limits` config section, completely separate from `api-keys`
- FR-2: Global `enabled` toggle to activate/deactivate the feature
- FR-3: `default-max-cost` applies to keys not explicitly listed (0 = unlimited)
- FR-4: Per-key `max-cost` in USD (float, 2 decimal places)
- FR-5: Cost calculated using pricing from `/model-pricing` endpoint
- FR-6: Accumulated cost stored in-memory with file persistence
- FR-7: Manual reset only - no automatic daily/weekly/monthly reset
- FR-8: Hard block (429 response) when limit exceeded, no soft/warning mode
- FR-9: Masked API key in error responses (show last 4 chars only)
- FR-10: All UI changes in custom-management.html (not upstream panel)

## Non-Goals (Out of Scope)

- No automatic reset periods (daily/weekly/monthly) - manual reset only
- No soft limits or warning-only mode - hard block only
- No per-model limits - only per-key total cost
- No rate limiting (requests per minute) - only cost limiting
- No email/notification alerts when approaching limit
- No historical cost tracking beyond current accumulated total
- No integration with external billing systems

## Design Considerations

### Config Structure
```yaml
# Separate section - won't conflict with upstream
access-key-limits:
  enabled: true
  default-max-cost: 0  # 0 = unlimited for unlisted keys
  keys:
    - api-key: "key-team-a"
      max-cost: 100.00
    - api-key: "key-team-b"
      max-cost: 50.00
```

### 429 Response Format
```json
{
  "error": "Cost limit exceeded",
  "message": "API key ****XXXX has exceeded its cost limit",
  "current_cost": 50.25,
  "max_cost": 50.00,
  "currency": "USD"
}
```

### UI Layout
- Settings page: Global toggle switch
- Keys page: New "Cost Limits" tab alongside existing tabs
- Usage Stats: Enhanced provider breakdown with limit info

## Technical Considerations

- Reuse existing `usage-auto-backup` pattern for persistence
- Cost accumulation happens post-response (after tokens are known)
- Pre-request check uses last-known accumulated cost (eventual consistency)
- Pricing refresh happens asynchronously, doesn't block requests
- File persistence uses atomic write (write to temp, rename)
- Thread-safe map access using sync.RWMutex

### Files to Modify/Create
- `internal/config/config.go` - Add AccessKeyLimits struct
- `internal/config/sdk_config.go` - Add to SDKConfig
- `internal/api/middleware/cost_limit.go` - New middleware (create)
- `internal/api/handlers/management/cost_limits.go` - New handlers (create)
- `internal/cost/calculator.go` - Cost calculation logic (create)
- `internal/cost/persistence.go` - File persistence (create)
- `static/custom-management.html` - UI additions
- `static/js/pages/keys.js` - Cost limits tab
- `config.example.yaml` - Documentation

## Success Metrics

- Requests blocked correctly when cost limit exceeded
- Less than 1ms additional latency from limit check
- Accumulated cost survives server restart
- UI clearly shows which keys are limited/blocked
- Zero merge conflicts with upstream `api-keys` changes

## Open Questions

- Should we show a warning in UI when a key is at 90%+ of limit?
- Should reset action require confirmation via management key re-entry?
- Should we add a "bulk reset all" option for convenience?
- Should blocked requests still count toward accumulated cost (for visibility)?
