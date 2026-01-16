# Phase 8 Audit Map — Memory Injection & Vectorization

Summary: precise file/callsite map and recommended edits to implement per-character memory retrieval/injection, safe deletes, and revectorize hooks.

Files to change (ordered by priority):

- backend/src/utils/memoryRetriever.ts
  - Key symbols: `MemoryRetriever` class, `getMemoryRetriever()`, `initializeMemoryRetriever()`
  - Change: Add `retrieve(scopeOrOptions)` API supporting `characterId`/`scope`, `MemoryRetrievalOptions` (temporalDecay, queryDepth, conditionalRules). Return raw memory items with metadata and scores; apply temporal decay and conditional boosts after similarity scoring. Remove prompt formatting responsibilities.

- backend/src/agents/Orchestrator.ts
  - Key symbols: agent registration (constructor), `processUserInput` / character-run loops (~lines where `getMemoryRetriever()` is called), VectorizationAgent trigger.
  - Change: For each active character, call `getMemoryRetriever().retrieve({ scope: 'world_${worldId}_char_${charId}', query, options })`. Inject returned raw memories into each character's prompt rendering path (templating layer). Ensure non-active characters are not queried.

- backend/src/agents/VectorizationAgent.ts
  - Key symbols: `run(context)` where `activeCharacters`, `messages`, `sceneId`, `roundNumber` are used; embedding manager usage.
  - Change: Ensure vector metadata includes `campaignId`, `arcId`, `sceneId`, `roundId`, `messageId`, `timestamp` (strings). Compute scope per active char `world_${worldId}_char_${charId}` and call vectorStore.addMemory for each chunk per-scope.

- backend/src/stores/VectraVectorStore.ts
  - Key symbols: `addMemory()`, `query()`, `deleteByMetadata()`, factory `createVectraVectorStore()`
  - Change: Implement/verify `deleteByMetadata(filter, scope?, { dryRun, confirm })`. Implement audit logging to `backend/vector_deletes_audit.jsonl`. Ensure metadata canonicalization to strings. Provide `getStats(scope?)` used by diagnostics.

- backend/src/utils/vectorStoreFactory.ts
  - Key symbols: factory function creating a `VectraVectorStore` instance
  - Change: Ensure config (basePath) and testable injections are supported. Allow passing `basePath` from tests to isolate vector files.

- backend/src/utils/embeddingManager.ts
  - Key symbols: `EmbeddingManager.getInstance()`, `embedText()`, `chunkText()`
  - Change: Read `vectorConfig` for chunkSize/provider; expose deterministic chunking and reset helpers for tests. No functional change to embedding results, but ensure token-based chunking is available.

- backend/src/services/MessageService.ts
  - Key symbols: `logMessage()`, read/select functions used by VectorizationAgent
  - Change: Ensure `messageId`, `roundNumber`, `timestamp` fields are persisted and available to VectorizationAgent. (Note: `charactersPresent` derived from `SceneRounds` already.)

- backend/src/services/SceneService.ts
  - Key symbols: round listing/marking functions used to queue VectorizationAgent
  - Change: Add helpers for `getUnvectorizedRounds(sceneId)` and mark rounds as vectorized; used during revectorize hooks.

- backend/src/server.ts
  - Key symbols: endpoints for regenerate/edit/delete that currently call `VectorizationAgent` (lines ~591, ~963, ~2999)
  - Change: Wire `deleteByMetadata` calls before re-running `VectorizationAgent` during regenerate/edit/reset loops. Support `?dryRun=true` and `?confirm=true` query flags for cross-scope deletes.

- backend/src/utils/memoryHelpers.ts
  - Key symbols: formatting/personalization helpers
  - Change: Add `personalizeMemory(text, characterId, context?)` stub; keep prompt rendering in templating layer.

- frontend/src/components/VectorBrowser.tsx (dev-only)
  - Add UI for scope listing, `deleteByMetadata` (dryRun + confirm), and revectorize triggers using new server endpoints.

Tests to update/add (priority):
- backend/src/__tests__/memory-retriever-*.test.ts — add tests for per-scope retrieval, temporal decay, conditional rules.
- backend/src/__tests__/vector-deleteByMetadata*.test.ts — verify scoped deletes, dryRun, confirm behavior, and audit logging.
- backend/src/__tests__/vectorization-agent.test.ts — verify metadata written and per-character scopes updated.
- Integration: regen/edit/reset flows trigger deleteByMetadata and re-run VectorizationAgent; clean up vector files during test teardown.

Acceptance criteria (short):
- Orchestrator injects per-character memories; active-only scopes queried.
- deleteByMetadata only deletes matching metadata items; requires `confirm` for cross-world deletes; `dryRun` lists matches.
- Revectorize (regen/edit/reset) deletes old vectors by metadata and recreates correct new ones.
- Tests pass and clean up vector files.

Next steps:
1. Implement MemoryRetriever API changes and tests (high-impact).  
2. Update Orchestrator to call MemoryRetriever per-character and inject memories.  
3. Implement Vectra `deleteByMetadata` safety & audit logging.  


