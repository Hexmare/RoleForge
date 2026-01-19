# Rounds Implementation - Git Workflow & Version Control

**Purpose**: Track implementation progress across branches and sprints  
**Repo State**: Already on `rounds-implementation` branch (from `git checkout -b rounds-implementation`)

---

## Branch Strategy

### Main Branches

```
main (production)
  ↓
develop (integration)
  ↓
rounds-implementation (feature branch - START HERE)
  ├─ rounds-phase-1-database (task branch)
  ├─ rounds-phase-2-messageservice (task branch)
  ├─ rounds-phase-3-sceneservice (task branch)
  ├─ rounds-phase-4-orchestrator (task branch)
  ├─ rounds-phase-5-server (task branch)
  ├─ rounds-phase-6-frontend (task branch)
  ├─ rounds-phase-7-testing (task branch)
  └─ rounds-phase-8-documentation (task branch)
```

### Branch Naming Convention

```
rounds-phase-X-<phase-name>
  ├─ Issue number: Issue 1.1, 1.2, etc.
  ├─ Task name: database, messageservice, etc.
  └─ Commit: git checkout -b rounds-phase-1-database
```

---

## Current Status

You already created:
```bash
git checkout -b documentationRevision
git checkout -b vectorstorage
```

Now create implementation branches:
```bash
git checkout -b rounds-implementation
```

---

## Phase 1 Workflow (Example)

### Setup
```bash
# Start from develop
git checkout develop
git pull origin develop

# Create Phase 1 branch
git checkout -b rounds-phase-1-database

# Create sub-branches for tasks (optional, if team wants parallelization)
git checkout -b rounds-phase-1-task-migration

# Work on Issue 1.1
# (edit files, test, commit)

git add backend/migrations/005_add_round_tracking.sql
git commit -m "Issue 1.1: Create migration file - Add round tracking to Messages table"
```

### Commit Message Format

```
Issue <#.#>: <Task Name> - <Description>

Acceptance Criteria Met:
- [x] Criterion 1
- [x] Criterion 2
- [x] Criterion 3

Testing:
- [x] Migration runs without errors
- [x] Schema validation passes
- [x] No side effects on existing data

Relates to: ROUNDS_IMPLEMENTATION_PLAN.md Issue <#.#>
```

### Example Commits

```bash
git commit -m "Issue 1.1: Create migration file - Add round tracking

Acceptance Criteria Met:
- [x] Adds roundNumber column to Messages table
- [x] Creates SceneRounds metadata table
- [x] Creates index on (sceneId, roundNumber)
- [x] Adds currentRoundNumber to Scenes table
- [x] Migration is idempotent

Relates to: ROUNDS_IMPLEMENTATION_PLAN.md#task-11"

git commit -m "Issue 1.2: Update database.ts - Run migrations on startup

- Updates migration runner to execute 005_add_round_tracking.sql
- Adds schema validation
- Logs successful migration completion
- Tests confirm idempotency

Tests: npm run test -- src/__tests__/database.test.ts"

git commit -m "Issue 2.1: MessageService.create() - Add roundNumber parameter

- Updates method signature to include roundNumber: number parameter
- Passes roundNumber to INSERT statement
- Updates all callers in codebase
- Backward compatible with default value

Breaking: No breaking changes
Tests: npm run test -- src/__tests__/MessageService.test.ts"
```

---

## Pull Request Workflow

### For Each Issue/Task

1. **Create branch** (from phase branch)
   ```bash
   git checkout -b rounds-issue-<#>-<name>
   ```

2. **Work on implementation**
   ```bash
   # Make changes
   npm run test
   npm run build
   # Commit multiple times as needed
   ```

3. **Push to remote**
   ```bash
   git push origin rounds-issue-<#>-<name>
   ```

4. **Create PR with template** (see below)

5. **Request review**
   - Link to GitHub issue
   - Reference acceptance criteria

6. **Merge to phase branch**
   ```bash
   git checkout rounds-phase-<#>-<name>
   git merge --no-ff rounds-issue-<#>-<name>
   git push origin rounds-phase-<#>-<name>
   ```

### PR Template

```markdown
## Issue
Closes #<GitHub-Issue-Number>

## Description
Link to task: [Issue X.X](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-xx)

Brief description of what this PR implements.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Testing
- [ ] Unit tests pass: `npm run test`
- [ ] Build passes: `npm run build`
- [ ] Manual testing completed
- [ ] Edge cases tested

## Related
- Relates to: ROUNDS_IMPLEMENTATION_PLAN.md
- Phase: X
- Effort: Xh
```

---

## Phase Completion Workflow

### After Each Phase Completes

```bash
# 1. Ensure all phase branch work is merged
git checkout rounds-phase-<#>-<name>
git pull origin rounds-phase-<#>-<name>

# 2. Create PR to rounds-implementation branch
# (Use PR template above)

# 3. After approval, merge
git checkout rounds-implementation
git merge --no-ff rounds-phase-<#>-<name>

# 4. Tag phase completion
git tag -a rounds-phase-<#>-complete -m "Phase <#> implementation complete"
git push origin rounds-phase-<#>-complete

# 5. Update IMPLEMENTATION_STATUS.md
# (Mark phase as complete)

# 6. Push to main branch
git push origin rounds-implementation
```

