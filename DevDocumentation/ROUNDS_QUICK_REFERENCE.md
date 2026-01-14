# Rounds Implementation - Quick Reference

**Document**: Detailed task breakdown for Rounds prerequisite feature  
**Location**: [ROUNDS_IMPLEMENTATION_PLAN.md](ROUNDS_IMPLEMENTATION_PLAN.md)  
**Total Effort**: ~60 hours across 2-4 sprints  
**Priority**: 🔴 CRITICAL - Prerequisite for VectorStorage

---

## At a Glance

| Phase | Tasks | Hours | Duration | Status |
|-------|-------|-------|----------|--------|
| 1️⃣ Database | 3 | 4h | 2-3 days | Ready |
| 2️⃣ MessageService | 5 | 9h | 3 days | Ready |
| 3️⃣ SceneService | 6 | 8h | 3 days | Ready |
| 4️⃣ Orchestrator | 4 | 10h | 3-4 days | Ready |
| 5️⃣ Server Routes | 4 | 9h | 3-4 days | Ready |
| 6️⃣ Frontend | 6 | 6h | 2-3 days | Ready |
| 7️⃣ Testing | 5 | 10h | 2-3 days | Ready |
| 8️⃣ Documentation | 4 | 4h | 1-2 days | Ready |

---

## What Gets Built

### Database Changes
- Add `roundNumber` column to Messages table
- Create new `SceneRounds` metadata table
- Add `currentRoundNumber` to Scenes table
- Create indexes for performance

### Backend Services
- **MessageService**: Query messages by round, get latest round
- **SceneService**: Initialize, complete, and track rounds
- **Orchestrator**: Manage round lifecycle, trigger VectorizationAgent

### Server Endpoints
- `POST /api/scenes/:sceneId/chat` - Updated with round tracking
- `POST /api/scenes/:sceneId/continue-round` - NEW: Manual continuation
- `GET /api/scenes/:sceneId/rounds/:roundNumber` - Get round messages
- `GET /api/scenes/:sceneId/rounds` - List all rounds

### Frontend UI
- "Continue Round" button next to Send button
- Visual round boundaries in chat
- Round counter display
- Socket.io listener for round events

---

## Key Concepts

### What is a Round?
1. User sends message
2. Director identifies characters involved
3. All characters respond
4. World state potentially updates
5. Round completes → VectorizationAgent triggered

### Why Rounds Matter
- **Memory Granularity**: VectorizationAgent captures round-by-round
- **Scope Isolation**: Each round's characters share memories
- **Replay Prevention**: Don't re-process same messages
- **Continuation**: UI button lets scene progress without user input

---

## Implementation Checklist

### Phase 1: Database (Day 1)
- [ ] Create migration `005_add_round_tracking.sql`
- [ ] Add `roundNumber` to Messages table
- [ ] Create `SceneRounds` metadata table
- [ ] Add `currentRoundNumber` to Scenes table
- [ ] Create indexes for query performance
- [ ] Verify schema with database.ts

### Phase 2-3: Services (Days 2-3)
- [ ] Update MessageService.create() with roundNumber
- [ ] Implement getRoundMessages(), getLatestRound()
- [ ] Update SceneService with round lifecycle
- [ ] Implement initializeRound(), completeRound()
- [ ] Implement getRoundData(), markRoundVectorized()

### Phase 4: Orchestrator (Days 3-4)
- [ ] Track currentRoundNumber in Orchestrator
- [ ] Implement completeRound() with VectorizationAgent hook
- [ ] Implement continueRound() for manual continuation
- [ ] Track activeCharacters during message generation

### Phase 5: Server (Days 4-5)
- [ ] Update /api/scenes/:sceneId/chat endpoint
- [ ] Add /api/scenes/:sceneId/continue-round endpoint
- [ ] Emit 'roundCompleted' Socket.io event
- [ ] Add query endpoints for round retrieval

