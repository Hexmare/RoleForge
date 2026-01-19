# Rounds Prerequisite Feature - Specification

**Status:** PREREQUISITE for Vector Storage Implementation  
**Priority:** 🔴 CRITICAL - Must implement before VectorStorage feature  
**Prepared:** January 14, 2026

---

## Executive Summary

The vector storage memory system requires a clear, persistent concept of **"rounds"** to track when memories should be captured. A round is a complete cycle of user/agent interactions: the user sends a message, all active characters respond (as directed by the DirectorAgent), and then the round completes. This document specifies the work needed to implement persistent round tracking.

**Impact**: Without rounds, the VectorizationAgent cannot reliably know when to capture memories or scope them properly to specific interactions. Rounds provide the granularity needed for meaningful memory persistence.

---

## Feature Definition

### What is a Round?

A **round** is a complete cycle of:
1. **User Input**: Player sends one message
  - 1a. **Director Agent** : identifies what characters involved
  - 1b. **World Agent** : updates user status , world status
2. **Agent Responses**: All active characters respond sequentially (CharacterAgent calls)
3. **World State Update**: World state potentially updates (WorldAgent call)
4. **Scene Narration**: Optional scene narration (NarratorAgent call)
5. **Round Completion**: All responses persist, round closes

### Example Flow

```
=== ROUND 1 ===
User: "Hello everyone, I'm here to join your adventure!"
CharacterA: "Welcome! We've been waiting for someone like you."
CharacterB: "Indeed. Let's discuss our plans."
NarratorAgent: "The atmosphere grows tense with anticipation."
[ROUND 1 ENDS - Memory capture triggered for Round 1]

=== ROUND 2 ===
[User can start new round OR manually trigger "Continue Round" button]
User: "What are your plans?"
CharacterA: "We're heading north to the mountains..."
CharacterB: "And gathering supplies along the way."
[ROUND 2 ENDS - Memory capture triggered for Round 2]

```

### Why Rounds Matter for Vectors

1. **Memory Capture Granularity**: VectorizationAgent captures all messages in a round together
2. **Scope Isolation**: All active characters in round share memories of that round
3. **Replay Prevention**: Don't re-process same messages multiple times
4. **User-Triggered Continuation**: UI button allows scenes to continue without user input

---

## Database Schema Changes

### New Column in Messages Table

Add `roundNumber` column to track which round each message belongs to.

**Migration (005_add_round_tracking.sql)**:
```sql
ALTER TABLE Messages ADD COLUMN roundNumber INTEGER DEFAULT 1 NOT NULL;

-- Index for faster round-based queries
CREATE INDEX idx_messages_scene_round ON Messages(sceneId, roundNumber);
```

**Updated Messages Schema**:
```sql
CREATE TABLE Messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
  messageNumber INTEGER NOT NULL,
  message TEXT NOT NULL,
  sender TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  tokenCount INTEGER DEFAULT 0,
  roundNumber INTEGER DEFAULT 1 NOT NULL,  -- NEW COLUMN
  UNIQUE(sceneId, messageNumber)
);

-- Note: character presence is tracked in the `SceneRounds.activeCharacters` column
-- (one authoritative place for which characters were active in a round).
```

### New Table: SceneRounds (Metadata)

Track round metadata for efficient queries.

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS SceneRounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
  roundNumber INTEGER NOT NULL,
  status TEXT DEFAULT 'in-progress',  -- 'in-progress' | 'completed'
  activeCharacters JSON NOT NULL,      -- Array of character IDs/names active in this round
  roundStartedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  roundCompletedAt DATETIME,
  vectorized BOOLEAN DEFAULT 0,        -- Has this round been vectorized?
  vectorizedAt DATETIME,
  UNIQUE(sceneId, roundNumber)
);
```

### Scenes Table - Add Round Tracking

Add current round tracking to Scenes table.

**Migration (005_add_round_tracking.sql)**:
```sql
ALTER TABLE Scenes ADD COLUMN currentRoundNumber INTEGER DEFAULT 1;
```

---

## Backend Implementation Work

### 1. MessageService Updates

**File**: `backend/src/services/MessageService.ts`

**Changes Required**:
- Add `roundNumber` parameter to `create()` method
- Add `getRoundMessages(sceneId, roundNumber)` method
- Add `getLatestRound(sceneId)` method
- Update `getMessages()` to optionally filter by round

**New Methods**:
```typescript
// Get all messages in a specific round
getRoundMessages(sceneId: number, roundNumber: number): MessageRow[] {
  return db.prepare(
    'SELECT * FROM Messages WHERE sceneId = ? AND roundNumber = ? ORDER BY messageNumber ASC'
  ).all(sceneId, roundNumber);
}