---

## Full Feature Completion Workflow

### After All 8 Phases Complete

```bash
# 1. Ensure rounds-implementation is up to date
git checkout rounds-implementation
git pull origin rounds-implementation

# 2. Verify all tests pass
npm run test
npm run build

# 3. Create final PR to develop
git checkout develop
git pull origin develop
git checkout -b rounds-feature-merge

# 4. Merge rounds-implementation
git merge --no-ff rounds-implementation

# 5. Create PR with full summary
# - Link to all phase PRs
# - Summary of deliverables
# - Performance metrics
# - Testing summary

# 6. After approval, merge to develop
git push origin rounds-feature-merge
# (Create PR and merge)

# 7. Tag feature release
git tag -a rounds-v1.0 -m "Rounds system v1.0 - Ready for VectorStorage"
git push origin rounds-v1.0

# 8. Create PR from develop to main (for release management)
```

---

## Commit Guidelines

### Format
```
<Type>(<Scope>): <Subject>

<Body>

<Footer>
```

### Type
- **feat**: New feature
- **fix**: Bug fix
- **refactor**: Code refactoring
- **test**: Adding/updating tests
- **docs**: Documentation changes
- **chore**: Build, dependencies, etc.

### Scope
- `rounds`: Core rounds feature
- `database`: Schema/migration changes
- `services`: Service layer changes
- `agents`: Agent implementation
- `server`: API/Socket.io changes
- `frontend`: UI/component changes
- `test`: Test additions

### Subject
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- No period at end
- Limit to 50 characters

### Body
- Explain what and why, not how
- Wrap at 72 characters
- Reference GitHub issues: `Issue #123`
- Reference plan sections: `ROUNDS_IMPLEMENTATION_PLAN.md#task-21`

### Footer
- Reference issues: `Closes #123`
- Note breaking changes: `BREAKING CHANGE: description`

### Examples

```
feat(database): create rounds migration - Issue 1.1

Add 005_add_round_tracking.sql migration to:
- Add roundNumber column to Messages table
- Create SceneRounds metadata table
- Add currentRoundNumber to Scenes table
- Create indexes for query performance

The migration is idempotent and safe to run multiple times.

Closes #123
Relates to: ROUNDS_IMPLEMENTATION_PLAN.md#task-11

---

feat(services): add getRoundMessages to MessageService - Issue 2.2

Retrieve all messages for a specific round in a scene.

Returns messages ordered by messageNumber to maintain
conversation flow. Uses index on (sceneId, roundNumber)
for optimal query performance.

Test: npm run test -- MessageService.test.ts
Performance: ~50ms for typical scene

Closes #124

---

refactor(orchestrator): extract round completion logic - Issue 4.2

Move round completion handling to separate method:
- Creates SceneRounds entry
- Emits Socket.io event
- Triggers VectorizationAgent (non-blocking)
- Resets for next round

Maintains all existing behavior, improves testability.

Test: npm run test -- orchestrator.test.ts

---

test(rounds): add integration tests for round workflow - Issue 7.2

Add comprehensive integration tests:
- User message → character responses → round completion
- Multiple rounds in single scene
- Round continuation without user input
- VectorizationAgent triggering

Coverage: ~95% for round-related code

npm run test -- rounds-integration.test.ts
```

---

## Local Development Workflow (Daily)

### Morning (Start of work)
```bash
# Update main feature branch
git checkout rounds-implementation
git pull origin rounds-implementation

# Check current phase status
git branch -a | grep rounds-phase
```

### Working on Task (Issue 2.1)
```bash
# Create task branch
git checkout -b rounds-issue-21-messageservice-roundnumber

# Make changes
# ... edit files ...

# Test locally
npm run test
npm run build

# Commit work
git add backend/src/services/MessageService.ts
git commit -m "feat(services): add roundNumber parameter to MessageService.create() - Issue 2.1

Update create() method signature to accept roundNumber parameter.
Persist roundNumber to Messages table for round tracking.

Acceptance criteria met:
- Method accepts roundNumber parameter
- Roundumber persists to database
- Default behavior maintained

Test: npm run test -- MessageService.test.ts"

# Push periodically
git push origin rounds-issue-21-messageservice-roundnumber
```

### End of Day
```bash
# Ensure work is pushed
git push origin rounds-issue-21-messageservice-roundnumber

# Update GitHub issue with progress comment
# Link to commit with git commit hash
```

### When Task Complete
```bash
# Final test run
npm run test
npm run build

# Create PR on GitHub
# Reference issue: Closes #21
# Link to ROUNDS_IMPLEMENTATION_PLAN.md

# Request review
# Assign to code reviewer
```

### When Phase Complete
```bash
# Merge all phase PRs to phase branch
git checkout rounds-phase-2-messageservice
git merge --no-ff rounds-issue-21-messageservice-roundnumber
git merge --no-ff rounds-issue-22-getroundmessages
git merge --no-ff rounds-issue-23-getlatestround
git merge --no-ff rounds-issue-24-getcurrentroundmessages
git merge --no-ff rounds-issue-25-utility-methods

# Create phase completion PR
git push origin rounds-phase-2-messageservice
# (Create PR to rounds-implementation)

# After approval, merge
```

