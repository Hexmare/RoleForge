# Vector Storage Implementation - Codebase Review & Clarifications Needed

**Prepared:** January 14, 2026

---

## Executive Summary

The VectorStorage.md proposal is well-architected and feasible for RoleForge. However, **9 key areas require clarification** to ensure seamless integration with the existing codebase. This review compares the proposal against current architecture patterns and identifies gaps in specification.

---

## 1. ✅ RESOLVED: Memory Capture Points - Hook into Orchestrator Rounds

### Clarification Provided
Memory capture will hook into the **Rounds** system (prerequisite feature):
- Round = complete cycle of user message + all character responses + narration
- After `completeRound()` in Orchestrator, VectorizationAgent is triggered
- All messages in that round are vectorized together
- Vectorized for each active character in the round

### Implementation Details
- **Trigger Point**: `Orchestrator.completeRound()` method calls VectorizationAgent
- **What's Captured**: All MessageService entries with same roundNumber
- **Active Characters**: Retrieved from `SceneRounds.activeCharacters` JSON array
- **Storage**: Memories stored for each active character: scope `world_${worldId}_char_${characterId}`
- **Non-Blocking**: VectorizationAgent runs asynchronously to not block roleplay

### Related Files
- **New**: `ROUNDS_Prerequisite_Feature.md` - Detailed rounds implementation spec
- **Modify**: `backend/src/agents/Orchestrator.ts` - Call VectorizationAgent after round complete
- **New**: `backend/src/agents/VectorizationAgent.ts` - New agent for memory vectorization
- **Modify**: `backend/src/services/MessageService.ts` - Add roundNumber support

---

## 2. ✅ RESOLVED: Embedding Generation - Local ONNX Implementation

### Clarification Provided
- Create new **VectorizationAgent** with optional LLM profile
- Default behavior: Use **local embeddings** via `@xenova/transformers` (no API needed)
- Optional profile: Can be configured for custom embeddings if desired
- Fallback: If profile is default/empty, use JS library implementation

### Implementation Details

