# GitHub Issues - Rounds Implementation Tasks

**Instruction**: Copy each section below to create a GitHub Issue. Use the acceptance criteria as the checklist.

---

## Phase 1: Database Schema & Migrations (2-3 days, ~12 hours)

### Issue 1.1: Create Migration File - Add Round Tracking

```markdown
## Description
Create migration file `005_add_round_tracking.sql` to add round tracking to database schema. This is the foundation for all round functionality.

## Specification
See: [ROUNDS_Prerequisite_Feature.md](DevDocumentation/ROUNDS_Prerequisite_Feature.md#database-schema-changes)

## Acceptance Criteria
- [ ] Adds `roundNumber INTEGER DEFAULT 1 NOT NULL` to Messages table
- [ ] Creates index `idx_messages_scene_round` on (sceneId, roundNumber)
- [ ] Creates new SceneRounds table with columns: id, sceneId, roundNumber, status, activeCharacters, roundStartedAt, roundCompletedAt, vectorized, vectorizedAt
- [ ] Adds `currentRoundNumber INTEGER DEFAULT 1` to Scenes table
- [ ] Migration file is idempotent (can run multiple times without errors)
- [ ] Migration is applied successfully when running `npm run migrate`

## Files to Create
- `backend/migrations/005_add_round_tracking.sql`

## Effort
~1 hour

## Dependencies
None (start here!)
```

---

### Issue 1.2: Update backend/src/database.ts

```markdown
## Description
Update database initialization to ensure migration runs on startup and validates new schema.

## Specification
See: [ROUNDS_PREREQUISITE_Feature.md](DevDocumentation/ROUNDS_Prerequisite_Feature.md#task-12-update-backendsrcdatabasets)

## Acceptance Criteria
- [ ] Migration 005_add_round_tracking.sql is run in correct sequence
- [ ] No errors thrown if columns already exist (idempotent)
- [ ] Schema validation confirms all new columns exist after migration
- [ ] Log message shows successful schema update
- [ ] All new tables/columns present in final schema

## Files to Modify
- `backend/src/database.ts`

## Effort
~1 hour

## Dependencies
- Issue 1.1: Create Migration File
```

---

### Issue 1.3: Create Test Database Fixtures

```markdown
## Description
Create helper utilities for setting up test databases with round-based message data.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-13-create-test-database-fixtures)

## Acceptance Criteria
- [ ] Created `backend/src/__tests__/fixtures/rounds-db.ts`
- [ ] Helper creates scene with pre-populated messages across multiple rounds
- [ ] Helper creates SceneRounds metadata entries
- [ ] Cleanly tears down test data
- [ ] Can create arbitrary number of rounds with specified characters
- [ ] Helper exported and ready for use in other tests

## Files to Create
- `backend/src/__tests__/fixtures/rounds-db.ts`

## Effort
~2 hours

## Dependencies
- Issue 1.1: Create Migration File
- Issue 1.2: Update database.ts
```

---

## Phase 2: Backend Services - MessageService (3 days, ~14 hours)

### Issue 2.1: Update MessageService.create() - Add Round Number

```markdown
## Description
Add roundNumber parameter to MessageService.create() method to persist round information with messages.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-21-update-messageservicecreate)

## Acceptance Criteria
- [ ] Method signature updated: `create(sceneId, message, sender, roundNumber, metadata?)`
- [ ] roundNumber parameter is required (not optional)
- [ ] roundNumber persists to database in Messages table
- [ ] Existing callers in codebase updated to pass roundNumber
- [ ] Default behavior: first message in new scene uses round 1
- [ ] No existing functionality breaks

## Test Examples
```typescript
test('create() stores message with roundNumber', () => {
  const msg = MessageService.create(sceneId, 'test', 'User', 2);
  const retrieved = MessageService.getById(msg.id);
  expect(retrieved.roundNumber).toBe(2);
});
```

## Files to Modify
- `backend/src/services/MessageService.ts`
- Any files calling MessageService.create()

## Effort
~3 hours

## Dependencies
- Issue 1.1: Create Migration File
- Issue 1.2: Update database.ts
```

---

### Issue 2.2: Implement getRoundMessages()