---

## Stashing & Context Switching

### If you need to switch tasks mid-work
```bash
# Stash current work
git stash save "WIP: Issue 2.1 - halfway through MessageService update"

# Switch to new task
git checkout -b rounds-issue-22-getroundmessages

# Do other work...

# Return to previous task
git checkout rounds-issue-21-messageservice-roundnumber
git stash pop
```

---

## Debugging & Inspection

### View commits for specific phase
```bash
git log --oneline rounds-phase-2-messageservice ^main
```

### See what changed in this branch vs develop
```bash
git diff develop..rounds-implementation
```

### Find which commit broke something
```bash
git bisect start
git bisect bad rounds-implementation
git bisect good develop
# (follow prompts to narrow down)
```

### View full commit message and changes
```bash
git show <commit-hash>
```

---

## Conflicts & Problem Resolution

### If you get merge conflicts
```bash
# During merge
git status  # See conflicted files

# Edit conflicted files
# (Manually resolve <<<<<<<, =======, >>>>>>>)

# Continue merge
git add .
git commit -m "Resolve merge conflicts between Phase 2 and Phase 3"
```

### If you accidentally committed to wrong branch
```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Switch to correct branch
git checkout correct-branch

# Commit again
git commit -m "proper message"
```

### If you need to revert a merged PR
```bash
# Find the merge commit
git log --oneline | grep "Merge pull request"

# Revert it
git revert -m 1 <merge-commit-hash>
```

---

## Code Review Checklist

**Before requesting review**:
- [ ] All tests pass locally: `npm run test`
- [ ] Code builds: `npm run build`
- [ ] Commits follow convention
- [ ] Acceptance criteria documented
- [ ] Related tasks linked

**For reviewers**:
- [ ] All acceptance criteria met
- [ ] Tests cover new code
- [ ] No obvious bugs or issues
- [ ] Code follows project style
- [ ] Performance acceptable
- [ ] Error handling present

---

## Deployment Checklist (After Phase 8)

```bash
# 1. Final test suite
npm run test
npm run build

# 2. Verify migrations
npm run migrate

# 3. Check database
npm run db:validate

# 4. Run performance suite
npm run test:performance

# 5. Create release tag
git tag -a rounds-production -m "Rounds system ready for production"

# 6. Document deployment
echo "Deployment: Rounds system $(date)" >> DEPLOYMENT_LOG.md

# 7. Notify team
# (Message: Rounds implementation complete, ready for VectorStorage phase)
```

---

## Repository Status

### Current Branches
```
main                              (production - no Rounds)
develop                           (integration - Rounds will merge here)
documentationRevision             (planning docs - already created)
vectorstorage                     (VectorStorage plan - already created)
rounds-implementation             (main feature branch - create now)
└─ rounds-phase-1-database       (create for Phase 1)
└─ rounds-phase-2-messageservice (create for Phase 2)
└─ ... (etc for Phases 3-8)
```

### Creating Main Feature Branch

```bash
# Ensure you're on develop
git checkout develop
git pull origin develop

# Create feature branch from develop
git checkout -b rounds-implementation

# Push to remote
git push -u origin rounds-implementation

# Confirm setup
git branch -a
```

---

## Key Git Commands Reference

```bash
# Status
git status                                    # Current state
git log --oneline -10                         # Last 10 commits
git branch -a                                 # All branches

# Workflow
git checkout -b <new-branch>                  # Create and switch to branch
git add <files>                               # Stage changes
git commit -m "<message>"                     # Commit staged changes
git push origin <branch>                      # Push to remote

# Phase completion
git tag -a <tag-name> -m "<message>"          # Create version tag
git push origin <tag-name>                    # Push tag to remote

# Merging
git merge --no-ff <branch>                    # Merge with merge commit
git rebase <branch>                           # Rebase (linear history)

# Cleanup
git branch -d <branch>                        # Delete local branch
git push origin --delete <branch>             # Delete remote branch

# Emergency
git stash                                     # Save work temporarily
git stash pop                                 # Restore stashed work
git reset --soft HEAD~1                       # Undo last commit (keep changes)
git revert <commit>                           # Create inverse of commit
```

---

## Success Indicators

✅ All commits follow convention  
✅ All branches have clear names  
✅ All PRs link to GitHub issues  
✅ All tests pass before merge  
✅ All phases tagged for reference  
✅ Final feature branch ready to merge to develop  

---

## Next Steps

1. **Create main feature branch**
   ```bash
   git checkout develop
   git checkout -b rounds-implementation
   git push -u origin rounds-implementation
   ```

2. **Create Phase 1 branch**
   ```bash
   git checkout -b rounds-phase-1-database
   ```

3. **Begin Issue 1.1 work**
   ```bash
   git checkout -b rounds-issue-11-migration
   # (Start coding)
   ```

4. **Monitor progress** via GitHub Issues and branch status

---

**Reference**: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md)  
**Status**: 🟢 Ready for development