### Phase 6: Frontend (Days 5-6)
- [ ] Add "Continue Round" button
- [ ] Implement handler for button click
- [ ] Add Socket.io listener for roundCompleted
- [ ] Display round boundaries in chat UI
- [ ] Add round counter display

### Phase 7: Testing (Days 6-7)
- [ ] Unit tests for services
- [ ] Integration tests for workflow
- [ ] E2E tests for endpoints
- [ ] Performance tests for queries
- [ ] Frontend component tests

### Phase 8: Documentation (Day 8)
- [ ] Update IMPLEMENTATION_STATUS.md
- [ ] Create ROUNDS_USAGE_GUIDE.md
- [ ] Update backend/BACKEND_SUPPORT.md
- [ ] Code review and polish

---

## Critical Files to Modify

### Create
```
backend/migrations/005_add_round_tracking.sql
backend/src/__tests__/rounds.test.ts
backend/src/__tests__/rounds-integration.test.ts
backend/src/__tests__/rounds-e2e.test.ts
backend/src/__tests__/rounds-performance.test.ts
frontend/src/__tests__/Chat.rounds.test.tsx
DevDocumentation/ROUNDS_USAGE_GUIDE.md
```

### Modify
```
backend/src/database.ts
backend/src/services/MessageService.ts
backend/src/services/SceneService.ts
backend/src/agents/Orchestrator.ts
backend/src/server.ts
frontend/src/components/Chat.tsx
DevDocumentation/IMPLEMENTATION_STATUS.md
backend/BACKEND_SUPPORT.md
```

---

## New Database Schema

### Messages Table (Add Column)
```sql
ALTER TABLE Messages ADD COLUMN roundNumber INTEGER DEFAULT 1 NOT NULL;
CREATE INDEX idx_messages_scene_round ON Messages(sceneId, roundNumber);
```

### SceneRounds Table (New)
```sql
CREATE TABLE SceneRounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
  roundNumber INTEGER NOT NULL,
  status TEXT DEFAULT 'in-progress',      -- 'in-progress' | 'completed'
  activeCharacters JSON NOT NULL,          -- Array of character names
  roundStartedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  roundCompletedAt DATETIME,
  vectorized BOOLEAN DEFAULT 0,
  vectorizedAt DATETIME,
  UNIQUE(sceneId, roundNumber)
);
```

### Scenes Table (Add Column)
```sql
ALTER TABLE Scenes ADD COLUMN currentRoundNumber INTEGER DEFAULT 1;
```

---

## New Service Methods

### MessageService
```
getRoundMessages(sceneId, roundNumber) → MessageRow[]
getLatestRound(sceneId) → number
getCurrentRoundMessages(sceneId) → MessageRow[]
getLastMessage(sceneId) → MessageRow | null
getLastMessageInRound(sceneId, roundNumber) → MessageRow | null
getMessageCountInRound(sceneId, roundNumber) → number
```

### SceneService
```
initializeRound(sceneId) → number (new round number)
completeRound(sceneId, activeCharacters) → void
getRoundData(sceneId, roundNumber) → SceneRoundsRow | null
markRoundVectorized(sceneId, roundNumber) → void
getUnvectorizedRounds(sceneId) → SceneRoundsRow[]
```

### Orchestrator
```
initialize(sceneId) → void
getCurrentRound() → number
addActiveCharacter(characterId) → void
completeRound(sceneId) → Promise<void>
continueRound(sceneId) → Promise<void>
```

---

## New Endpoints

### Chat Endpoint (Updated)
```
POST /api/scenes/:sceneId/chat
Request:  { message: string }
Response: { success: boolean, roundNumber: number, characterResponses: [...] }
```

### Continue Round Endpoint (New)
```
POST /api/scenes/:sceneId/continue-round
Request:  {}
Response: { success: boolean, newRoundNumber: number }
```

### Query Endpoints (New)
```
GET /api/scenes/:sceneId/rounds/:roundNumber
GET /api/scenes/:sceneId/rounds
GET /api/scenes/:sceneId/rounds/:roundNumber/metadata
```