**Local Embedding Generation** (Inspired by SillyTavern's approach):
- Uses `@xenova/transformers` library (pure JavaScript/ONNX runtime)
- Recommended models:
  - `Xenova/all-mpnet-base-v2` (768 dimensions, good quality)
  - `mixedbread-ai/mxbai-embed-large-v1` (1024 dimensions, high quality)
  - `jinaai/jina-embeddings-v2-base-en` (768 dimensions, specialized)

**Process**:
1. Load ONNX-exported sentence-transformer model (first run: ~2-5 seconds)
2. Chunk text into ~300-600 token pieces
3. Tokenize with model's AutoTokenizer
4. Extract features through transformer backbone
5. Apply mean pooling + L2 normalization → dense vector (768-1024 dims)
6. Per-chunk embedding: ~50-200ms on CPU

**Benefits**:
- ✅ Fully free (no API keys)
- ✅ Server-side only (no external calls)
- ✅ Offline capable
- ✅ No Docker/external services
- ✅ Configurable model choice

**Cost/Performance Trade-off**:
- First-run model download: ~500MB-2GB (depending on model)
- Embedding speed: Acceptable for typical scene rounds
- No API quota exhaustion risk

### Related Files
- **New**: `backend/src/agents/VectorizationAgent.ts` - Integrates embedding generation
- **New**: `backend/src/utils/embeddingManager.ts` - Manages @xenova/transformers pipeline
- **Update**: `backend/config.json` - Optional embedding profile config
- **Update**: `backend/package.json` - Add @xenova/transformers dependency

---

## 3. ✅ RESOLVED: Scope Initialization - Lazy Creation

### Clarification Provided
- **Lazy Initialization**: Check for scope existence when storing first memory
- If scope doesn't exist, create it automatically
- On query, if scope doesn't exist, return empty results (same as no memories)
- No pre-initialization during character/world creation needed

### Implementation Details

**Storage Flow**:
```
VectorizationAgent calls: vectorStore.addMemory(id, text, metadata, scope)
  → Check if scope exists
  → If not, call vectorStore.init(scope) first
  → Then add memory
```

**Query Flow**:
```
CharacterAgent queries: vectorStore.query(text, topK, minSimilarity, scope)
  → If scope doesn't exist, return []
  → Otherwise, perform normal query
```

**Scope Format**: `world_${worldId}_char_${characterId}`

**Multi-Character Handling**:
- Store memory in each active character's scope
- When retrieving, only query that character's scope
- Characters can "witness" each other's actions (same round) but memories are isolated by character

**Benefits**:
- ✅ No schema migration for world/character tables needed
- ✅ Automatic cleanup (unused scopes naturally don't exist)
- ✅ Simple query semantics (missing scope = no memories)
- ✅ No initialization race conditions

### Related Files
- **New**: `backend/src/stores/VectraVectorStore.ts` - Implements lazy init in addMemory()
- **Update**: `backend/src/agents/VectorizationAgent.ts` - Calls vectorStore.addMemory() which handles init
- **Update**: `VectorStoreInterface` - Clarify that init() creates if not exists

---

## 4. ✅ RESOLVED: Query Trigger Logic - Follows Lore Pattern

### Clarification Provided
Query trigger logic will follow the **existing lore matching pattern** (`matchLoreEntries()`):
- Build query from user input + scene summary
- Use same frequency/pattern as current lore system
- Query triggered before agent responses, similar to lore injection

### Implementation Details

**Query Building** (Pattern: like existing lore):
```typescript
// In Orchestrator, before calling character agents
const queryText = `${context.userInput} ${context.sceneSummary || ''}`;
const memories = await vectorStore.query(
  queryText, 
  topK: 3, 
  minSimilarity: 0.7,
  scope: `world_${worldId}_char_${characterId}`
);
context.vectorMemories = memories;
```

**Query Frequency**:
- Before each character response (same as lore)
- Per-character (each character gets their own memories)
- Async to avoid blocking (can timeout if needed)

**Filter Results**:
- Min similarity threshold: 0.7 (configurable)
- Top K results: 3-5 memories per query (configurable)
- Sort by relevance descending

**Benefits**:
- ✅ Consistent with existing lore pattern
- ✅ Agents already trained on lore injection format
- ✅ Reuses existing context-building logic
- ✅ Clear mental model for developers

### Related Files
- **Update**: `backend/src/agents/Orchestrator.ts` - Query before agent.run()
- **Update**: `backend/src/agents/BaseAgent.ts` - Add vectorMemories to AgentContext
- **Reference**: `backend/src/utils/loreMatcher.ts` - Study existing lore pattern

---

## 5. ✅ RESOLVED: Prompt Injection - Lore System Pattern

### Clarification Provided
Memory injection will follow the **existing lore system injection pattern**:
- Add section to prompt templates (like lore)
- Inject via Nunjucks templates, similar to lore
- Add to Orchestrator context as `context.vectorMemories`

### Implementation Details

**Template Injection** (character.njk example):
```njk
{{ systemPrompt }}

{% if formattedLore %}
## Known Lore:
{{ formattedLore }}
{% endif %}

{% if vectorMemories and vectorMemories.length > 0 %}
## Relevant Memories:
{% for memory in vectorMemories %}
- {{ memory.text }} (relevance: {{ (memory.similarity * 100) | round }}%)
{% endfor %}
{% endif %}
```

**Context Addition** (in Orchestrator):
```typescript
const vectorMemories = await vectorStore.query(queryText, 3, 0.7, scope);
context.vectorMemories = vectorMemories;
// agent.run(context) receives vectorMemories
```

**Format Consistency**:
- Similar bullet-point format to lore
- Include similarity score for transparency
- Optional section (only shown if memories exist)
- Separate from lore section (don't mix)

**Benefits**:
- ✅ Agents already see similar format in lore
- ✅ Reuses template infrastructure
- ✅ Easy to adjust formatting per agent
- ✅ Token-budget aware (can limit/trim like lore)

### Related Files
- **Update**: `backend/src/prompts/character.njk` - Add vectorMemories section
- **Update**: `backend/src/prompts/narrator.njk` - Add vectorMemories section
- **Update**: `backend/src/agents/BaseAgent.ts` - Add vectorMemories to AgentContext interface
- **Reference**: `backend/src/prompts/character.njk` - Study existing lore injection

---

## 6. ✅ RESOLVED: Scope Isolation - Multi-Character Scenes

### Clarification Provided
Multi-character isolation is **actually simple**:
- When vectorizing a round, store memories for **all active characters in that round**
- When retrieving for Character A, only search Character A's scopes
- Each character has separate scope: `world_${worldId}_char_${characterId}`

### Implementation Details

**Storage** (when round completes with User + CharA + CharB):
```typescript
// VectorizationAgent runs after round complete
const activeCharacters = ['User', 'CharacterA', 'CharacterB'];
for (const character of activeCharacters) {
  const scope = `world_${worldId}_char_${character}`;
  await vectorStore.addMemory(memoryId, roundSummary, {
    roundNumber,
    activeCharacters,  // All participants
    timestamp
  }, scope);
}
```

**Retrieval** (query only for Character A):
```typescript
const scope = `world_${worldId}_char_CharacterA`;
const memories = await vectorStore.query(queryText, 3, 0.7, scope);
// Only returns memories stored in CharacterA's scope
```

**Result**:
- ✅ No knowledge bleed (each character only sees their own scope)
- ✅ Characters ARE aware of round events (same memory text)
- ✅ Metadata tracks who participated (for analysis)
- ✅ Simple scope formula (no complex routing)

**Multi-Round Context**:
- Character A remembers what they experienced in rounds with B and C
- Character B remembers what they experienced in rounds with A and C
- No cross-character memories within same round (proper isolation)

### Related Files
- **Update**: `backend/src/agents/VectorizationAgent.ts` - Loop through activeCharacters
- **Update**: `backend/src/agents/Orchestrator.ts` - Pass activeCharacters to VectorizationAgent
- **Update**: `backend/src/stores/VectraVectorStore.ts` - Ensure scope isolation in queries

---

## 7. ✅ RESOLVED: Memory Summarization - VectorizationAgent

### Clarification Provided
Create a **new agent: VectorizationAgent** to handle memory generation and storage:
- Similar to existing SummarizeAgent pattern
- Can have optional LLM profile (defaults to local embeddings)
- Called by Orchestrator after round completion

### Implementation Details

**VectorizationAgent Overview**:
```typescript
export class VectorizationAgent extends BaseAgent {
  constructor(configManager: ConfigManager, env: nunjucks.Environment) {
    super('vectorization', configManager, env);
  }

  async run(context: VectorizationContext): Promise<string> {
    // Input: Round messages + active characters + world state
    // Output: Memories stored in vector DB for each character
    
    // Option 1: Summarize round into concise memory
    // Option 2: Use raw messages as memories
    // Option 3: Extract key events/facts from messages
    
    // Generate embeddings (local or via profile)
    // Store in vector DB for each active character
    // Mark round as vectorized
    
    return JSON.stringify({ success: true, memoriesStored });
  }
}
```

**Triggering** (from Orchestrator):
```typescript
async completeRound(sceneId: number): Promise<void> {
  // Mark round complete in DB
  await SceneService.completeRound(sceneId, this.roundActiveCharacters);
  
  // NEW: Trigger vectorization
  const vectorizationAgent = this.agents.get('vectorization');
  const roundMessages = MessageService.getRoundMessages(sceneId, this.currentRoundNumber);
  const context: VectorizationContext = {
    sceneId,
    roundNumber: this.currentRoundNumber,
    roundMessages,
    activeCharacters: this.roundActiveCharacters,
    worldState: this.worldState,
    // ... other context ...
  };
  
  // Run async (don't block roleplay)
  setImmediate(async () => {
    try {
      await vectorizationAgent.run(context);
      await SceneService.markRoundVectorized(sceneId, this.currentRoundNumber);
    } catch (error) {
      console.warn('[Vectorization] Failed:', error);
      // Don't interrupt roleplay
    }
  });
}
```

**Summarization Approach**:
- Option 1: Use LLM to summarize round into concise memory
  - Pros: High-quality summaries, reduced storage
  - Cons: Requires extra LLM call per round
- Option 2: Raw messages (no summarization)
  - Pros: Complete information, fast
  - Cons: Higher storage, may be too verbose
- **Recommendation**: Start with raw messages (simpler), optimize later if needed

### Related Files
- **New**: `backend/src/agents/VectorizationAgent.ts` - New agent
- **Update**: `backend/src/agents/Orchestrator.ts` - Trigger VectorizationAgent
- **New**: `backend/src/types/VectorizationContext.ts` - Context interface
- **Reference**: `backend/src/agents/SummarizeAgent.ts` - Similar agent pattern

---

## 8. ✅ RESOLVED: Error Handling - Silent Fallback

### Clarification Provided
Error handling is simple: **Don't inject anything** if vectorization/query fails
- Errors logged but not exposed
- Roleplay continues normally
- Missing memories = same as no memories found

### Implementation Details

**Memory Capture Error** (VectorizationAgent):
```typescript
try {
  const embeddings = await generateEmbeddings(roundMessages);
  await vectorStore.addMemory(...);
  await SceneService.markRoundVectorized(sceneId, roundNumber);
} catch (error) {
  console.warn('[Vectorization] Round vectorization failed:', {
    sceneId,
    roundNumber,
    error: error.message
  });
  // Do NOT throw - let roleplay continue
  // Do NOT mark round vectorized - can retry later
}
```

**Memory Query Error** (in Orchestrator before agent response):
```typescript
try {
  const memories = await vectorStore.query(queryText, 3, 0.7, scope);
  context.vectorMemories = memories;
} catch (error) {
  console.warn('[Memory Query] Failed:', { character, error: error.message });
  // Set empty memories
  context.vectorMemories = [];
  // Continue with agent response
}
```

**Error Categories & Handling**:

| Error | Handling | Result |
|-------|----------|--------|
| Vector store connection failed | Log warning, skip vectorization | Round proceeds without memories |
| Embedding generation fails | Log warning, mark for retry | Memories not stored this round |
| Query timeout | Return partial results or empty | Agent proceeds, memory injection skipped |
| Model download fails | Log error, skip embeddings | Fallback to text search (future) |
| Storage disk full | Log error, skip new memories | Old memories still queryable |

**Benefits**:
- ✅ Roleplay never blocked by memory system
- ✅ Graceful degradation (missing features not fatal)
- ✅ Admin can review logs for issues
- ✅ System self-heals (retry on next round)

### Related Files
- **Update**: `backend/src/agents/VectorizationAgent.ts` - Try/catch with logging
- **Update**: `backend/src/agents/Orchestrator.ts` - Try/catch on memory query
- **New**: `backend/src/utils/logger.ts` - Centralized logging (if needed)

---

## 9. ✅ RESOLVED: Testing Strategy - Will Be Defined

### Clarification Provided
Testing strategy will be defined as part of detailed implementation planning.

### Testing Approach (Planned)

**Unit Tests** (VectorStore Interface & Providers):
```typescript
// test: Vectra provider scope isolation
test('memories in scopeA should not appear in scopeB queries', async () => {
  const store = new VectraVectorStore();
  const scopeA = 'world_1_char_1';
  const scopeB = 'world_1_char_2';
  
  await store.init(scopeA);
  await store.init(scopeB);
  
  await store.addMemory('mem1', 'Alex ate dinner', {}, scopeA);
  const resultsB = await store.query('What did Alex do?', 3, 0.7, scopeB);
  
  expect(resultsB).toHaveLength(0); // No cross-scope contamination
});

// test: Embedding generation
test('embeddings should be consistent for same text', async () => {
  const embedding = await embeddingManager.embed('Hello world');
  expect(Array.isArray(embedding)).toBe(true);
  expect(embedding.length).toBeGreaterThan(0); // 768+ dimensions
});
```

**Integration Tests** (VectorizationAgent + Orchestrator):
```typescript
// test: Round vectorization
test('VectorizationAgent stores memories for active characters', async () => {
  // Setup: Create scene, add round messages
  // Action: Call VectorizationAgent.run()
  // Assert: Verify memories stored in each character's scope
});

// test: Memory query injection
test('CharacterAgent receives vectorMemories in context', async () => {
  // Setup: Add memories to vector store
  // Action: Call Orchestrator.generateCharacterResponse()
  // Assert: Verify context.vectorMemories populated
});
```

**End-to-End Tests** (Full Workflow):
```typescript
// test: Multi-round scene with memory recall
test('Scene memories improve consistency across rounds', async () => {
  // Round 1: CharacterA learns that user likes pizza
  // Round 2: Query should include "user likes pizza"
  // Round 3: CharacterA references pizza preference
});
```

**Testing Strategy**:
- Start with unit tests for VectorStoreInterface
- Add integration tests with mocked vector store
- End-to-end tests with real Vectra store (optional)
- Performance tests for query latency
- Isolation tests for multi-character scenarios

### Related Files
- **New**: `backend/src/__tests__/vectorization.test.ts` - Vector store tests
- **New**: `backend/src/__tests__/vectorization-agent.test.ts` - Agent tests
- **Update**: `backend/src/__tests__/orchestrator.test.ts` - Add memory query tests
- **Reference**: Existing test setup in `backend/src/__tests__/`

---

## Summary: All Clarifications Addressed ✅

| Priority | Item | Status | Impact |
|----------|------|--------|--------|
| 🔴 CRITICAL | 1. Memory capture points | ✅ RESOLVED | Orchestrator rounds trigger VectorizationAgent |
| 🔴 CRITICAL | 2. Embedding generation | ✅ RESOLVED | Local @xenova/transformers (offline, free) |
| 🟠 HIGH | 3. Scope initialization | ✅ RESOLVED | Lazy creation on first memory store |
| 🟠 HIGH | 4. Query trigger logic | ✅ RESOLVED | Follows existing lore pattern |
| 🟠 HIGH | 6. Multi-character isolation | ✅ RESOLVED | Store per active char, query per scope |
| 🟡 MEDIUM | 5. Prompt injection | ✅ RESOLVED | Nunjucks templates like lore system |
| 🟡 MEDIUM | 7. Memory summarization | ✅ RESOLVED | New VectorizationAgent |
| 🟡 MEDIUM | 8. Error handling | ✅ RESOLVED | Silent fallback, log warnings |
| 🟡 MEDIUM | 9. Testing strategy | ✅ RESOLVED | Unit/integration/E2E approach defined |

---

## Implementation Roadmap

### Phase 0: PREREQUISITE (2-4 sprints, ~40-60 hours)
**MUST DO FIRST**: Implement Rounds system
- See `ROUNDS_Prerequisite_Feature.md` for detailed spec
- Enables everything else in this feature

### Phase 1: Vector Store Interface & Local Embeddings (1 sprint, ~20 hours)
- [ ] Create `VectorStoreInterface.ts` and factory
- [ ] Implement `VectraVectorStore.ts`
- [ ] Set up `@xenova/transformers` embedding pipeline
- [ ] Add unit tests

### Phase 2: VectorizationAgent (1 sprint, ~15 hours)
- [ ] Create `VectorizationAgent` (extends BaseAgent)
- [ ] Integrate with Orchestrator.completeRound()
- [ ] Test vectorization flow
- [ ] Add error handling

### Phase 3: Memory Query & Injection (1 sprint, ~15 hours)
- [ ] Update Orchestrator to query memories before agent calls
- [ ] Add `context.vectorMemories` to AgentContext
- [ ] Update prompt templates with memory sections
- [ ] Test memory injection

### Phase 4: Integration & Testing (1 sprint, ~15 hours)
- [ ] End-to-end testing (multi-round scenes)
- [ ] Performance testing
- [ ] Memory isolation testing
- [ ] Documentation updates

**Total**: 4 sprints, ~65 hours (after Rounds prerequisite completed)

---

## Recommended Next Steps

1. ✅ **Review Updated Documentation**
   - `ROUNDS_Prerequisite_Feature.md` - Detailed rounds spec
   - `VectorStorage.md` - Updated with all clarifications
   - This document - All 9 items now resolved

2. ⏭️ **Plan Rounds Implementation First**
   - Must complete before vector storage work
   - Unblocks VectorizationAgent triggering
   - Enables testing framework

3. ⏭️ **Create Detailed Task Breakdown**
   - Break phases into individual Jira/GitHub issues
   - Assign story points using Rounds roadmap as baseline
   - Create spike for @xenova/transformers evaluation (if needed)

4. ⏭️ **Update TODO.md**
   - Add Rounds as prerequisite
   - Add Phase 1-4 tasks for Vector Storage
   - Update initial "Create vectorized memory system" entry

5. ⏭️ **Design & Spike (Optional)**
   - Create architecture diagram showing memory flow
   - Prototype embedding generation + Vectra integration
   - Performance test embedding latency
   - Evaluate model size/startup time trade-offs

---

## References

- **Existing Codebase:**
  - `backend/src/agents/BaseAgent.ts` - Agent LLM integration
  - `backend/src/llm/client.ts` - Chat completion flow
  - `backend/src/agents/Orchestrator.ts` - Agent orchestration & query building
  - `backend/src/services/CharacterService.ts` - Character scope management
  
- **Similar Pattern in Codebase:**
  - Lore injection via `matchLoreEntries()` (query → injection pattern)
  - Message persistence via `MessageService`
  - State management via `CampaignState` and `CampaignService`

---

## Questions for Clarification with Team

**All technical clarifications have been resolved. Remaining decisions are strategic:**

1. **Summarization Approach** - Raw messages vs. LLM-summarized memories?
   - Raw: Simpler, faster, complete info (recommended for MVP)
   - Summarized: More concise, better token efficiency (future optimization)

2. **Memory Retention Policy** - How long to keep memories?
   - Forever: Simple but storage grows unbounded
   - Per-scene: Archive old scenes' memories
   - By character: Limit per-character memory size
   - (Recommend: Archive with per-character limits)

3. **Model Selection** - Which embedding model to default to?
   - `Xenova/all-mpnet-base-v2` (768 dims, balanced)
   - `mixedbread-ai/mxbai-embed-large-v1` (1024 dims, high quality)
   - `jinaai/jina-embeddings-v2-base-en` (768 dims, specialized for text)
   - (Recommend: all-mpnet-base-v2 for balance)

4. **Query Parameters** - What are good defaults?
   - topK: 3-5 memories per query?
   - minSimilarity: 0.65-0.75 threshold?
   - (Recommend: topK=3, minSimilarity=0.70)

5. **Performance Targets** - What latencies are acceptable?
   - Embedding per round: < 2 seconds?
   - Query response: < 100ms?
   - (Recommend: Benchmark after MVP)

