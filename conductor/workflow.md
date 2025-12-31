# Workflow: CLI Proxy API

## Development Methodology

### Task Execution
1. Read and understand the task from `plan.md`
2. Implement the changes
3. Verify the implementation works (manual testing or build check)
4. Mark task complete in `plan.md`
5. Commit changes

### Testing Policy
- **Tests are optional** - Skip test creation unless explicitly requested
- Focus on implementation first
- Add tests later when stabilizing features

### Commits
- Commit after each completed task
- Use conventional commit format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `docs`, `chore`

### Task Summaries
- Use Git Notes for task summaries
- Attach notes to commits with `git notes add`

## Phase Completion

At the end of each phase:
1. Verify all phase tasks are marked complete
2. Run `go build ./...` to ensure compilation
3. Manual verification of implemented features
4. Commit any remaining changes

## Quality Gates

### Before Marking Task Complete
- [ ] Code compiles without errors
- [ ] Implementation matches task requirements
- [ ] No regressions in existing functionality

### Before Marking Phase Complete
- [ ] All phase tasks marked done
- [ ] Build succeeds: `go build ./...`
- [ ] Changes committed and pushed

## Blocked Tasks

If a task is blocked:
1. Document the blocker in `plan.md` with `<!-- blocked: reason -->`
2. Move to next available task
3. Return to blocked task when resolved

## File Markers

```markdown
## Phase 1: Setup
- [x] Completed task
- [ ] Pending task
- [~] In progress
- [!] Blocked (see notes)
- [-] Skipped
```