// Get the latest round number for a scene
getLatestRound(sceneId: number): number {
  const result = db.prepare(
    'SELECT MAX(roundNumber) as maxRound FROM Messages WHERE sceneId = ?'
  ).get(sceneId) as any;
  return result?.maxRound || 1;
}

// Get messages for current active round
getCurrentRoundMessages(sceneId: number): MessageRow[] {
  const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?').get(sceneId) as any;
  if (!scene) return [];
  return this.getRoundMessages(sceneId, scene.currentRoundNumber);
}
```

### 2. SceneService Updates

**File**: `backend/src/services/SceneService.ts`

**Changes Required**:
- Add `initializeRound(sceneId)` - starts new round
- Add `completeRound(sceneId, roundNumber, activeCharacters)` - ends round and marks for vectorization
- Add `getRoundData(sceneId, roundNumber)` - fetch round metadata
- Track current round in Scene object

**New Methods**:
```typescript
// Initialize a new round
initializeRound(sceneId: number): number {
  const latest = MessageService.getLatestRound(sceneId);
  const newRound = latest + 1;
  
  db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?')
    .run(newRound, sceneId);
  
  return newRound;
}

// Complete the current round (prepare for vectorization)
completeRound(sceneId: number, activeCharacters: string[]): void {
  const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
    .get(sceneId) as any;
  
  db.prepare(`
    INSERT INTO SceneRounds (sceneId, roundNumber, status, activeCharacters, roundCompletedAt)
    VALUES (?, ?, 'completed', ?, CURRENT_TIMESTAMP)
  `).run(sceneId, scene.currentRoundNumber, JSON.stringify(activeCharacters));
}

// Get round metadata
getRoundData(sceneId: number, roundNumber: number): any {
  return db.prepare(
    'SELECT * FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
  ).get(sceneId, roundNumber);
}

// Mark round as vectorized
markRoundVectorized(sceneId: number, roundNumber: number): void {
  db.prepare(`
    UPDATE SceneRounds 
    SET vectorized = 1, vectorizedAt = CURRENT_TIMESTAMP 
    WHERE sceneId = ? AND roundNumber = ?
  `).run(sceneId, roundNumber);
}
```

### 3. Orchestrator Updates

**File**: `backend/src/agents/Orchestrator.ts`

**Changes Required**:
- Track current round in Orchestrator instance
- Update round on every round completion
- Trigger VectorizationAgent after round completion
- Handle manual round continuation

**Key Integration Points**:
```typescript
export class Orchestrator {
  private currentRoundNumber: number = 1;
  private roundActiveCharacters: string[] = [];
  
  // Track current round when starting session
  async buildSessionContext(...): Promise<AgentContext> {
    // ... existing code ...
    this.currentRoundNumber = await SceneService.getCurrentRound(sceneId) || 1;
    return sessionContext;
  }
  
  // After all character responses complete
  async completeRound(sceneId: number): Promise<void> {
    // Mark round complete
    await SceneService.completeRound(sceneId, this.roundActiveCharacters);
    
    // NEW: Trigger VectorizationAgent to capture memories
    const vectorizationAgent = this.agents.get('vectorization');
    if (vectorizationAgent) {
      const roundMessages = MessageService.getRoundMessages(sceneId, this.currentRoundNumber);
      const roundContext: AgentContext = {
        sceneId,
        roundNumber: this.currentRoundNumber,
        messages: roundMessages,
        activeCharacters: this.roundActiveCharacters,
        // ... other context ...
      };
      await vectorizationAgent.run(roundContext);
    }
    
    // Move to next round
    this.currentRoundNumber += 1;
  }
  
