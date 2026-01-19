# Rounds Implementation Plan - Detailed Task Breakdown

**Status:** Ready for Implementation  
**Priority:** 🔴 CRITICAL - Prerequisite for VectorStorage  
**Created:** January 14, 2026  
**Estimated Duration:** 2-4 sprints, ~40-60 hours

---

## Overview

This document translates the ROUNDS_Prerequisite_Feature.md specification into actionable tasks organized by phase and work stream. Each task includes acceptance criteria and dependencies.

---

## Phase 1: Database Schema & Migrations (2-3 days, ~12 hours)

### Task 1.1: Create Migration File
**File**: `backend/migrations/005_add_round_tracking.sql`

**Description**: Create single migration file containing all schema changes

**Acceptance Criteria**:
- ✓ Adds `roundNumber INTEGER DEFAULT 1 NOT NULL` to Messages table
- ✓ Creates index `idx_messages_scene_round` on (sceneId, roundNumber)
- ✓ Creates new SceneRounds table with all required columns
- ✓ Adds `currentRoundNumber INTEGER DEFAULT 1` to Scenes table
- ✓ File can be executed without errors on existing database

**Dependencies**: None

**Effort**: ~1 hour

---

### Task 1.2: Update backend/src/database.ts
**File**: `backend/src/database.ts`

**Description**: Ensure migration runs on startup; validate schema

**Changes Required**:
- Ensure `005_add_round_tracking.sql` is run in sequence
- Add schema validation to confirm new columns exist
- Log successful schema update

**Acceptance Criteria**:
- ✓ Migration runs automatically on server startup
- ✓ No errors thrown if columns already exist (idempotent)
- ✓ All new tables/columns verified after migration
- ✓ Schema matches ROUNDS_Prerequisite_Feature.md specification

**Dependencies**: Task 1.1

**Effort**: ~1 hour

---

### Task 1.3: Create Test Database Fixtures
**File**: `backend/src/__tests__/fixtures/rounds-db.ts`

**Description**: Helper for test setup/teardown with rounds data

**Acceptance Criteria**:
- ✓ Helper creates scene with pre-populated messages across multiple rounds
- ✓ Helper creates SceneRounds metadata entries
- ✓ Cleanly tears down test data
- ✓ Can create arbitrary number of rounds with specified characters

**Dependencies**: Task 1.1, 1.2

**Effort**: ~2 hours

---

## Phase 2: Backend Services - MessageService (3 days, ~14 hours)

### Task 2.1: Update MessageService.create()
**File**: `backend/src/services/MessageService.ts`

**Description**: Add roundNumber parameter to message creation

**Changes Required**:
- Add `roundNumber: number` parameter to create() method signature
- Pass roundNumber to INSERT statement
- Update existing calls in codebase to pass roundNumber

**Current Signature**:
```typescript
create(sceneId: number, message: string, sender: string, metadata?: any)
```

**New Signature**:
```typescript
create(sceneId: number, message: string, sender: string, roundNumber: number, metadata?: any)
```

**Acceptance Criteria**:
- ✓ create() method accepts roundNumber parameter
- ✓ roundNumber persists to database
- ✓ Default behavior: first message in new scene = round 1
- ✓ No existing functionality breaks

**Testing**:
```typescript
test('create() stores message with roundNumber', () => {
  const msg = MessageService.create(sceneId, 'test', 'User', 2);
  const retrieved = MessageService.getById(msg.id);
  expect(retrieved.roundNumber).toBe(2);
});
```

**Dependencies**: Task 1.1, 1.2

**Effort**: ~3 hours

---

### Task 2.2: Implement getRoundMessages()
**File**: `backend/src/services/MessageService.ts`

**Description**: Retrieve all messages for a specific round

**Implementation**:
```typescript
getRoundMessages(sceneId: number, roundNumber: number): MessageRow[] {
  return db.prepare(
    'SELECT * FROM Messages WHERE sceneId = ? AND roundNumber = ? ORDER BY messageNumber ASC'
  ).all(sceneId, roundNumber) as MessageRow[];
}
```

**Acceptance Criteria**:
- ✓ Returns messages in correct order (by messageNumber)
- ✓ Returns empty array if round doesn't exist
- ✓ Query uses index for performance
- ✓ Filtered correctly by both sceneId and roundNumber

**Testing**:
```typescript
test('getRoundMessages returns messages in correct order', () => {
  // Add 3 messages to round 1
  const msgs = MessageService.getRoundMessages(sceneId, 1);
  expect(msgs.length).toBe(3);
  expect(msgs[0].messageNumber).toBe(1);
  expect(msgs[2].messageNumber).toBe(3);
});

test('getRoundMessages filters by roundNumber', () => {
  // Add messages to rounds 1 and 2
  const round1 = MessageService.getRoundMessages(sceneId, 1);
  const round2 = MessageService.getRoundMessages(sceneId, 2);
  expect(round1.length).toBe(3);
  expect(round2.length).toBe(2);
});
```

