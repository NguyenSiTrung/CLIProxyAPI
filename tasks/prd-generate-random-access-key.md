# PRD: Generate Random API Key for Access Keys

## Introduction

Add a "Generate Random Key" button to the Access Keys modal that generates a secure random alphanumeric API key and auto-fills the input field. This feature simplifies the process of creating new access keys by eliminating the need for users to manually create or copy secure keys from external sources.

## Goals

- Provide a one-click solution to generate secure random access keys
- Reduce friction when adding new access keys to the proxy
- Ensure generated keys are cryptographically secure
- Maintain consistency with existing UI patterns

## User Stories

### US-001: Add Generate Button to Access Key Modal
**Description:** As a user, I want to see a "Generate" button next to the API key input field when adding an Access Key, so I can quickly create a secure random key.

**Acceptance Criteria:**
- [ ] "Generate" button appears next to the API Key input field in the Add Access Key modal
- [ ] Button has an appropriate icon (e.g., refresh/dice icon)
- [ ] Button is styled consistently with existing UI components
- [ ] Button only appears for Access Keys (not Gemini, Claude, Codex)
- [ ] Typecheck/lint passes

### US-002: Generate Random Alphanumeric Key
**Description:** As a user, I want clicking the Generate button to create a random 32-character alphanumeric key and populate the input field.

**Acceptance Criteria:**
- [ ] Clicking Generate creates a 32-character alphanumeric string (a-z, A-Z, 0-9)
- [ ] Generated key uses cryptographically secure randomness (`crypto.getRandomValues`)
- [ ] Generated key is automatically inserted into the API Key input field
- [ ] Input field gains focus after generation for easy editing if needed
- [ ] Typecheck/lint passes

### US-003: Visual Feedback on Generation
**Description:** As a user, I want visual feedback when a key is generated so I know the action was successful.

**Acceptance Criteria:**
- [ ] Brief visual indication when key is generated (e.g., button animation or input highlight)
- [ ] Generated key is immediately visible in the input field
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: Add a "Generate" button adjacent to the API Key input in the `openAddKeyModal` function when `type === 'access'`
- FR-2: Implement `generateRandomKey()` function that returns a 32-character alphanumeric string using `crypto.getRandomValues()`
- FR-3: On button click, generate key and set it as the input field value
- FR-4: The generate button must only appear for Access Keys modal, not for provider keys (Gemini, Claude, Codex)

## Non-Goals

- No key generation for provider API keys (Gemini, Claude, Codex) - these must come from their respective providers
- No configurable key length in the UI (fixed at 32 characters)
- No key prefix customization
- No server-side key generation

## Technical Considerations

- Use `crypto.getRandomValues()` for secure randomness (available in all modern browsers)
- Modify `openAddKeyModal()` in `static/js/pages/keys.js` to conditionally render the generate button
- Character set: `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`
- Button should be inline with input field using existing CSS patterns

## Design Considerations

- Button placement: Right side of the input field, inside or adjacent to the input wrapper
- Button style: Secondary button style with a refresh/generate icon
- Responsive: Button should work well on mobile layouts

## Success Metrics

- Users can generate a secure access key in 1 click
- No regression in existing key management functionality
- Feature works across all supported browsers

## Open Questions

- None at this time
