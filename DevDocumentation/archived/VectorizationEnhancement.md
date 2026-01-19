# Feature Improvement: Enhance Vectorization in RoleForge to Match VectHare
*** CRITICAL INSTRUCTION***
 - NEVER ASK TO COMMIT OR GENERATE PULL REQUESTS EVER UNDER ANY CIRCUMSTANCES
## Overview

This document outlines a phased approach to updating the vectorization implementation in RoleForge (https://github.com/Hexmare/RoleForge) to align with the feature set of VectHare (https://github.com/Coneja-Chibi/VectHare). The goal is to add flexibility, advanced RAG capabilities, and integration while maintaining RoleForge's local LLM focus (NodeJS backend, OpenAI-compatible like Kobold).

**Revisions Based on User Feedback**:
- Stick with Vectra as the sole backend for now. Remove support/plans for LanceDB, Qdrant, etc.
- Ensure the connection layer remains abstracted via `VectorStoreInterface.ts` for easy future additions (e.g., implement new classes like `NewBackendVectorStore.ts` and register in `VectorStoreFactory.ts`).
- Vector storage: Maintain per-world-per-character scoping (e.g., `world_${worldId}_char_${characterId}`) for memory separation.
- Emphasize metadata: Include `campaignId`, `arcId`, `sceneId`, `roundId` in every entry's metadata for targeted deletions during resets, regenerations, or edits.
- Handle resets: Add deleteByMetadata to interface for deleting vectors matching criteria (e.g., by sceneId) without full clears.
- Regeneration/Editing: On message/round regen or edit, delete old vectors by metadata (e.g., roundId), then add new ones.
- Memory Separation: During vectorization, add entries only to active characters in the scene (loop over active chars, use their scopes).

Key enhancements include:
- Configurable embeddings (multiple providers).
- Advanced chunking, metadata, decay, re-ranking, and rules.
- Diagnostics and UI elements.
- Full integration with Orchestrator, handling resets/regens/edits via SceneService/Orchestrator hooks.

The plan is divided into **small phases** for incremental implementation. Each phase includes:
- **User Stories**: High-level requirements.
- **Tasks**: Actionable steps for CoPilot (or manual coding).
- **Code Examples**: Snippets in TypeScript/JavaScript.
- **Testing Instructions**: Clear, manual/unit tests to validate each step.

Phases are designed to be independent where possible, with small chunks (e.g., 1-3 tasks per sub-phase) for easy testing and rollback. Assume we're working in the `backend/src/agents/vectorization` directory unless specified. Use existing abstractions like `VectorStoreInterface.ts` and `EmbeddingManager.ts`.

## Recent Implementation Notes (Jan 2026)

- Vectra hardening: `VectraVectorStore` now includes robust init/retry logic, post-insert visibility polling (both Vectra `queryItems` and on-disk `index.json`), and fallbacks to avoid transient ENOENT/index.json races on Windows.
- Deletions: `deleteByMetadata` supports scoped and global deletes with `dryRun`, `confirm` and background job scheduling; deletions are audited to `backend/vector_deletes_audit.jsonl`.
- Job persistence: `backend/src/jobs/jobStore.ts` now sanitizes malformed `backend/data/jobs.json` at startup (backs up corrupt files with timestamped names and recreates a clean jobs file). Writes are serialized using an in-process write-chain to reduce concurrent-writer corruption.
- Tests: Added/updated tests exercise job persistence and vectra behaviors; backend test suite passes locally after these changes.

### Completed (Jan 15, 2026)

 - [x] Converted integration mock embedding test to use async server start/stop and set `process.env.OPENAI_API_KEY = 'test'` so the OpenAI SDK initializes in test runs.
 - [x] Mocked the `openai` SDK in tests to proxy to the local mock server and imported `EmbeddingManager` after the mock server starts to ensure correct baseURL wiring.
 - [x] Added `EmbeddingManager.resetInstances()` usage in vector-related tests to avoid singleton leakage between tests.
 - [x] Made `EmbeddingManager` more tolerant of multiple OpenAI response shapes (handles arrays and nested `data` results).
 - [x] Fixed job persistence logic to back up malformed `backend/data/jobs.json` and added polling/waits in tests to avoid ENOENT races.
 - [x] Cleaned up leftover corrupt job artifact files under `backend/backend/data`.
 - [x] Re-ran the backend test suite locally; all backend tests pass (156 tests) as of Jan 15, 2026.


## Clarifications Applied

The following decisions were provided and will be applied to the implementation and examples in this document:

- **Scope key format:** Use `world_{worldId}_char_{characterId}` where `characterId` is the character UUID (canonical). This avoids breakage if a character's name changes.
- **Metadata fields:** Every vector will include `campaignId`, `arcId`, `sceneId`, and `roundId`. These are currently numeric in the DB (integers) but implementations should accept UUID/string values where applicable.
- **Timestamps and IDs:** Include a `timestamp` (epoch ms) on vector items for aging/decay. `messageId` and `speakerId` are optional; speakerId may be omitted for vectorized summarizations (e.g., lore entries) but can be added when available for traceability.
- **Deletion semantics:** `deleteByMetadata` will support both scoped deletes (single `world_X_char_Y`) and cross-scope/global deletes by metadata. Filters will perform exact matches on the provided metadata fields (i.e., `Partial<Metadata>` matching, but values must match exactly when present).
  - **Approval mechanism:** use a `dryRun` mode plus an explicit confirmation flag (e.g., `?confirm=true`) for cross-world deletes.
- **Config location & defaults:** Use `backend/config/vectorConfig.json`. Storage remains Vectra (fixed), embedding provider default is `transformers` (local Xenova), with optional providers `openai` and `ollama` supported via configuration.
- **Chunk size units:** `chunkSize` is measured in **tokens**.
- **Temporal decay units:** `temporalDecay.halfLife` will be interpreted in terms of **message count** by default (i.e., number of messages influencing perceived age). Retrieval logic will use the `timestamp` and/or message-based metrics depending on configuration.
- **Provider priority:** Default priority: local `transformers` → `openai` → `ollama`.
- **Embedding manager design:** Implement a single `EmbeddingManager` with a provider strategy (factory) to support provider switching via config.
- **Active characters & personalization:** For Phase 1, store the same embedding text under each active character's scope. A `personalizeMemory()` stub/hook will be provided so future personalization per-character can be added without major refactors.
- **Default chunk strategy:** Use `perRound` as the default for initial deployment; `perScene` and `perMessage` remain supported.
- **Sliding window overlap:** For `perRound`/`perScene` chunking, use a configurable sliding window overlap (default **20%**).
- **Vectra deletion approach:** `VectraVectorStore.deleteByMetadata` may iterate the index items/files and filter by `item.metadata` to find matches for deletion (acceptable approach given Vectra's local index access patterns).
- **Decay application point:** Apply temporal decay in `MemoryRetriever.queryMemories()` after similarity scoring; make decay settings overridable per-query via `options.temporalDecay`.
- **Conditional rules schema:** Start with `{ field: 'metadata.keywords', match: 'silver', boost: 1.5 }` style objects for `conditionalRules`.
- **Diagnostics fields:** Backend diagnostic endpoints should return at minimum: `scope name`, `memory count`, `size on disk`, `lastUpdated`.

### Conditional Rules Examples
Below are practical rule shapes and explanations. Rules are evaluated per-memory and matching rules multiply their `boost` values together (multiplicative stacking).

- Basic metadata substring match

```json
{ "field": "metadata.keywords", "match": "silver", "boost": 1.5 }
```

- Exact metadata match (use `matchType: 'exact'` when you need identity checks)

```json
{ "field": "metadata.npcRole", "match": "Merchant", "boost": 2, "matchType": "exact" }
```

- Nested metadata field (dot-notation)

```json
{ "field": "metadata.tags.campaignTag", "match": "holiday_event", "boost": 1.25 }
```

- Match against the memory text itself

```json
{ "field": "text", "match": "betrayed", "boost": 2 }
```

- Match inferred emotion from memory text (falls back to simple keyword detector when `metadata.emotion` missing)

```json
{ "field": "emotion", "match": "sad", "boost": 1.6 }
```

- Downrank / penalize using boost < 1

```json
{ "field": "metadata.isDeprecated", "match": "true", "boost": 0.5, "matchType": "exact" }
```

- Combined example for config (mix of metadata/text/emotion rules)

```json
"conditionalRules": [
  { "field": "metadata.keywords", "match": "silver", "boost": 1.5 },
  { "field": "text", "match": "betrayed", "boost": 2 },
  { "field": "emotion", "match": "angry", "boost": 1.4 }
]
```

Notes:
- `field` supports dot-notation for nested metadata and the special top-level keys `text` and `emotion`.
- `matchType` may be `substring` (default) or `exact`.
- `boost` is multiplicative across matching rules. To penalize, use a boost between 0 and 1.
- Rules are applied after temporal decay, so boosts affect already time-adjusted similarity scores.
- Keep rules focused; large rule sets may affect retrieval latency.
- **Tests policy:** Mock only necessary parts in unit tests. Tests must clean up any data they create and must not delete real game data during CI or dev runs.
- **Backwards compatibility:** Do not add runtime support for legacy name-based scopes; prefer revectorization to rebuild outdated vectors.
- **Memory formatting:** Move presentation/formatting of memories into templating logic; `MemoryRetriever` should return raw memory items and metadata for templates to render.

Additional answers from the continuation file:

- **Metadata storage canonicalization:** Store all metadata fields as strings in vector entries for robustness (accept integer/UUID input, normalize to string when saving).
- **`messageId` inclusion:** Include `messageId` on vector items to allow precise edit/regenerate tracing (this is required).
- **Temporal decay computation note:** Message-count-based decay (halfLife in message count) is acceptable but requires counting messages in the DB since the vector was created and filtering by characters present. For Phase 1, implement time-based decay (using the `timestamp` on vectors) as the default and add an optional message-count mode (which uses DB counts) as an advanced option due to complexity.
- **Delete behavior and safety:** When a delete operation would cross world boundaries (i.e., affect multiple worlds), require an explicit approval flag or an admin confirmation step before performing the deletion. Implement a `dryRun` mode that returns the list of matching scopes/items without deleting them.
- **Revectorize existing data:** A manual revectorize-by-scene tool already exists and is sufficient; no mass automatic migration in Phase 1.
- **`personalizeMemory()` hook signature:** Use `(text: string, characterId: string, context?: any) => Promise<string>` as the hook; default implementation is pass-through.
- **`conditionalRules` matching:** Support nested field matching (e.g., `metadata.keywords`) and configurable matching semantics (exact or substring), controlled via the rule object.
- **Diagnostics endpoint auth:** There is no auth system yet; diagnostics endpoints will be left unprotected for now (dev-only). Mark them clearly in docs/UI as developer/admin tooling.

These clarifications are applied throughout the phase details below. Where behavior depends on configuration, Phase tasks will reference `backend/config/vectorConfig.json` and `EmbeddingManager` usage.

Commit after each sub-phase for version control.

---

## Phase 1: Config Enhancements

### User Stories
- As a developer, I want configurable vectorization options (providers, chunking, decay) so I can customize RAG without code changes.
- As an admin, I want to load configs from JSON to easily tweak settings for different environments.

### Sub-Phase 1.1: Add Basic Vector Config File
#### Tasks
 - [x] Create a new file `backend/config/vectorConfig.json` with default settings (exclude backend options since fixed to Vectra).
 - [x] Update `backend/src/config.ts` to load and merge this with existing config.

#### Code Examples
- `backend/config/vectorConfig.json`:
```json
{
  "embeddingProvider": "transformers",
  "embeddingModel": "Xenova/all-mpnet-base-v2",
  "apiKeys": {},
  "chunkStrategy": "perMessage",
  "chunkSize": 512,
  "temporalDecay": {
    "enabled": false,
    "mode": "exponential",
    "halfLife": 50,
    "floor": 0.3
  },
  "scoreThreshold": 0.5,
  "queryDepth": 10,
  "conditionalRules": []
}
```
- `backend/src/config.ts` (add to existing loadConfig function):
```typescript
import fs from 'fs';
import path from 'path';

// ... existing code ...

export function loadConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
  const vectorConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/vectorConfig.json'), 'utf-8'));
  return { ...config, vector: vectorConfig };
}
```

#### Testing Instructions
1. Run `npm start` (or backend server). Log `config.vector` in `server.ts` startup.
2. Verify console shows default values (e.g., `embeddingProvider: 'transformers'`).
3. Edit `vectorConfig.json` (change `chunkStrategy` to 'perRound'), restart server, confirm change loads.
4. Unit test: Add to `__tests__/config.test.ts`: `expect(loadConfig().vector.embeddingProvider).toBe('transformers');`.

### Vector Config Fields (reference)

Location: `backend/config/vectorConfig.json`

Brief: centralizes vectorization settings. The backend loads this file via `ConfigManager.getVectorConfig()`; `getEmbeddingManager()` and `EmbeddingManager` read `embeddingModel` and `chunkSize` respectively.

- `embeddingProvider` (string): Provider to use for embeddings. Examples: `transformers` (default, local Xenova), `openai`, `ollama`.
- `embeddingModel` (string): Model identifier used by the provider (e.g., `Xenova/all-mpnet-base-v2`). `getEmbeddingManager()` uses this to instantiate the `EmbeddingManager`.
- `apiKeys` (object): Provider API keys when using remote providers (e.g., `{ "openai": "sk-..." }`). Kept empty for local `transformers`.
- `chunkStrategy` (string): One of `perMessage` | `perRound` | `perScene`. Controls how text is chunked prior to embedding. Default in examples: `perRound`.
- `chunkSize` (number): Size used by `EmbeddingManager.chunkText()` (units: characters by default in current impl; treat as configurable chunk unit). `EmbeddingManager.getDefaultChunkSize()` reads this value.
- `slidingWindowOverlap` (number): Fraction (0-1) for overlap between adjacent chunks when applicable (default 0.2 = 20%).
- `temporalDecay` (object): Controls decay behavior applied during retrieval.
  - `enabled` (boolean)
  - `mode` (string): `time` or `messageCount` (Phase 1 defaults to `time`).
  - `halfLife` (number): Half-life units (seconds or message count depending on `mode`).
  - `floor` (number): Minimum decay multiplier (e.g., 0.3).
- `scoreThreshold` (number): Minimum similarity score to consider a memory relevant for retrieval (0-1).
- `queryDepth` (number): Default `topK` when querying if not specified in call.
- `conditionalRules` (array): Rule objects for boosting/filtering retrieval results. Example rule: `{ "field": "metadata.keywords", "match": "silver", "boost": 1.5 }`.

Notes:
- Path: update `backend/config/vectorConfig.json` and restart the backend to apply changes.
- `EmbeddingManager`: reads `chunkSize` via `ConfigManager.getVectorConfig()` (used in `getDefaultChunkSize()`); `getEmbeddingManager()` reads `embeddingModel` to choose the model.
- Backwards compatibility: if `vectorConfig.json` is missing or malformed, `ConfigManager` falls back to sensible defaults and logs a warning.


### Sub-Phase 1.2: Inject Config into Existing Classes
#### Tasks
 - [x] Update `EmbeddingManager.ts`, `VectorStoreFactory.ts` (set to Vectra always), and `VectorizationAgent.ts` to accept/use config from global load.
 - [x] Ensure fallback to defaults if config missing.

#### Code Examples
- `backend/src/agents/vectorization/EmbeddingManager.ts` (modify constructor):
```typescript
import { loadConfig } from '../../config';

export class EmbeddingManager {
  private config: any;

  constructor() {
    this.config = loadConfig().vector;
  }

  // ... rest unchanged
}
```
- `VectorStoreFactory.ts`: Hardcode to Vectra but keep factory for abstraction:
```typescript
export function createVectorStore(config: any): VectorStoreInterface {
  return new VectraVectorStore(config);  // Fixed to Vectra; add cases here for future backends
}
```

#### Testing Instructions
1. In `VectorizationAgent.ts`, log `this.config.embeddingProvider`.
2. Run a test round (via API `/api/scenes/:sceneId/chat`), check logs show correct config.
3. Break config file (invalid JSON), verify app starts with error handling (e.g., default empty config).
4. Integration test: Existing vector tests should pass unchanged.

---

## Phase 2: Multiple Embedding Providers

### User Stories
- As a user, I want support for multiple embedding providers (local Transformers, OpenAI-compatible, Ollama) to choose based on hardware.
- As a developer, I want a factory pattern for easy provider switching.

### Sub-Phase 2.1: Add OpenAI-Compatible Provider
#### Tasks
1. [x] Install `openai` npm package: `npm i openai`.
2. [x] Extend `EmbeddingManager.ts` to support 'openai' provider with API config.

#### Code Examples
- `EmbeddingManager.ts` (add to static getInstance and embedText):
```typescript
import OpenAI from 'openai';

static getInstance(provider: string, config: any) {
  // ... existing
  case 'openai':
    embedder = new OpenAI({ apiKey: config.apiKeys.openai, baseURL: config.baseURL || 'https://api.openai.com/v1' });
    break;
}

async embedText(text: string): Promise<number[]> {
  // ... existing
  case 'openai':
    const resp = await embedder.embeddings.create({ model: this.config.embeddingModel, input: text });
    return resp.data[0].embedding;
}
```

#### Testing Instructions
1. Set config `embeddingProvider: 'openai'`, add fake `apiKeys: { openai: 'sk-fake' }`, `baseURL: 'http://localhost:5000/v1'` (for Kobold mock).
2. [x] Mock server (use Postman or separate script) to return dummy embedding [0.1, 0.2].
3. [x] Call `embedText('test')` in a test script, verify returns array.
4. Unit test: `expect(await manager.embedText('hello')).toBeInstanceOf(Array);`.

### Sub-Phase 2.2: Add Ollama Provider
#### Tasks
1. [x] Install `ollama` npm package: `npm i ollama`.
2. [x] Extend `EmbeddingManager.ts` for 'ollama'.

#### Code Examples
- `EmbeddingManager.ts`:
```typescript
import ollama from 'ollama';

static getInstance(provider: string, config: any) {
  case 'ollama':
    embedder = ollama;
    break;
}

async embedText(text: string): Promise<number[]> {
  case 'ollama':
    const resp = await ollama.embeddings({ model: this.config.embeddingModel, prompt: text });
    return resp.embedding;
}
```

#### Testing Instructions
1. Set config `embeddingProvider: 'ollama'`, ensure Ollama running locally.
2. Test embedText with real Ollama, verify dimension matches (e.g., 768).
3. If Ollama down, verify graceful error (e.g., fallback log).
4. Unit test: Mock ollama response, assert array length.

### Sub-Phase 2.3: Provider Switching Integration
#### Tasks
1. [x] Update `VectorizationAgent.ts` to use new EmbeddingManager with config.
2. [x] Add error handling for unsupported providers.

#### Code Examples
- `VectorizationAgent.ts`:
```typescript
const embeddingManager = new EmbeddingManager();  // Now config-aware
const embedding = await embeddingManager.embedText(memoryText);
```

#### Testing Instructions
1. Switch providers in config, run full vectorization flow.
2. Verify embeddings stored (check `./vector_data` files grow).
3. Test invalid provider: Set to 'invalid', expect throw/log.
4. Integration test: Run scene chat, query memory, confirm works across providers.

---

## Phase 3: Enhanced Metadata & Scoped Storage

### User Stories
- As a developer, I want metadata (campaignId, arcId, sceneId, roundId) in vectors for targeted deletions during resets/regens/edits.
- As a roleplayer, I want strict separation of memories per character per world, only adding to active characters.

### Sub-Phase 3.1: Extend Metadata in Add/Query
#### Tasks
- [x] Update `VectorStoreInterface.ts` to require metadata object in addMemory (include campaignId, arcId, sceneId, roundId).
- [x] Update `VectraVectorStore.ts` to store/retrieve metadata (Vectra supports item.metadata).

#### Code Examples
- `VectorStoreInterface.ts`:
```typescript
interface MemoryItem {
  embedding: number[];
  metadata: {
    campaignId: string;
    arcId: string;
    sceneId: string;
    roundId: string;
    // Other fields like keywords, temporalBlind
  };
}

async addMemory(item: MemoryItem, scope: string): Promise<void>;
async query(embedding: number[], scope: string, options: any): Promise<{ score: number; metadata: any }[]>;
```

#### Testing Instructions
1. Add item with metadata, query, verify metadata returned.
2. Unit test: Mock add/query, assert metadata preserved.

### Sub-Phase 3.2: Per-Character Scoping & Active-Only Addition
#### Tasks
- [x] In `VectorizationAgent.ts` run(): Get activeCharacters from context, loop over them, compute scope = `world_${worldId}_char_${charId}`, add to each with shared metadata.
- [x] Ensure non-active chars skipped.

#### Code Examples
- `VectorizationAgent.ts`:
```typescript
async run(context: any) {
  const { activeCharacters, worldId, campaignId, arcId, sceneId, roundId, messages } = context;
  const metadata = { campaignId, arcId, sceneId, roundId, keywords: extractKeywords(messages.join('\n')) };
  // Compute chunks...
  for (const char of activeCharacters) {
    const scope = `world_${worldId}_char_${char.id}`;
    for (const chunk of chunks) {
      const embedding = await this.embeddingManager.embedText(chunk.text);
      await this.vectorStore.addMemory({ embedding, metadata }, scope);
    }
  }
}
```

#### Testing Instructions
1. Mock context with 2 active/1 inactive chars, run agent, verify only 2 scopes updated (check file existence in `./vector_data`).
2. Query non-active scope, expect empty.
3. Integration: Run scene with chars, confirm separation.

---

## Phase 4: Chunking Strategies & Metadata Integration

### User Stories
- As a roleplayer, I want flexible chunking (per message/round/scene) for better memory relevance.
- As a dev, I want metadata for filtering/deletion.

### Sub-Phase 4.1: Implement Chunk Strategies
#### Tasks
1. [x] Update `VectorizationAgent.ts` run() to handle strategies (e.g., 'perRound' concatenates messages).
2. [x] Add `extractKeywords` util.

#### Code Examples
- `VectorizationAgent.ts` (switch on chunkStrategy):
```typescript
let chunks = [];
switch (this.config.chunkStrategy) {
  case 'perMessage':
    chunks = messages.map(msg => ({ text: msg.content }));
    break;
  case 'perRound':
    chunks = [{ text: messages.join('\n') }];
    break;
  // Add 'perScene' etc.
}
// Add metadata to each chunk
```
- `utils/keywordExtractor.ts`:
```typescript
export function extractKeywords(text: string): string[] {
  return text.split(' ').filter(w => w.length > 3);  // Basic
}
```

#### Testing Instructions
1. Set strategy 'perRound', run round, verify single chunk added per active char.
2. Query log: Check metadata has roundId.
3. Unit test: Mock messages, assert chunks length.

---

## Phase 5: Deletion by Metadata for Resets/Regens/Edits

### User Stories
- As a user, I want to reset campaign/arc/scene without losing unrelated memories.
- As a dev, I want hooks for regen/edit to delete/regenerate vectors.

### Sub-Phase 5.1: Add deleteByMetadata to Interface
#### Tasks
 - [x] Extend `VectorStoreInterface.ts` with deleteByMetadata (filter: Partial<Metadata>).
 - [x] Implement in `VectraVectorStore.ts`: Query all, filter by metadata, delete matching IDs.

#### Code Examples
- `VectorStoreInterface.ts`:
```typescript
async deleteByMetadata(filter: Partial<{ campaignId: string; arcId: string; sceneId: string; roundId: string }>, scope: string): Promise<void>;
```
- `VectraVectorStore.ts`:
```typescript
async deleteByMetadata(filter: any, scope: string) {
  await this.init(scope);
  const items = await this.index.listItems();  // Vectra method
  for (const item of items) {
    if (matchesFilter(item.metadata, filter)) {  // Custom matches func
      await this.index.deleteItem(item.id);
    }
  }
}
```

#### Testing Instructions
1. Add items with different roundIds, delete by {roundId: '1'}, verify only matching gone.
2. Unit test: Mock list/delete, assert called for matches.

### Sub-Phase 5.2: Integrate with Resets/Regens/Edits
#### Tasks
 - [x] In `SceneService.ts` or `Orchestrator.ts`: On reset (campaign/arc/scene), call deleteByMetadata({campaignId/arcId/sceneId}, all relevant scopes).
 - [x] On regen message/round: Delete by {roundId}, then re-run VectorizationAgent for that round.
 - [x] On edit message: Same as regen.

#### Code Examples
- `Orchestrator.ts` (e.g., in regenerateMessage):
```typescript
async regenerateMessage(sceneId: string, roundId: string, messageId: string) {
  // ... existing
  const scopes = activeCharacters.map(char => `world_${worldId}_char_${char.id}`);
  for (const scope of scopes) {
    await vectorStore.deleteByMetadata({ roundId }, scope);
  }
  // Re-vectorize updated round
  const agent = new VectorizationAgent();
  await agent.run({ ...context, messages: updatedMessages });
}
```

#### Testing Instructions
1. Create round, vectorize, regen, verify old deleted, new added.
2. Reset scene: Delete by sceneId, confirm unrelated (other scenes) remain.
3. Integration: API call `/api/scenes/:sceneId/messages/regenerate`, check vector files updated.

---

## Phase 6: Temporal Decay & Re-ranking

### User Stories
- As a user, I want temporal decay so recent memories prioritize.
- As a dev, I want re-ranking for better RAG accuracy.

### Sub-Phase 6.1: Implement Decay in Retriever
#### Tasks
- [x] Update `MemoryRetriever.ts` retrieve() with decay calc (use timestamp in metadata for age).
- [x] Add getAge func.

#### Code Examples
- `MemoryRetriever.ts`:
```typescript
// In retrieve: After query, map results
results = results.map(res => {
  if (!options.temporalDecay.enabled || res.metadata.temporalBlind) return res;
  const age = Date.now() - res.metadata.timestamp;  // Add timestamp on add
  let decayFactor = Math.pow(0.5, age / (options.temporalDecay.halfLife * 86400000));  // Days to ms
  res.score *= Math.max(decayFactor, options.temporalDecay.floor);
  return res;
});
```

#### Testing Instructions
1. Add old/new, query, verify decayed scores.
2. Set enabled:false, unchanged.
3. Unit: Mock, assert sorted.

### Sub-Phase 6.2: Add Re-ranking with Rules
#### Tasks
- [x] Implement applyBoost for `conditionalRules` (check `metadata.keywords`/emotions).
- [x] Add emotion detection if needed.

#### Code Examples
- Similar to previous: Boost if matches rule.

#### Testing Instructions
1. Config rules, add matching, query, verify boosted.
2. Edge: No rules, same.

---

## Phase 7: Diagnostics & UI

- [x] Phase 7 complete — diagnostics endpoint and UI components implemented

### User Stories
- As an admin, I want diagnostics for vector health (e.g., count by scope/metadata).
- As a user, I want UI to view/edit chunks.

### Sub-Phase 7.1: Backend Diagnostics Endpoint
#### Tasks
- [x] Add `/api/diagnostics/vector` in `server.ts` (include scope/metadata filters).
- [x] Implement getStats with metadata count.

#### Code Examples
- `server.ts`:
```typescript
app.get('/api/diagnostics/vector', async (req, res) => {
  const stats = await vectorStore.getStats(req.query.scope);  // Extend interface
  res.json({ healthy: true, stats });
});
```

#### Testing Instructions
1. Curl, verify JSON (e.g., item count).
2. Break, expect false.

### Sub-Phase 7.2: Frontend UI Components
#### Tasks
- [x] Add React component for vector browser (list by scope/metadata, delete).
- [x] API for edit (trigger regen).

#### Code Examples
- `frontend/src/components/VectorBrowser.tsx`: Fetch/display, buttons for deleteByMetadata.

#### Testing Instructions
1. Load UI, view chunks by sceneId.
2. Delete via UI, verify gone.

---

## Phase 8: Integration & Testing

### User Stories
- As a tester, I want comprehensive tests for metadata/deletion.
- As a user, I want seamless injection with separation.

### Sub-Phase 8.1: Memory Injection at Character Callsites
#### Requirement
When preparing to memory-inject for a character, injection MUST occur immediately before that character's agent is invoked so the agent receives the complete round message history up to that turn. This ensures correct turn-by-turn context in multi-character rounds and must also apply to continue-round flows (where there may be no new user input). Do not rely solely on `processUserInput` for injection.

Example flow:
- Scene participants: `User`, `CharA`, `CharB`.
- User says: "hello"
- `CharA` is called first. `CharA` should receive: `user: hello` and then respond (e.g., "Hi!").
- `CharB` is called next. `CharB` should receive: `user: hello\nCharA: Hi!` (i.e., full round history) before its agent runs.

#### Tasks
1. Implement per-character pre-call memory injection in the Orchestrator's character-run loop (immediately before each character agent execution). Do NOT place injection only in `processUserInput`.
2. Ensure continue-round flows (no user input) perform the same per-character pre-call injection.
3. Retrieve memories using a scoped call such as `memoryRetriever.retrieve({ scope: `world_${worldId}_char_${charId}`, options })` and inject raw memories into the character's prompt/template immediately before agent execution.
4. Ensure injection uses the latest persisted messages so regenerate/edit/parallel flows reflect current DB state.

#### Code Examples (pseudocode)
```ts
for (const char of activeCharactersInOrder) {
  const scope = `world_${worldId}_char_${char.id}`;
  const memories = await memoryRetriever.retrieve({ scope, query: roundText, options });
  const prompt = renderCharacterPrompt(basePrompt, memories);
  const response = await charAgent.run(prompt);
  // persist response and continue
}
```

#### Testing Instructions
1. Replay a multi-character round: verify each character sees the full prior messages when their agent runs.
2. Continue-round test: run a round without new user input and verify per-character injection still occurs before each agent call.
3. Edge cases: test concurrent character runs and ensure injection is per-call and reflects the latest DB state.

### Sub-Phase 8.2: Full Test Suite Expansion
#### Tasks
1. Add tests for metadata/delete (jest).
2. Coverage: 90%.

#### Code Examples
- `__tests__/vector.test.ts`: Test deleteByMetadata, scoping.

#### Testing Instructions
1. `npm test`, fix.
2. Manual: Full flow with reset/regen/edit.