  // Handle manual "Continue Round" action
  async continueRound(sceneId: number): Promise<void> {
    // Trigger character responses without waiting for user input
    // Based on last message in previous round
    const lastMessage = MessageService.getLastMessage(sceneId);
    
    // Generate character responses using lastMessage as context
    // When complete, call completeRound()
  }
}
```

### 4. Server Route Updates

**File**: `backend/src/server.ts`

**Changes Required**:
- Update `/api/scenes/:sceneId/chat` to track rounds
- Add round number to message creation
- Add new `/api/scenes/:sceneId/continue-round` endpoint (manual continuation)
- Emit round completion event via Socket.io

**Chat Endpoint Update**:
```typescript
app.post('/api/scenes/:sceneId/chat', async (req, res) => {
  const { sceneId } = req.params;
  const { message: userMessage } = req.body;
  
  try {
    // Get current round
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    const currentRound = scene?.currentRoundNumber || 1;
    
    // Process user message (add with roundNumber)
    MessageService.create(
      Number(sceneId),
      userMessage,
      'User',
      currentRound  // NEW: pass round number
    );
    
    // Generate character responses
    const responses = await orchestrator.generateCharacterResponses(...);
    
    // All responses added with same roundNumber
    responses.forEach(r => {
      MessageService.create(
        Number(sceneId),
        r.text,
        r.character,
        currentRound  // NEW: same round
      );
    });
    
    // Complete the round
    await orchestrator.completeRound(Number(sceneId));
    
    // Emit round completion event
    io.to(`scene-${sceneId}`).emit('roundCompleted', {
      roundNumber: currentRound,
      messages: MessageService.getRoundMessages(Number(sceneId), currentRound)
    });
    
    res.json({ success: true, roundCompleted: currentRound });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**New Continue Round Endpoint**:
```typescript
app.post('/api/scenes/:sceneId/continue-round', async (req, res) => {
  const { sceneId } = req.params;
  
  try {
    // Trigger orchestrator to continue without user input
    await orchestrator.continueRound(Number(sceneId));
    
    // Emit event
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    io.to(`scene-${sceneId}`).emit('roundCompleted', {
      roundNumber: scene.currentRoundNumber - 1,
      autoTriggered: true
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Frontend Implementation Work

### 1. Chat Component Updates

**File**: `frontend/src/components/Chat.tsx`

**Changes Required**:
- Add "Continue Round" button next to "Send" button
- Disable button during active round processing
- Show round number in UI
- Display round boundaries visually

**New UI Elements**:
```tsx
<div className="flex gap-2">
  <input 
    type="text" 
    value={message}
    onChange={(e) => setMessage(e.target.value)}
    placeholder="Your message..."
    disabled={isProcessing}
    className="flex-1 px-3 py-2 bg-slate-700 text-white rounded"
  />
  
  <button
    onClick={sendMessage}
    disabled={isProcessing}
    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 rounded"
  >
    Send
  </button>
  
  {/* NEW: Continue Round button */}
  <button
    onClick={continueRound}
    disabled={isProcessing}
    title="Let characters continue the scene without new user input"
    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 rounded"
  >
    Continue Round
  </button>
</div>
```

### 2. Socket.io Event Listeners

**Changes Required**:
- Listen for `roundCompleted` event
- Display round boundaries in chat UI
- Update round counter display

```tsx
useEffect(() => {
  socket.on('roundCompleted', (data) => {
    console.log(`Round ${data.roundNumber} completed`);
    setCurrentRound(data.roundNumber + 1);
    
    // Visual separator or notification
    addSystemMessage(`--- Round ${data.roundNumber} Complete ---`);
  });
  
  return () => socket.off('roundCompleted');
}, [socket]);
```

---

## Integration with VectorStorage

### VectorizationAgent Hook

Once Rounds are implemented, the VectorizationAgent will:

1. **Listen for Round Completion**: Orchestrator triggers VectorizationAgent after `completeRound()`
2. **Retrieve Round Messages**: Fetch all messages in the round
3. **Extract Active Characters**: Use `SceneRounds.activeCharacters`
4. **Generate Embeddings**: Convert round summary to vector
5. **Store Memories**: Add to vector store for each active character
6. **Mark Vectorized**: Set `SceneRounds.vectorized = true`

**Expected VectorizationAgent Context**:
```typescript
interface VectorizationContext extends AgentContext {
  sceneId: number;
  roundNumber: number;
  roundMessages: MessageRow[];
  activeCharacters: string[];
  worldState: Record<string, any>;
  characterStates: Record<string, any>;
}
```

---

## Implementation Checklist

### Phase 1: Database & Services (2-3 days)
- [ ] Create migration file `005_add_round_tracking.sql`
- [ ] Run migration to add roundNumber to Messages and create SceneRounds table
- [ ] Add roundNumber to Scenes table
- [ ] Update MessageService with new methods
- [ ] Update SceneService with round lifecycle methods
- [ ] Add tests for new service methods

### Phase 2: Orchestrator & Backend (3-4 days)
- [ ] Add round tracking to Orchestrator class
- [ ] Implement `completeRound()` method
- [ ] Implement `continueRound()` method
- [ ] Update chat endpoint to track rounds
- [ ] Add `/api/scenes/:sceneId/continue-round` endpoint
- [ ] Emit Socket.io events for round completion
- [ ] Add error handling for round edge cases
- [ ] Add tests for orchestrator round logic

### Phase 3: Frontend (2-3 days)
- [ ] Add "Continue Round" button to Chat component
- [ ] Update message display to show round boundaries
- [ ] Add round counter/indicator
- [ ] Implement Socket.io listeners for round events
- [ ] Add loading states during continue-round
- [ ] Style round visual separators
- [ ] Test UI responsiveness

### Phase 4: Integration & Testing (2-3 days)
- [ ] End-to-end testing of round flow
- [ ] Test message persistence across rounds
- [ ] Test activeCharacters tracking
- [ ] Test manual round continuation
- [ ] Performance testing (query speed with round indexing)
- [ ] Integration test with VectorizationAgent (when ready)

---

## Files to Create/Modify

### Create
- `backend/migrations/005_add_round_tracking.sql`
- `backend/src/__tests__/rounds.test.ts` (new test file)

### Modify
- `backend/src/database.ts` - Ensure new tables/columns
- `backend/src/services/MessageService.ts` - Add round methods
- `backend/src/services/SceneService.ts` - Add round lifecycle
- `backend/src/agents/Orchestrator.ts` - Track rounds, trigger VectorizationAgent
- `backend/src/server.ts` - Update chat endpoint, add continue-round endpoint
- `frontend/src/components/Chat.tsx` - Add Continue Round button
- `frontend/src/components/Chat.tsx` - Add Socket.io listeners

---

## Socket.io Events

### New Events

**`roundCompleted`** (server → client)
```typescript
{
  roundNumber: number;
  sceneId: number;
  messages: MessageRow[];
  autoTriggered?: boolean;  // true if Continue Round was pressed
}
```

**Potential Future Events**:
- `roundStarted` - Emitted when new round begins
- `vectorizationStarted` - Emitted when VectorizationAgent starts processing
- `vectorizationComplete` - Emitted when round memories saved

---

## Edge Cases & Error Handling

### Edge Cases to Handle

1. **Multiple messages in one round**
   - User sends message, agent responds, user sends another before round completes
   - Decision: User's second message starts NEW round

2. **Continue Round with no messages**
   - User clicks Continue Round on empty scene
   - Decision: Use previous round's last message as context, agents respond based on that

3. **Scene switch mid-round**
   - Player leaves scene during active round
   - Decision: Mark round as incomplete, store what exists

4. **Round counter reset**
   - Scene ends, new scene starts
   - Decision: Reset round to 1 for new scene

5. **Missing activeCharacters**
   - CompleteRound called but some characters weren't tracked
   - Decision: Log warning, use whatever was tracked

---

## Testing Strategy

### Unit Tests (MessageService, SceneService)
```typescript
test('getRoundMessages returns messages only for specified round', () => {
  // Add messages to round 1 and 2
  // Query round 1
  // Verify only round 1 messages returned
});

test('completeRound creates SceneRounds entry', () => {
  // Complete a round
  // Verify SceneRounds entry created with correct data
});
```

### Integration Tests (Orchestrator)
```typescript
test('completeRound triggers VectorizationAgent', async () => {
  // Mock VectorizationAgent
  // Complete a round
  // Verify VectorizationAgent.run() was called with correct context
});

test('continueRound generates responses without user input', async () => {
  // Set up scene with messages
  // Call continueRound()
  // Verify new messages generated
  // Verify new round number tracked
});
```

### End-to-End Tests (Full Flow)
```typescript
test('Full round workflow: send message → agent responses → round complete', async () => {
  // POST to /api/scenes/:sceneId/chat
  // Verify roundNumber in messages
  // Verify roundCompleted event emitted
  // Verify new roundNumber starts
});
```

---

## Performance Considerations

### Database Indexing
```sql
CREATE INDEX idx_messages_scene_round ON Messages(sceneId, roundNumber);
CREATE INDEX idx_scene_rounds_scene_vectorized ON SceneRounds(sceneId, vectorized);
```

### Query Optimization
- Batch retrieve all round messages in single query (not one-by-one)
- Use `ORDER BY messageNumber ASC` to maintain order
- Index on (sceneId, roundNumber) for efficient filtering

### Cleanup Strategy
- Archived scenes: Soft-delete rounds or archive to separate table
- Long campaigns: Periodically vectorize old rounds and delete raw messages (optional)

---

## Documentation Updates

After implementation, update:
- `IMPLEMENTATION_STATUS.md` - Add Rounds as Phase 5 supplemental feature
- `agent-design.md` - Add VectorizationAgent hook description
- `backend/BACKEND_SUPPORT.md` - Document round workflow
- `README.md` - Include round concept in architecture overview

---

## Success Criteria

✅ Messages persist with roundNumber across server restart  
✅ Manual "Continue Round" button advances scene without user input  
✅ All active characters tracked in SceneRounds.activeCharacters  
✅ Round boundaries visible in UI  
✅ VectorizationAgent can be triggered after round completion  
✅ Query performance acceptable with new index (< 100ms for typical scene)  
✅ All tests pass (unit, integration, end-to-end)

---

## References & Dependencies

- Related: VectorStorage.md (depends on this feature)
- Database: `backend/database.ts`
- Services: `backend/src/services/MessageService.ts`, `SceneService.ts`
- Agents: `backend/src/agents/Orchestrator.ts`
- Frontend: `frontend/src/components/Chat.tsx`

