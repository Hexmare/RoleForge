# Corrected Feature Document: Vector-Based Memory System for RoleForge

## Overview

RoleForge is a monorepo project built with TypeScript and Node.js, designed as an LLM-driven roleplay system inspired by TaleMate (for multi-agent backend and world separation) and SillyTavern (for lore books and inline image generation). It features a Node.js backend handling chat completions with OpenAI-compatible and Kobold profiles, frontend UI components (e.g., EntryEditor for lore management), database migrations for schemas (including characters, personas, and lorebooks), and scripts for lorebook CRUD operations and associations with worlds.

This feature introduces a vector-based memory system inspired by the st-qdrant-memory extension for SillyTavern (https://github.com/HO-git/st-qdrant-memory). The extension enables long-term memory by storing conversation snippets in a vector database, querying for relevance, and injecting results into prompts. Adaptations for RoleForge include:

- **Character Separation**: Isolate memories per character to prevent knowledge bleed.
- **World Awareness**: Scope memories to specific worlds (e.g., CharacterA in World1 separate from CharacterA in World2), aligning with existing world-lorebook associations.
- **Storage Requirements**: Use a lightweight, Node.js-native vector storage without Docker or external setups.
- **Abstraction Layer**: CRITICAL - Implement an interface for vector storage connections to allow easy provider swaps without core code changes.
- **Integration**: Query vector storage based on roleplay events and inject results into agent prompts.

This enhances agent responses with persistent, contextual memory, reducing token usage while maintaining relevance.

## Recommendation for Vector Storage Solution

Evaluated options remain the same. **Recommended Starting Solution: Vectra**. It uses local file system storage (indexes as folders), installs via npm, and fits Node.js without dependencies. Persistence across restarts, suitable for roleplay scales. Abstraction allows future swaps (e.g., to Milvus Lite).

## Multi-Character Memory Isolation

**Scenario**: Scene with User, CharacterA, CharacterB. Each sends messages in Round 1.
- **Storage**: Round 1 memories stored for User + CharacterA + CharacterB (all participants)
- **Retrieval**: 
  - When querying for CharacterA → only retrieve memories tagged with CharacterA
  - When querying for CharacterB → only retrieve memories tagged with CharacterB
  - When querying for User → only retrieve memories tagged with User
- **Implementation**: Store metadata with each memory entry: `{ text, actors: ["CharacterA", "CharacterB", "User"], roundNumber, sceneId, timestamp }`
  - Query filters by character presence in actors array
- **Result**: No knowledge bleed between characters, but characters ARE aware of each other's actions in the round

## Architecture

### High-Level Design
- **Memory Scope**: Store memories per character per world (e.g., scope as `worldId_characterId`), leveraging existing world and character schemas in migrations and backend.
- **Data Flow**:
  1. Capture key events/snippets as embeddings during roleplay.
  2. Store in vector DB under scoped key.
  3. Query with current context for top-k memories before agent responses.
  4. Inject into prompts for context-aware outputs.
- **Abstraction Interface**: Define `VectorStoreInterface` in TypeScript. Implement provider-specific classes (e.g., for Vectra). Instantiate via a factory in backend.

### VectorStoreInterface Definition
```typescript
interface VectorStoreInterface {
  /**
   * Initializes the store for a specific scope (e.g., worldId_characterId).
   * @param scope - Unique identifier for the memory scope.
   */
  init(scope: string): Promise<void>;

  /**
   * Adds a memory item with embedding.
   * @param id - Unique ID for the memory.
   * @param text - Text content to embed and store.
   * @param metadata - Optional metadata (e.g., timestamp, event type).
   */
  addMemory(id: string, text: string, metadata?: Record<string, any>): Promise<void>;

  /**
   * Queries the store for relevant memories.
   * @param queryText - Text to embed and query against.
   * @param topK - Number of top results to return (default: 5).
   * @param minSimilarity - Minimum similarity threshold (default: 0.7).
   * @returns Array of { id, text, metadata, similarity }.
   */
  query(queryText: string, topK?: number, minSimilarity?: number): Promise<Array<{ id: string; text: string; metadata: Record<string, any>; similarity: number }>>;

  /**
   * Deletes a memory by ID.
   * @param id - Memory ID to delete.
   */
  deleteMemory(id: string): Promise<void>;

  /**
   * Clears all memories for the scope.
   */
  clear(): Promise<void>;
}
```

### Example Implementation (Vectra)
```typescript
import { LocalIndex } from 'vectra';

class VectraVectorStore implements VectorStoreInterface {
  private indexes: Map<string, LocalIndex> = new Map();

  async init(scope: string): Promise<void> {
    const indexPath = `./vector_data/${scope}`;
    const index = new LocalIndex({ path: indexPath });
    await index.create(); // Creates if not exists
    this.indexes.set(scope, index);
  }

  async addMemory(id: string, text: string, metadata?: Record<string, any>): Promise<void> {
    const index = this.indexes.get(/* scope */); // Retrieve by scope
    const vector = await index.getVector(text); // Assuming built-in embedding; use external if needed
    await index.upsert({ id, vector, metadata: { text, ...metadata } });
  }

  // ... Implement other methods similarly
}
```

- **Embedding Generation**: RoleForge uses **local (offline) sentence embeddings** via `@xenova/transformers` library — a pure JavaScript/ONNX runtime port of Hugging Face transformers. This allows fully server-side, no-API-key vectorization without Docker or external services.
  - **Process Overview**:
    1. Load ONNX-exported sentence-transformer model (recommended: `nomic-ai/nomic-embed-text-v1.5`, `mixedbread-ai/mxbai-embed-large-v1`, or `jinaai/jina-embeddings-v2-base-en`)
    2. Split roleplay events/messages into fixed-size chunks (~300–600 tokens / ~800–2000 chars)
    3. Tokenize with model's AutoTokenizer (respects special tokens)
    4. Extract features through transformer backbone
    5. Apply **mean pooling** across sequence + **L2 normalization** → dense vector (768–1024 dimensions)
  - **Config**: Optional profile can be set for VectorizationAgent, but defaults to local embeddings if empty/default
  - **Cost**: Fully free (no API calls needed)
  - **Performance**: First model load ~2-5 seconds, embeddings ~50-200ms per chunk on CPU
- **World/Character Integration**: Use existing character/persona schemas and world-lorebook associations. Memory scopes use format: `world_${worldId}_char_${characterId}`

## Integration Guidelines

### Querying and Prompt Injection

**PREREQUISITE**: This feature requires the **Rounds** system to be implemented first. See `ROUNDS_Prerequisite_Feature.md` for details. Rounds provide the granularity and triggering mechanism for memory capture.

1. **Capture Memories**: After each round completes (user input + all character responses + narration), the VectorizationAgent is triggered to capture memories.
   - Round = complete cycle: user message → all character responses → world update
   - All messages in round are vectorized together
   - Active characters in that round have memories stored for them
2. **Query During Prompt Building**:
   - Follows same pattern as existing lore matching (`matchLoreEntries()`)
   - Build query from user input + scene summary (same approach as lore)
   - Call `vectorStore.query(currentContextQuery, topK=3, minSimilarity=0.7)` for character's world memories
   - Filter by character + world scope
3. **Prompt Injection**:
   - Follows same pattern as existing lore system injection
   - Query built from user input + scene context (similar to lore matching)
   - Injected into agent prompts via Nunjucks templates (add new section to `character.njk`, `narrator.njk`, etc.)
   - Format: Injected similar to lore, with relevance scores
   - Added to context as `context.vectorMemories` for template access
4. **Event-Based Triggering**: Integrate with backend event-like flows (e.g., chat completions, lore updates). Hook into roleplay turns via existing agent logic (reference .github/agent-design.md).
5. **Error Handling**: If vectorization or query fails, silently continue without injecting memories (don't interrupt roleplay). Errors logged but not exposed to user.
6. **Performance**: Limit topK; store concise summaries.

### Testing Considerations
- Unit tests for interface/providers using existing setup (e.g., Jest if configured).
- Integration tests: Simulate sessions, verify isolation.
- Reference setupinstructions.md for environment.

## Implementation Order

**CRITICAL**: The **Rounds** feature (see `ROUNDS_Prerequisite_Feature.md`) must be implemented FIRST. Rounds provide:
- Triggering mechanism for memory capture
- Granularity for memory scoping
- UI affordance (Continue Round button)
- Persistent round tracking for queries

After Rounds are complete, implement Vector Storage in this order:

## User Stories and Implementation Tasks

User stories prioritized incrementally: core abstraction first, then scoping, integration.

### User Story 1: As a developer, I want an abstracted vector store interface so that I can swap providers easily without changing core code.
#### Tasks (Order: Sequential)
1. Create `VectorStoreInterface.ts` in backend (e.g., backend/interfaces/).
2. Add factory function in backend (e.g., backend/utils/vectorStoreFactory.ts) for instantiation (e.g., `createVectorStore('vectra')`).
3. Implement Vectra class: backend/stores/VectraVectorStore.ts.
4. Add unit tests in backend tests folder if exists, or create one.

### User Story 2: As a system architect, I want memory scopes tied to worlds and characters to prevent knowledge bleed.
#### Tasks (Order: Sequential)
1. Enhance character/persona schemas in migrations to include memory scope references.
2. Update backend logic and scripts (e.g., world associations) to compute scopes (worldId_characterId).
3. Initialize scopes on world/character creation in backend/migration scripts.
4. Test isolation: Add memories in test sessions, verify queries scoped.

### User Story 3: As a VectorizationAgent, I want to capture and store memories from completed rounds.
#### Tasks (Order: Sequential)
1. Create new `VectorizationAgent` (similar to SummarizeAgent) in `backend/src/agents/VectorizationAgent.ts`
   - Extends BaseAgent with agentName 'vectorization'
   - Input: Round context (messages, active characters, world state)
   - Optional: Can have its own LLM profile for custom embedding or just local embeddings
2. Implement round vectorization via Orchestrator hook:
   - After `completeRound()` in Orchestrator, call VectorizationAgent
   - Pass all round messages + activeCharacters list
3. In VectorizationAgent.run():
   - Summarize round (or use raw messages)
   - Generate embeddings using `@xenova/transformers`
   - Store in vector store for each active character with `world_${worldId}_char_${characterId}` scope
   - Mark SceneRounds.vectorized = true
4. Configure storage (e.g., `./vector_data`, git-ignore it)

### User Story 4: As an agent prompt builder, I want to query memories and inject them into prompts based on current context.
#### Tasks (Order: Parallel where possible)
1. In Orchestrator, before calling character agents, query vector memories:
   - Use same context-building pattern as existing lore matching
   - Build query text from user input + sceneSummary
   - Call `vectorStore.query()` for each character's world scope
   - Filter results by minSimilarity threshold
2. Add `vectorMemories` to AgentContext before calling agent.run()
3. Add memory injection section to agent prompt templates (`character.njk`, `narrator.njk`, etc.):
   - Similar format to existing lore injection
   - Optional section (only inject if memories found)
4. Test outputs in simulated sessions with multiple rounds

### User Story 5: As a maintainer, I want utilities for memory management (clear/delete) to handle debugging and resets.
#### Tasks (Order: Sequential)
1. Add admin routes in backend for clear/delete per scope.
2. Implement delete/clear in interface and Vectra.
3. Add logging to backend.
4. Document in .github or setupinstructions.md.

### User Story 6: As a user, I want seamless memory recall in roleplay without manual intervention.
#### Tasks (Order: Integration-focused)
1. End-to-end testing: Full sessions, verify responses use memories.
2. Optimize query params.
3. Log injections for review.
4. Update README.md with feature overview.

This feature fits in 2-4 sprints, ~40-60 hours. Reference .github/agent-design.md for agent integration.