```markdown
## Description
Retrieve all messages for a specific round in a scene.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-22-implement-getroundmessages)

## Acceptance Criteria
- [ ] Method implemented: `getRoundMessages(sceneId, roundNumber): MessageRow[]`
- [ ] Returns messages in order (by messageNumber ASC)
- [ ] Returns empty array if round doesn't exist
- [ ] Query uses index for performance
- [ ] Correctly filtered by both sceneId and roundNumber

## Test Examples
```typescript
test('getRoundMessages returns messages in correct order', () => {
  // Add 3 messages to round 1
  const msgs = MessageService.getRoundMessages(sceneId, 1);
  expect(msgs.length).toBe(3);
  expect(msgs[0].messageNumber).toBeLessThan(msgs[2].messageNumber);
});

test('getRoundMessages filters by roundNumber', () => {
  // Add messages to rounds 1 and 2
  const round1 = MessageService.getRoundMessages(sceneId, 1);
  const round2 = MessageService.getRoundMessages(sceneId, 2);
  expect(round1.length).not.toBe(round2.length);
});
```

## Files to Modify
- `backend/src/services/MessageService.ts`

## Effort
~2 hours

## Dependencies
- Issue 2.1: Update MessageService.create()
```

---

### Issue 2.3: Implement getLatestRound()

```markdown
## Description
Get the highest round number for a scene (used to initialize next round).

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-23-implement-getlatestround)

## Acceptance Criteria
- [ ] Method implemented: `getLatestRound(sceneId): number`
- [ ] Returns correct max round number
- [ ] Returns 1 if no messages exist
- [ ] Returns 1 if sceneId doesn't exist

## Test Examples
```typescript
test('getLatestRound returns max roundNumber', () => {
  MessageService.create(sceneId, 'msg1', 'User', 1);
  MessageService.create(sceneId, 'msg2', 'User', 3);
  expect(MessageService.getLatestRound(sceneId)).toBe(3);
});

test('getLatestRound returns 1 for empty scene', () => {
  expect(MessageService.getLatestRound(newSceneId)).toBe(1);
});
```

## Files to Modify
- `backend/src/services/MessageService.ts`

## Effort
~1 hour

## Dependencies
- Issue 2.1: Update MessageService.create()
```

---

### Issue 2.4: Implement getCurrentRoundMessages()

```markdown
## Description
Get messages from the currently active round of a scene.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-24-implement-getcurrentroundmessages)

## Acceptance Criteria
- [ ] Method implemented: `getCurrentRoundMessages(sceneId): MessageRow[]`
- [ ] Returns messages only from current round
- [ ] Returns empty array if scene doesn't exist
- [ ] Uses currentRoundNumber from Scenes table

## Test Examples
```typescript
test('getCurrentRoundMessages returns only current round messages', () => {
  // Setup: add messages to rounds 1 and 2, set currentRoundNumber to 2
  const msgs = MessageService.getCurrentRoundMessages(sceneId);
  msgs.forEach(m => expect(m.roundNumber).toBe(2));
});
```

## Files to Modify
- `backend/src/services/MessageService.ts`

## Effort
~1 hour

## Dependencies
- Issue 2.2: Implement getRoundMessages()
```

---

### Issue 2.5: Add Utility Methods to MessageService

```markdown
## Description
Add helper methods for common round-related queries.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-25-add-utility-methods)

## Methods to Add
- `getLastMessage(sceneId): MessageRow | null`
- `getLastMessageInRound(sceneId, roundNumber): MessageRow | null`
- `getMessageCountInRound(sceneId, roundNumber): number`

## Acceptance Criteria
- [ ] All three methods implemented
- [ ] Return correct values for various scenarios
- [ ] Handle edge cases (empty round, non-existent scene, etc.)
- [ ] Properly typed with TypeScript

## Files to Modify
- `backend/src/services/MessageService.ts`

## Effort
~2 hours

## Dependencies
- Issue 2.2: Implement getRoundMessages()
- Issue 2.3: Implement getLatestRound()
```

---

## Phase 3: Backend Services - SceneService (3 days, ~14 hours)

### Issue 3.1: Update SceneService Schema Loading

```markdown
## Description
Ensure currentRoundNumber is loaded and initialized properly in SceneService.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-31-update-sceneservice-schema-loading)

## Acceptance Criteria
- [ ] getById() includes currentRoundNumber in returned object
- [ ] getAll() includes currentRoundNumber for all scenes
- [ ] currentRoundNumber initialized to 1 for new scenes
- [ ] No null/undefined values for currentRoundNumber
- [ ] Existing functionality not broken

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~1 hour

## Dependencies
- Issue 1.2: Update database.ts
```

---

### Issue 3.2: Implement initializeRound()