**Dependencies**: Task 2.1

**Effort**: ~2 hours

---

### Task 2.3: Implement getLatestRound()
**File**: `backend/src/services/MessageService.ts`

**Description**: Get highest round number for a scene

**Implementation**:
```typescript
getLatestRound(sceneId: number): number {
  const result = db.prepare(
    'SELECT MAX(roundNumber) as maxRound FROM Messages WHERE sceneId = ?'
  ).get(sceneId) as any;
  return result?.maxRound || 1;
}
```

**Acceptance Criteria**:
- ✓ Returns correct max round number
- ✓ Returns 1 if no messages exist
- ✓ Returns 1 if sceneId doesn't exist

**Testing**:
```typescript
test('getLatestRound returns max roundNumber', () => {
  MessageService.create(sceneId, 'msg1', 'User', 1);
  MessageService.create(sceneId, 'msg2', 'User', 3);
  MessageService.create(sceneId, 'msg3', 'User', 2);
  expect(MessageService.getLatestRound(sceneId)).toBe(3);
});

test('getLatestRound returns 1 for empty scene', () => {
  expect(MessageService.getLatestRound(newSceneId)).toBe(1);
});
```

**Dependencies**: Task 2.1

**Effort**: ~1 hour

---

### Task 2.4: Implement getCurrentRoundMessages()
**File**: `backend/src/services/MessageService.ts`

**Description**: Get messages from the currently active round

**Implementation**:
```typescript
getCurrentRoundMessages(sceneId: number): MessageRow[] {
  const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
    .get(sceneId) as any;
  if (!scene) return [];
  return this.getRoundMessages(sceneId, scene.currentRoundNumber);
}
```

**Acceptance Criteria**:
- ✓ Returns messages only from current round
- ✓ Returns empty array if scene doesn't exist
- ✓ Uses currentRoundNumber from Scenes table

**Testing**:
```typescript
test('getCurrentRoundMessages returns only current round messages', () => {
  // Add messages to rounds 1 and 2
  // Set currentRoundNumber to 2
  const msgs = MessageService.getCurrentRoundMessages(sceneId);
  expect(msgs).toEqual(roundMessages2);
});
```

**Dependencies**: Task 2.2

**Effort**: ~1 hour

---

### Task 2.5: Add Utility Methods
**File**: `backend/src/services/MessageService.ts`

**Description**: Add helper methods for common queries

**Methods**:
```typescript
// Get last message overall
getLastMessage(sceneId: number): MessageRow | null

// Get last message in specific round
getLastMessageInRound(sceneId: number, roundNumber: number): MessageRow | null

// Get message count for round
getMessageCountInRound(sceneId: number, roundNumber: number): number
```

**Acceptance Criteria**:
- ✓ All three methods implemented
- ✓ Return correct values
- ✓ Handle edge cases (empty round, etc.)

**Dependencies**: Task 2.2, 2.3

**Effort**: ~2 hours

---

## Phase 3: Backend Services - SceneService (3 days, ~14 hours)

### Task 3.1: Update SceneService Schema Loading
**File**: `backend/src/services/SceneService.ts`

**Description**: Ensure currentRoundNumber is loaded/initialized

**Changes Required**:
- Update `getById()` to include currentRoundNumber
- Update `getAll()` to include currentRoundNumber
- Initialize currentRoundNumber to 1 on new scene creation

**Acceptance Criteria**:
- ✓ currentRoundNumber returned in getById()
- ✓ currentRoundNumber initialized to 1 for new scenes
- ✓ No null/undefined values

**Dependencies**: Task 1.1, 1.2

**Effort**: ~1 hour

---

### Task 3.2: Implement initializeRound()
**File**: `backend/src/services/SceneService.ts`

**Description**: Start a new round in a scene

**Implementation**:
```typescript
initializeRound(sceneId: number): number {
  const latest = MessageService.getLatestRound(sceneId);
  const newRound = latest + 1;
  
  db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?')
    .run(newRound, sceneId);
  
  return newRound;
}
```

**Acceptance Criteria**:
- ✓ Updates Scenes.currentRoundNumber to next value
- ✓ Returns new round number
- ✓ Properly increments from latest message round

**Testing**:
```typescript
test('initializeRound increments round correctly', () => {
  MessageService.create(sceneId, 'msg', 'User', 2);
  const newRound = SceneService.initializeRound(sceneId);
  expect(newRound).toBe(3);
  expect(db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
    .get(sceneId).currentRoundNumber).toBe(3);
});
```

**Dependencies**: Task 2.3

**Effort**: ~2 hours

---

### Task 3.3: Implement completeRound()
**File**: `backend/src/services/SceneService.ts`

**Description**: Mark a round as complete and create metadata entry

