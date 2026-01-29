# Workflow: CLI Proxy API

## Development Methodology

This project uses **Context-Driven Development** (Conductor) and **Beads** for issue tracking.

### Task Execution

1.  **Select a Task**: Use `bd ready` to find available work.
2.  **Start Work**: `bd update <id> --status in_progress`
3.  **Implement**: Write code, strictly following the spec in the relevant `conductor/tracks/<track-id>/` files.
4.  **Verify**:
    *   Manual verification.
    *   Run `go build ./...` to ensure compilation.
    *   Run any relevant tests.
5.  **Complete**: `bd close <id>`
6.  **Commit**: `git commit -m "type(scope): description"`

### Testing Policy

*   **Tests are optional**: Skip test creation unless explicitly requested or critical for stability.
*   Focus on implementation first.
*   Add tests later when stabilizing features.

### Commits

*   Commit after each completed task.
*   Use conventional commit format: `type(scope): description`
*   Types: `feat`, `fix`, `refactor`, `docs`, `chore`

### Phase/Track Completion

When a Conductor track is finished:
1.  Verify all Beads tasks for the track are closed.
2.  Run `go build ./...` to ensure compilation.
3.  Commit any remaining changes.
4.  Archive the track using the `conductor-archive` skill.

## Quality Gates

### Before Closing a Task
*   [ ] Code compiles without errors
*   [ ] Implementation matches task requirements
*   [ ] No regressions in existing functionality

### Before Pushing
*   [ ] All intended tasks are closed in Beads
*   [ ] Build succeeds: `go build ./...`
*   [ ] Git status is clean (or stashed)

## Blocked Tasks

If a task is blocked:
1.  Mark it as blocked in Beads: `bd update <id> --status blocked`
2.  Add a comment explaining the blocker.
3.  Move to next available task.