```markdown
## Description
Start a new round in a scene by incrementing the round number.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-32-implement-initializeround)

## Acceptance Criteria
- [ ] Method implemented: `initializeRound(sceneId): number`
- [ ] Updates Scenes.currentRoundNumber to next value
- [ ] Returns new round number
- [ ] Properly increments from latest message round
- [ ] Throws error if scene not found

## Test Examples
```typescript
test('initializeRound increments round correctly', () => {
  MessageService.create(sceneId, 'msg', 'User', 2);
  const newRound = SceneService.initializeRound(sceneId);
  expect(newRound).toBe(3);
});
```

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~2 hours

## Dependencies
- Issue 3.1: Update SceneService Schema Loading
- Issue 2.3: Implement getLatestRound()
```

---

### Issue 3.3: Implement completeRound()

```markdown
## Description
Mark a round as complete and create SceneRounds metadata entry for tracking.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-33-implement-completeround)

## Acceptance Criteria
- [ ] Method implemented: `completeRound(sceneId, activeCharacters): void`
- [ ] Creates SceneRounds entry with correct data
- [ ] Sets status to 'completed'
- [ ] Stores activeCharacters as JSON
- [ ] Sets roundCompletedAt timestamp
- [ ] Throws error if scene not found

## Test Examples
```typescript
test('completeRound creates SceneRounds entry', () => {
  const activeChars = ['Alice', 'Bob'];
  SceneService.completeRound(sceneId, activeChars);
  
  const entry = db.prepare(
    'SELECT * FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
  ).get(sceneId, 1);
  
  expect(entry.status).toBe('completed');
  expect(JSON.parse(entry.activeCharacters)).toEqual(activeChars);
  expect(entry.vectorized).toBe(0);
});
```

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~2 hours

## Dependencies
- Issue 3.1: Update SceneService Schema Loading
```

---

### Issue 3.4: Implement getRoundData()

```markdown
## Description
Retrieve round metadata from SceneRounds table.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-34-implement-getrounddata)

## Acceptance Criteria
- [ ] Method implemented: `getRoundData(sceneId, roundNumber): SceneRoundsRow | null`
- [ ] Returns SceneRounds row for valid round
- [ ] Returns null if round doesn't exist
- [ ] Includes all metadata (status, activeCharacters, timestamps, vectorized)

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~1 hour

## Dependencies
- Issue 3.3: Implement completeRound()
```

---

### Issue 3.5: Implement markRoundVectorized()

```markdown
## Description
Mark a round as processed by VectorizationAgent (for Phase 2 integration).

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-35-implement-markroundvectorized)

## Acceptance Criteria
- [ ] Method implemented: `markRoundVectorized(sceneId, roundNumber): void`
- [ ] Sets vectorized = 1 in SceneRounds table
- [ ] Sets vectorizedAt to current timestamp
- [ ] Only updates if round exists

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~1 hour

## Dependencies
- Issue 3.3: Implement completeRound()
```

---

### Issue 3.6: Implement getUnvectorizedRounds()

```markdown
## Description
Get completed but not-yet-vectorized rounds for VectorizationAgent processing queue.

## Specification
See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md#task-36-implement-getunvectorizedrounds)

## Acceptance Criteria
- [ ] Method implemented: `getUnvectorizedRounds(sceneId): SceneRoundsRow[]`
- [ ] Returns only completed rounds
- [ ] Filters out already-vectorized rounds
- [ ] Returns in chronological order (by roundNumber ASC)

## Files to Modify
- `backend/src/services/SceneService.ts`

## Effort
~1 hour

## Dependencies
- Issue 3.3: Implement completeRound()
- Issue 3.5: Implement markRoundVectorized()
```

---

## Phase 4-8 Issues

[Continue with similar format for remaining phases...]

### To Create Remaining Issues:
- **Phase 4**: Orchestrator Integration (Issues 4.1-4.4)
- **Phase 5**: Server Endpoints (Issues 5.1-5.4)
- **Phase 6**: Frontend (Issues 6.1-6.6)
- **Phase 7**: Testing (Issues 7.1-7.5)
- **Phase 8**: Documentation (Issues 8.1-8.4)

See: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md) for complete details on all remaining issues.

---

## How to Use

1. Copy each issue section above
2. Create a new GitHub Issue
3. Paste the content
4. Add labels: `rounds`, `prerequisite`, `phase-X`
5. Assign to team member
6. Set effort estimate
7. Add to milestone/sprint

---

## Total Issues: 37 tasks
**Total Effort**: ~60 hours
**Duration**: 2-4 sprints

Reference: [ROUNDS_IMPLEMENTATION_PLAN.md](DevDocumentation/ROUNDS_IMPLEMENTATION_PLAN.md)