**Implementation**:
```typescript
completeRound(sceneId: number, activeCharacters: string[]): void {
  const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
    .get(sceneId) as any;
  if (!scene) throw new Error(`Scene ${sceneId} not found`);
  
  db.prepare(`
    INSERT INTO SceneRounds (
      sceneId, roundNumber, status, activeCharacters, roundCompletedAt
    ) VALUES (?, ?, 'completed', ?, CURRENT_TIMESTAMP)
  `).run(sceneId, scene.currentRoundNumber, JSON.stringify(activeCharacters));
}
```

**Acceptance Criteria**:
- ✓ Creates SceneRounds entry with correct data
- ✓ Sets status to 'completed'
- ✓ Stores activeCharacters as JSON
- ✓ Sets roundCompletedAt timestamp
- ✓ Throws error if scene not found

**Testing**:
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

**Dependencies**: Task 3.1

**Effort**: ~2 hours

---

### Task 3.4: Implement getRoundData()
**File**: `backend/src/services/SceneService.ts`

**Description**: Retrieve round metadata

**Implementation**:
```typescript
getRoundData(sceneId: number, roundNumber: number): SceneRoundsRow | null {
  return db.prepare(
    'SELECT * FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
  ).get(sceneId, roundNumber) as SceneRoundsRow | null;
}
```

**Acceptance Criteria**:
- ✓ Returns SceneRounds row for valid round
- ✓ Returns null if round doesn't exist
- ✓ Includes all metadata (status, activeCharacters, timestamps, vectorized)

**Dependencies**: Task 3.3

**Effort**: ~1 hour

---

### Task 3.5: Implement markRoundVectorized()
**File**: `backend/src/services/SceneService.ts`

**Description**: Mark a round as processed by VectorizationAgent

**Implementation**:
```typescript
markRoundVectorized(sceneId: number, roundNumber: number): void {
  db.prepare(`
    UPDATE SceneRounds 
    SET vectorized = 1, vectorizedAt = CURRENT_TIMESTAMP 
    WHERE sceneId = ? AND roundNumber = ?
  `).run(sceneId, roundNumber);
}
```

**Acceptance Criteria**:
- ✓ Sets vectorized = 1
- ✓ Sets vectorizedAt to current timestamp
- ✓ Only updates if round exists

**Dependencies**: Task 3.3

**Effort**: ~1 hour

---

### Task 3.6: Implement getUnvectorizedRounds()
**File**: `backend/src/services/SceneService.ts`

**Description**: Get all completed but not-yet-vectorized rounds (for VectorizationAgent queue)

**Implementation**:
```typescript
getUnvectorizedRounds(sceneId: number): SceneRoundsRow[] {
  return db.prepare(`
    SELECT * FROM SceneRounds 
    WHERE sceneId = ? AND status = 'completed' AND vectorized = 0
    ORDER BY roundNumber ASC
  `).all(sceneId) as SceneRoundsRow[];
}
```

**Acceptance Criteria**:
- ✓ Returns only completed rounds
- ✓ Filters out already-vectorized rounds
- ✓ Returns in chronological order

**Dependencies**: Task 3.3, 3.5

**Effort**: ~1 hour

---

## Phase 4: Orchestrator Integration (3-4 days, ~15 hours)

### Task 4.1: Add Round Tracking to Orchestrator
**File**: `backend/src/agents/Orchestrator.ts`

**Description**: Initialize and maintain current round state

**Changes Required**:
```typescript
export class Orchestrator {
  private currentRoundNumber: number = 1;
  private roundActiveCharacters: string[] = [];
  
  // Constructor or initialization
  async initialize(sceneId: number): Promise<void> {
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    this.currentRoundNumber = scene?.currentRoundNumber || 1;
    this.roundActiveCharacters = [];
  }
  
  // Getter for current round
  getCurrentRound(): number {
    return this.currentRoundNumber;
  }
  
  // Track character participation
  addActiveCharacter(characterId: string): void {
    if (!this.roundActiveCharacters.includes(characterId)) {
      this.roundActiveCharacters.push(characterId);
    }
  }
}
```

**Acceptance Criteria**:
- ✓ currentRoundNumber initialized from database
- ✓ activeCharacters tracked during session
- ✓ Can retrieve current state via getters

**Dependencies**: Task 3.1

**Effort**: ~2 hours

---

### Task 4.2: Implement completeRound() in Orchestrator
**File**: `backend/src/agents/Orchestrator.ts`

**Description**: Handle round completion workflow