---

## New Socket.io Events

### roundCompleted (Server → Client)
```typescript
{
  sceneId: number;
  roundNumber: number;
  messages: MessageRow[];
  activeCharacters: string[];
  autoTriggered?: boolean;
}
```

---

## Frontend Changes

### Chat Component
```
✅ Add "Continue Round" button
✅ Show round boundaries in message list
✅ Display round number in header
✅ Listen for roundCompleted event
✅ Update UI when round completes
```

### Types
```
RoundCompletedEvent
SceneRoundsMetadata
MessageRow (add roundNumber field)
```

---

## Testing Strategy

### Unit Tests (MessageService, SceneService)
- ✅ Create, retrieve by round
- ✅ Round numbering logic
- ✅ Edge cases (empty rounds, etc.)

### Integration Tests (Services + Orchestrator)
- ✅ Full round workflow
- ✅ Character participation tracking
- ✅ VectorizationAgent triggering

### E2E Tests (Full HTTP flow)
- ✅ /chat endpoint with rounds
- ✅ /continue-round endpoint
- ✅ Socket.io events
- ✅ Database persistence

### Performance Tests
- ✅ Query performance < 100ms
- ✅ No N+1 queries
- ✅ Index effectiveness

---

## Integration with VectorStorage

Once Rounds are complete:

1. VectorizationAgent can be triggered after `completeRound()`
2. Can retrieve round messages with `getRoundMessages()`
3. Can get active characters from `SceneRounds.activeCharacters`
4. Can mark round vectorized with `markRoundVectorized()`

This makes implementing VectorStorage **much simpler** because:
- Clear memory capture boundaries (one round = one memory)
- Easy to batch process vectorization (get all unvectorized rounds)
- Character scoping is explicit (activeCharacters list)
- No ambiguity about when to capture/inject memories

---

## Success Criteria

✅ Messages persist with roundNumber  
✅ Manual "Continue Round" works  
✅ All characters tracked per round  
✅ Round boundaries visible in UI  
✅ VectorizationAgent can be triggered  
✅ Query performance acceptable  
✅ All tests pass  

---

## Time Breakdown

```
Phase 1: Database Schema         4 hours (Day 1)
Phase 2: MessageService          9 hours (Day 2)
Phase 3: SceneService            8 hours (Day 2-3)
Phase 4: Orchestrator           10 hours (Day 3-4)
Phase 5: Server                  9 hours (Day 4-5)
Phase 6: Frontend                6 hours (Day 5)
Phase 7: Testing                10 hours (Day 6)
Phase 8: Documentation           4 hours (Day 7)
────────────────────────────────────────────
TOTAL:                          ~60 hours (2-4 sprints)
```

---

## Getting Started

1. **Read** [ROUNDS_Prerequisite_Feature.md](ROUNDS_Prerequisite_Feature.md) - Understand the "what" and "why"
2. **Read** [ROUNDS_IMPLEMENTATION_PLAN.md](ROUNDS_IMPLEMENTATION_PLAN.md) - Understand the detailed "how"
3. **Create Issues** - One GitHub issue per task with acceptance criteria from the plan
4. **Start Phase 1** - Database migrations first
5. **Proceed Sequentially** - Follow dependency order, complete one phase before starting next

---

## Resources

- Specification: [ROUNDS_Prerequisite_Feature.md](ROUNDS_Prerequisite_Feature.md)
- Detailed Plan: [ROUNDS_IMPLEMENTATION_PLAN.md](ROUNDS_IMPLEMENTATION_PLAN.md)
- Backend Guide: [backend/BACKEND_SUPPORT.md](backend/BACKEND_SUPPORT.md)
- Architecture: [DevDocumentation/IMPLEMENTATION_STATUS.md](DevDocumentation/IMPLEMENTATION_STATUS.md)

---

## Status

🟢 **READY FOR IMPLEMENTATION**

All details documented. All acceptance criteria defined. All dependencies mapped. Ready to begin Phase 1.

