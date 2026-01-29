# Quota Tab UI/UX Improvement

## Overview

Redesign the Quota page in custom-management.html to provide a more user-friendly, scannable, and visually appealing interface for monitoring provider authentication quota status. The new design follows a "Summary + Detail" approach with improved visual hierarchy, better information organization, and enhanced mobile responsiveness.

## Functional Requirements

### 1. Summary Bar Component
- Display aggregate quota status at the top of the page
- Show counts for each status category:
  - 🔴 Critical (< 30% remaining)
  - 🟡 Warning (30-59% remaining)  
  - 🟢 Healthy (≥ 60% remaining)
- Include total accounts being monitored
- Clickable status badges to quick-filter by that status

### 2. Enhanced Quota Cards
- **Circular progress indicators**: Replace 6px linear progress bars with circular gauge (48-56px diameter) showing the worst quota percentage prominently
- **Color-coded card borders**: Left border (4px) colored based on worst quota status (red/yellow/green)
- **Collapsible quota groups**: 
  - Show only the worst (lowest) quota group by default
  - "Show N more" expandable section for additional quota groups
  - Smooth expand/collapse animation

### 3. Sorting & Filtering
- **Auto-sort by urgency**: Cards sorted by lowest quota first (critical → warning → healthy)
- **Status filter chips**: Add filter buttons for Critical/Warning/Healthy in addition to existing provider filters
- **Combined filtering**: Provider filter + Status filter work together

### 4. View Toggle
- **Compact view**: Shows only card header + circular indicator + worst quota
- **Detailed view**: Shows all quota groups expanded (current behavior improved)
- Toggle button in header to switch views
- Remember user preference in localStorage

### 5. Improved Header Layout
- Two-row header structure:
  - Row 1: Title + Summary bar
  - Row 2: Filters (provider + status) + View toggle + Fetch All button + Last updated
- Better spacing and visual separation

### 6. Mobile Responsive Design
- Summary bar stacks vertically on small screens
- Filter chips wrap gracefully
- Cards display in single column below 768px
- Larger touch targets for buttons (min 44px)
- Circular indicators scale appropriately

## Non-Functional Requirements

- Smooth CSS transitions for expand/collapse (300ms ease)
- Maintain existing color scheme and design language
- No external dependencies (pure CSS/JS)
- Performance: Handle 50+ quota cards without lag
- Accessibility: ARIA labels for interactive elements

## Acceptance Criteria

1. [ ] Summary bar displays correct counts for critical/warning/healthy quotas
2. [ ] Cards show circular progress indicator with percentage
3. [ ] Cards have color-coded left border matching worst quota status
4. [ ] Quota groups are collapsible with "Show N more" toggle
5. [ ] Cards are sorted by lowest quota first by default
6. [ ] Status filter chips (Critical/Warning/Healthy) work correctly
7. [ ] Compact/Detailed view toggle functions and persists preference
8. [ ] Mobile layout is clean and usable at 375px width
9. [ ] All existing functionality (fetch, refresh, pagination) still works
10. [ ] Threshold values: Critical < 30%, Warning < 60%, Healthy ≥ 60%

## Out of Scope

- Backend API changes
- New quota providers
- Historical quota tracking/charts
- Quota alerts/notifications
- User-configurable thresholds (future enhancement)