**Implementation**:
```typescript
async completeRound(sceneId: number): Promise<void> {
  // 1. Persist round to database
  await SceneService.completeRound(sceneId, this.roundActiveCharacters);
  
  // 2. Emit Socket.io event
  this.emitEvent('roundCompleted', {
    sceneId,
    roundNumber: this.currentRoundNumber,
    activeCharacters: this.roundActiveCharacters
  });
  
  // 3. Trigger VectorizationAgent if available (non-blocking)
  if (this.agents.has('vectorization')) {
    const vectorizationAgent = this.agents.get('vectorization')!;
    const roundMessages = MessageService.getRoundMessages(
      sceneId, 
      this.currentRoundNumber
    );
    
    const context: AgentContext = {
      sceneId,
      roundNumber: this.currentRoundNumber,
      messages: roundMessages,
      activeCharacters: this.roundActiveCharacters,
      // ... other context
    };
    
    // Fire and forget (don't await)
    vectorizationAgent.run(context).catch(err => {
      console.warn('VectorizationAgent failed for round:', err);
    });
  }
  
  // 4. Increment round for next cycle
  this.currentRoundNumber++;
  this.roundActiveCharacters = [];
}
```

**Acceptance Criteria**:
- ✓ Calls SceneService.completeRound()
- ✓ Emits roundCompleted event
- ✓ Triggers VectorizationAgent (non-blocking)
- ✓ Resets for next round
- ✓ Error handling (VectorizationAgent failures don't crash)

**Testing**:
```typescript
test('completeRound calls SceneService.completeRound', async () => {
  const mock = vi.spyOn(SceneService, 'completeRound');
  await orchestrator.completeRound(sceneId);
  expect(mock).toHaveBeenCalledWith(sceneId, expect.any(Array));
});

test('completeRound triggers VectorizationAgent', async () => {
  const mockAgent = { run: vi.fn().mockResolvedValue(undefined) };
  orchestrator.agents.set('vectorization', mockAgent);
  
  await orchestrator.completeRound(sceneId);
  
  expect(mockAgent.run).toHaveBeenCalled();
});
```

**Dependencies**: Task 4.1, Task 3.3

**Effort**: ~3 hours

---

### Task 4.3: Implement continueRound() in Orchestrator
**File**: `backend/src/agents/Orchestrator.ts`

**Description**: Generate character responses without user input

**Implementation**:
```typescript
async continueRound(sceneId: number): Promise<void> {
  // Get last message as context
  const lastMessage = MessageService.getLastMessage(sceneId);
  if (!lastMessage) {
    throw new Error('No previous messages to continue from');
  }
  
  // Build context from last message
  const context = await this.buildSessionContext(sceneId);
  
  // Generate character responses (same as normal flow)
  const responses = await this.generateCharacterResponses(context);
  
  // Add responses with current roundNumber
  for (const response of responses) {
    MessageService.create(
      sceneId,
      response.text,
      response.character,
      this.currentRoundNumber
    );
    this.addActiveCharacter(response.character);
  }
  
  // Complete the round
  await this.completeRound(sceneId);
}
```

**Acceptance Criteria**:
- ✓ Uses last message as context
- ✓ Generates character responses
- ✓ Adds responses with current roundNumber
- ✓ Calls completeRound()
- ✓ Throws error if no previous messages

**Testing**:
```typescript
test('continueRound generates responses without user input', async () => {
  // Setup scene with messages
  const responseBefore = await db.prepare(
    'SELECT COUNT(*) as cnt FROM Messages WHERE sceneId = ?'
  ).get(sceneId);
  
  await orchestrator.continueRound(sceneId);
  
  const responseAfter = await db.prepare(
    'SELECT COUNT(*) as cnt FROM Messages WHERE sceneId = ?'
  ).get(sceneId);
  
  expect(responseAfter.cnt).toBeGreaterThan(responseBefore.cnt);
});
```

**Dependencies**: Task 4.2, Task 2.5

**Effort**: ~3 hours

---

### Task 4.4: Track Characters in Session
**File**: `backend/src/agents/Orchestrator.ts`

**Description**: Update Orchestrator to track active characters during message generation

**Changes Required**:
- When CharacterAgent generates response: call `addActiveCharacter(characterName)`
- When Director identifies participants: store in activeCharacters
- Track all characters who participate in current round

**Acceptance Criteria**:
- ✓ All participating characters tracked
- ✓ List passed to SceneService.completeRound()
- ✓ Correct list stored in SceneRounds.activeCharacters

**Dependencies**: Task 4.1

**Effort**: ~2 hours

---

## Phase 5: Server Endpoints & Socket.io (3-4 days, ~15 hours)

### Task 5.1: Update Chat Endpoint
**File**: `backend/src/server.ts`

**Description**: Integrate round tracking into existing chat endpoint

**Endpoint**: `POST /api/scenes/:sceneId/chat`

**Changes Required**:
```typescript
app.post('/api/scenes/:sceneId/chat', async (req, res) => {
  const { sceneId } = req.params;
  const { message: userMessage } = req.body;
  
  try {
    const sceneIdNum = Number(sceneId);
    
    // Get current round
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneIdNum) as any;
    const currentRound = scene?.currentRoundNumber || 1;
    
    // 1. Create user message with roundNumber
    const userMsg = MessageService.create(
      sceneIdNum,
      userMessage,
      'User',
      currentRound,
      { metadata: 'user-input' }
    );
    
    // 2. Generate character responses (same round)
    const context = await orchestrator.buildSessionContext(sceneIdNum, userMessage);
    const responses = await orchestrator.generateCharacterResponses(context);
    
    // 3. Create response messages (same round)
    const responseIds = [];
    for (const response of responses) {
      const msg = MessageService.create(
        sceneIdNum,
        response.text,
        response.character,
        currentRound,
        { agent: response.agent }
      );
      responseIds.push(msg.id);
      orchestrator.addActiveCharacter(response.character);
    }
    
    // 4. Complete the round
    await orchestrator.completeRound(sceneIdNum);
    
    // 5. Return response
    res.json({
      success: true,
      roundNumber: currentRound,
      userMessage: userMsg,
      characterResponses: responses,
      nextRoundNumber: currentRound + 1
    });
    
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Acceptance Criteria**:
- ✓ Tracks roundNumber for all messages
- ✓ All messages in same round use same roundNumber
- ✓ Returns roundNumber in response
- ✓ Calls completeRound() after responses
- ✓ Error handling preserves partial data

**Testing**:
```typescript
test('Chat endpoint stores messages with roundNumber', async () => {
  const res = await request(app)
    .post(`/api/scenes/${sceneId}/chat`)
    .send({ message: 'Hello' });
  
  expect(res.status).toBe(200);
  expect(res.body.roundNumber).toBe(1);
  
  const messages = db.prepare(
    'SELECT DISTINCT roundNumber FROM Messages WHERE sceneId = ?'
  ).all(sceneId);
  expect(messages.length).toBe(1);
  expect(messages[0].roundNumber).toBe(1);
});
```

**Dependencies**: Task 4.1, Task 4.2

**Effort**: ~3 hours

---

### Task 5.2: Create Continue Round Endpoint
**File**: `backend/src/server.ts`

**Description**: New endpoint for manual round continuation

**Endpoint**: `POST /api/scenes/:sceneId/continue-round`

**Implementation**:
```typescript
app.post('/api/scenes/:sceneId/continue-round', async (req, res) => {
  const { sceneId } = req.params;
  
  try {
    const sceneIdNum = Number(sceneId);
    
    // Trigger orchestrator to continue
    await orchestrator.continueRound(sceneIdNum);
    
    // Get updated scene to find new round number
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneIdNum) as any;
    
    res.json({
      success: true,
      newRoundNumber: scene.currentRoundNumber
    });
    
  } catch (error) {
    console.error('Continue round error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Acceptance Criteria**:
- ✓ Calls orchestrator.continueRound()
- ✓ Returns new round number
- ✓ Error handling (no previous messages, etc.)
- ✓ Proper HTTP status codes

**Testing**:
```typescript
test('Continue round endpoint generates new responses', async () => {
  // Setup scene with messages
  
  const res = await request(app)
    .post(`/api/scenes/${sceneId}/continue-round`);
  
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.newRoundNumber).toBeGreaterThan(1);
});

test('Continue round endpoint errors with empty scene', async () => {
  const res = await request(app)
    .post(`/api/scenes/${emptySceneId}/continue-round`);
  
  expect(res.status).toBe(500);
  expect(res.body.error).toBeDefined();
});
```

**Dependencies**: Task 4.3

**Effort**: ~2 hours

---

### Task 5.3: Emit roundCompleted Socket.io Event
**File**: `backend/src/server.ts` (or Socket.io handler)

**Description**: Notify connected clients when round completes

**Event Details**:
```typescript
// Event name: 'roundCompleted'
// Payload:
interface RoundCompletedEvent {
  sceneId: number;
  roundNumber: number;
  messages: MessageRow[];
  activeCharacters: string[];
  autoTriggered?: boolean;  // true if Continue Round was pressed
}
```

**Implementation**:
```typescript
// In Orchestrator.emitEvent() or socket handler
io.to(`scene-${sceneId}`).emit('roundCompleted', {
  sceneId,
  roundNumber,
  messages: MessageService.getRoundMessages(sceneId, roundNumber),
  activeCharacters,
  autoTriggered: false
});
```

**Acceptance Criteria**:
- ✓ Event emitted after round completion
- ✓ Sent to correct scene namespace
- ✓ Includes all necessary data
- ✓ Fired after both `/chat` and `/continue-round` endpoints

**Dependencies**: Task 5.1, Task 5.2, Task 4.2

**Effort**: ~2 hours

---

### Task 5.4: Add Endpoints for Round Queries
**File**: `backend/src/server.ts`

**Description**: Read-only endpoints for retrieving round data

**Endpoints**:
```typescript
// Get all messages for a specific round
GET /api/scenes/:sceneId/rounds/:roundNumber

// Get all rounds for a scene
GET /api/scenes/:sceneId/rounds

// Get round metadata
GET /api/scenes/:sceneId/rounds/:roundNumber/metadata
```

**Implementation**:
```typescript
app.get('/api/scenes/:sceneId/rounds/:roundNumber', (req, res) => {
  const { sceneId, roundNumber } = req.params;
  const messages = MessageService.getRoundMessages(Number(sceneId), Number(roundNumber));
  res.json({ messages });
});

app.get('/api/scenes/:sceneId/rounds', (req, res) => {
  const { sceneId } = req.params;
  const rounds = db.prepare(`
    SELECT DISTINCT roundNumber 
    FROM Messages 
    WHERE sceneId = ? 
    ORDER BY roundNumber DESC
  `).all(sceneId);
  res.json({ rounds });
});

app.get('/api/scenes/:sceneId/rounds/:roundNumber/metadata', (req, res) => {
  const { sceneId, roundNumber } = req.params;
  const metadata = SceneService.getRoundData(Number(sceneId), Number(roundNumber));
  res.json({ metadata });
});
```

**Acceptance Criteria**:
- ✓ All three endpoints return correct data
- ✓ Proper error handling (missing scenes/rounds)
- ✓ Correct HTTP status codes

**Dependencies**: Task 2.2, Task 3.4

**Effort**: ~2 hours

---

## Phase 6: Frontend Implementation (2-3 days, ~12 hours)

### Task 6.1: Add Continue Round Button
**File**: `frontend/src/components/Chat.tsx`

**Description**: UI button to trigger manual round continuation

**Changes Required**:
- Add button next to Send button
- Button disabled during processing
- Distinct visual style from Send button
- Tooltip explaining functionality

**Implementation**:
```tsx
<div className="flex gap-2">
  <input 
    type="text" 
    value={message}
    onChange={(e) => setMessage(e.target.value)}
    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
    placeholder="Your message..."
    disabled={isProcessing}
    className="flex-1 px-3 py-2 bg-slate-700 text-white rounded"
  />
  
  <button
    onClick={sendMessage}
    disabled={isProcessing || !message.trim()}
    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 rounded font-medium"
  >
    Send
  </button>
  
  {/* NEW: Continue Round button */}
  <button
    onClick={continueRound}
    disabled={isProcessing}
    title="Let characters continue without new input"
    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 rounded font-medium"
  >
    Continue
  </button>
</div>
```

**Acceptance Criteria**:
- ✓ Button visible next to Send
- ✓ Disabled during processing
- ✓ Calls continueRound() on click
- ✓ Shows loading state during execution
- ✓ Tooltip explains functionality

**Effort**: ~1 hour

---

### Task 6.2: Implement continueRound() Handler
**File**: `frontend/src/components/Chat.tsx`

**Description**: Client-side handler for Continue Round button

**Implementation**:
```tsx
const continueRound = async () => {
  setIsProcessing(true);
  try {
    const response = await fetch(
      `/api/scenes/${sceneId}/continue-round`,
      { method: 'POST' }
    );
    
    if (!response.ok) {
      const error = await response.json();
      console.error('Continue round failed:', error);
      addSystemMessage(`Error: ${error.error}`);
    }
    // Success response handled by Socket.io event
    
  } catch (error) {
    console.error('Continue round error:', error);
    addSystemMessage('Failed to continue round');
  } finally {
    setIsProcessing(false);
  }
};
```

**Acceptance Criteria**:
- ✓ Makes POST request to continue-round endpoint
- ✓ Sets loading state
- ✓ Error handling with user feedback
- ✓ Properly handles response

**Effort**: ~1 hour

---

### Task 6.3: Listen for roundCompleted Event
**File**: `frontend/src/components/Chat.tsx`

**Description**: Handle Socket.io roundCompleted event

**Implementation**:
```tsx
useEffect(() => {
  if (!socket) return;
  
  const handleRoundCompleted = (data: RoundCompletedEvent) => {
    console.log(`Round ${data.roundNumber} completed`);
    
    // Update UI state
    setCurrentRoundNumber(data.roundNumber + 1);
    
    // Add visual separator
    addSystemMessage(
      `--- Round ${data.roundNumber} Complete ---`,
      { isSystemSeparator: true }
    );
    
    // Optionally show active characters
    if (data.activeCharacters.length > 0) {
      addSystemMessage(
        `Participants: ${data.activeCharacters.join(', ')}`,
        { isSystemInfo: true }
      );
    }
  };
  
  socket.on('roundCompleted', handleRoundCompleted);
  
  return () => {
    socket.off('roundCompleted', handleRoundCompleted);
  };
}, [socket]);
```

**Acceptance Criteria**:
- ✓ Listener attached on mount
- ✓ Displays round boundary
- ✓ Shows active characters
- ✓ Updates round counter
- ✓ Listener removed on unmount

**Effort**: ~2 hours

---

### Task 6.4: Display Round Indicators
**File**: `frontend/src/components/Chat.tsx`

**Description**: Visual markers for round boundaries in message list

**Changes Required**:
- Show round number in message list header
- Visual separator between rounds
- Current round indicator
- Round summary (characters, message count)

**Implementation**:
```tsx
const renderMessageGroup = (roundNumber: number, messages: MessageRow[]) => (
  <div key={`round-${roundNumber}`} className="mb-4">
    {/* Round header */}
    <div className="flex items-center gap-2 py-2 px-4 bg-slate-800 rounded border-l-2 border-purple-500">
      <span className="text-sm font-semibold text-purple-300">
        Round {roundNumber}
      </span>
      <span className="text-xs text-slate-400">
        {messages.length} messages
      </span>
    </div>
    
    {/* Messages */}
    <div className="space-y-2 mt-2">
      {messages.map(msg => (
        <MessageComponent key={msg.id} message={msg} />
      ))}
    </div>
  </div>
);
```

**Acceptance Criteria**:
- ✓ Round numbers displayed
- ✓ Visual separators clear
- ✓ Message counts shown
- ✓ Current round highlighted
- ✓ Responsive layout

**Effort**: ~2 hours

---

### Task 6.5: Add Round Counter
**File**: `frontend/src/components/Chat.tsx`

**Description**: Display current round in header/status area

**Implementation**:
```tsx
<div className="flex justify-between items-center mb-4">
  <h2 className="text-lg font-bold">Scene Chat</h2>
  <div className="text-sm text-slate-400">
    Round <span className="font-semibold text-white">{currentRoundNumber}</span>
  </div>
</div>
```

**Acceptance Criteria**:
- ✓ Current round displayed
- ✓ Updates when round completes
- ✓ Styled consistently with UI
- ✓ Clearly visible

**Effort**: ~30 minutes

---

### Task 6.6: Type Definitions
**File**: `frontend/src/types/rounds.ts`

**Description**: TypeScript interfaces for round-related data

**Content**:
```typescript
export interface RoundCompletedEvent {
  sceneId: number;
  roundNumber: number;
  messages: MessageRow[];
  activeCharacters: string[];
  autoTriggered?: boolean;
}

export interface SceneRoundsMetadata {
  id: number;
  sceneId: number;
  roundNumber: number;
  status: 'in-progress' | 'completed';
  activeCharacters: string[];
  roundStartedAt: string;
  roundCompletedAt: string | null;
  vectorized: boolean;
  vectorizedAt: string | null;
}
```

**Acceptance Criteria**:
- ✓ All types defined
- ✓ Matches backend schema
- ✓ Used in components

**Effort**: ~30 minutes

---

## Phase 7: Integration & Testing (2-3 days, ~12 hours)

### Task 7.1: Create Comprehensive Unit Tests
**File**: `backend/src/__tests__/rounds.test.ts`

**Test Coverage**:
- MessageService round methods (getRoundMessages, getLatestRound, etc.)
- SceneService round lifecycle (initializeRound, completeRound, etc.)
- Round metadata creation and updates

**Acceptance Criteria**:
- ✓ All service methods tested
- ✓ Edge cases covered
- ✓ Tests pass

**Effort**: ~3 hours

---

### Task 7.2: Create Integration Tests
**File**: `backend/src/__tests__/rounds-integration.test.ts`

**Test Coverage**:
- Full round workflow (user message → character responses → round completion)
- Multiple rounds in same scene
- Round continuation
- VectorizationAgent triggering

**Acceptance Criteria**:
- ✓ Workflow integration tested
- ✓ Data persists correctly
- ✓ All services communicate properly

**Effort**: ~3 hours

---

### Task 7.3: Create End-to-End Tests
**File**: `backend/src/__tests__/rounds-e2e.test.ts`

**Test Coverage**:
- Chat endpoint with round tracking
- Continue Round endpoint
- Socket.io event emission
- Frontend integration (if using Playwright)

**Acceptance Criteria**:
- ✓ Full HTTP flow tested
- ✓ Database state verified
- ✓ Socket events confirmed

**Effort**: ~3 hours

---

### Task 7.4: Performance Testing
**File**: `backend/src/__tests__/rounds-performance.test.ts`

**Test Coverage**:
- Query performance with round indexing
- Message retrieval speed
- Round completion time
- Scaling with multiple rounds

**Acceptance Criteria**:
- ✓ getRoundMessages() < 100ms typical
- ✓ completeRound() < 50ms typical
- ✓ No N+1 query problems

**Effort**: ~2 hours

---

### Task 7.5: Frontend Component Tests
**File**: `frontend/src/__tests__/Chat.rounds.test.tsx`

**Test Coverage**:
- Continue Round button rendering
- Handler execution
- Socket.io event handling
- UI updates

**Acceptance Criteria**:
- ✓ Button renders correctly
- ✓ Event handlers called
- ✓ UI updates reflect round state

**Effort**: ~2 hours

---

## Phase 8: Documentation & Polish (1-2 days, ~6 hours)

### Task 8.1: Update Implementation Status
**File**: `DevDocumentation/IMPLEMENTATION_STATUS.md`

**Changes**:
- Mark Rounds as COMPLETE
- Add to Phase 5 supplemental features
- Link to ROUNDS_IMPLEMENTATION_PLAN.md

**Effort**: ~1 hour

---

### Task 8.2: Create Rounds Usage Guide
**File**: `DevDocumentation/ROUNDS_USAGE_GUIDE.md`

**Content**:
- What is a round
- How rounds work in UI
- Backend integration points
- Common queries
- Troubleshooting

**Effort**: ~2 hours

---

### Task 8.3: Update Backend Support
**File**: `backend/BACKEND_SUPPORT.md`

**Changes**:
- Add Rounds section
- Document new endpoints
- Explain round workflow
- Link to implementation

**Effort**: ~1 hour

---

### Task 8.4: Code Review & Polish
**Task**: Conduct peer review, clean up, final testing

**Effort**: ~1-2 hours

---

## Task Dependencies Map

```
Phase 1: Database
  ├─ Task 1.1: Create migration
  │   ├─ Task 1.2: Update database.ts
  │   │   └─ Task 1.3: Test fixtures
  │
Phase 2: MessageService
  ├─ Task 2.1: Add roundNumber parameter
  │   ├─ Task 2.2: getRoundMessages()
  │   │   └─ Task 2.4: getCurrentRoundMessages()
  │   ├─ Task 2.3: getLatestRound()
  │   └─ Task 2.5: Utility methods
  │
Phase 3: SceneService
  ├─ Task 3.1: Schema loading
  │   ├─ Task 3.2: initializeRound()
  │   ├─ Task 3.3: completeRound()
  │   │   ├─ Task 3.4: getRoundData()
  │   │   ├─ Task 3.5: markRoundVectorized()
  │   │   └─ Task 3.6: getUnvectorizedRounds()
  │
Phase 4: Orchestrator
  ├─ Task 4.1: Round tracking
  │   ├─ Task 4.2: completeRound()
  │   │   └─ Task 4.4: Track characters
  │   └─ Task 4.3: continueRound()
  │
Phase 5: Server
  ├─ Task 5.1: Update chat endpoint
  │   └─ Task 5.3: Socket.io event
  ├─ Task 5.2: Continue round endpoint
  │   └─ Task 5.3: Socket.io event
  ├─ Task 5.4: Query endpoints
  │
Phase 6: Frontend
  ├─ Task 6.6: Type definitions
  ├─ Task 6.1: Continue button
  │   ├─ Task 6.2: Handler
  │   └─ Task 6.5: Round counter
  ├─ Task 6.3: Socket listeners
  └─ Task 6.4: Visual indicators
  │
Phase 7: Testing
  ├─ Task 7.1: Unit tests
  ├─ Task 7.2: Integration tests
  ├─ Task 7.3: E2E tests
  ├─ Task 7.4: Performance tests
  └─ Task 7.5: Frontend tests
  │
Phase 8: Documentation
  ├─ Task 8.1: Update status
  ├─ Task 8.2: Usage guide
  └─ Task 8.3: Backend support
```

---

## Summary

| Phase | Duration | Tasks | Effort | Status |
|-------|----------|-------|--------|--------|
| 1: Database | 2-3 days | 3 | 4h | Ready |
| 2: MessageService | 3 days | 5 | 9h | Ready |
| 3: SceneService | 3 days | 6 | 8h | Ready |
| 4: Orchestrator | 3-4 days | 4 | 10h | Ready |
| 5: Server | 3-4 days | 4 | 9h | Ready |
| 6: Frontend | 2-3 days | 6 | 6h | Ready |
| 7: Testing | 2-3 days | 5 | 10h | Ready |
| 8: Documentation | 1-2 days | 4 | 4h | Ready |
| **TOTAL** | **2-4 sprints** | **37 tasks** | **~60h** | **🟢 Ready** |

---

## How to Use This Plan

1. **Create GitHub Issues** - One issue per task with acceptance criteria
2. **Assign to Sprint** - Group tasks by phase into 2-4 weekly sprints
3. **Track Progress** - Mark tasks as in-progress/complete
4. **Review Sections** - Use dependencies map to schedule work
5. **Reference Tests** - Acceptance criteria include test examples
6. **Update Status** - Update IMPLEMENTATION_STATUS.md after each phase

---

## Next Steps

1. ✅ Review this plan
2. ⏳ Create GitHub/Jira issues from task list
3. ⏳ Assign to sprints and team members
4. ⏳ Begin Phase 1: Database migrations
5. ⏳ Execute phases sequentially (dependencies matter)

---

**Status: 🟢 READY FOR DEVELOPMENT**

This detailed plan translates ROUNDS_Prerequisite_Feature.md specification into actionable tasks with clear acceptance criteria, dependencies, and effort estimates. Ready to proceed with implementation.
