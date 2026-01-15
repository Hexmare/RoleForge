# Vectorization Enhancement - Clarifications Required

This file lists clarification questions and concrete implementation choices needed before we start coding the enhancements described in `VectorizationEnhancement.md`.
Please answer the numbered questions so I can proceed with an accurate implementation plan and PR-ready changes.

-- Quick summary of what I checked in the codebase before writing questions:
- `backend/src/utils/memoryRetriever.ts` supports `characterId` and `characterName`, and queries scopes of the form `world_{worldId}_char_{charIdOrName}`.
- `backend/src/stores/VectraVectorStore.ts` exposes `getStats()`; there is no `getAllScopes()` or `deleteByMetadata()` implemented today.
- `backend/src/agents/VectorizationAgent.ts` exists and currently uses `world_${worldId}_char_${characterName}` style scope construction (reviewed earlier).
- `EmbeddingManager` (used by vectorization code) exists; provider switching is limited today.

---

General clarifications (affecting multiple phases)
1. Scope key format
   - Q1.1: Confirm canonical scope format should be `world_{worldId}_char_{characterId}` (character UUID), not character name. If names are allowed, should both be supported? Current code and existing vectors appear to use character ID in practice. ---> Keep this as characterID, this will allow linking still even if the name of the character changes. We can create a helper to identify character name from character ID.

2. Metadata shape and types
   - Q2.1: What exact metadata fields must be present on every vector item? The document lists `campaignId`, `arcId`, `sceneId`, `roundId`. Please confirm keys and whether they are numeric or string types. --> Currently they are Integers, however we should be prepared to allow for UUID's
   - Q2.2: Should each vector also include `timestamp` (ISO string or epoch ms), `messageId`, and `speakerId`? These are needed for decay, precise deletions, and traceability. --> Timestamp would be good for memory aging. I am not sure about speaker ID, because we will be adding vectorized summarizations. Vectorized Lore entries which would not have a specific speaker. 

3. Deletion semantics
   - Q3.1: For the `deleteByMetadata` operation: should it operate within a single scope only (i.e., delete from `world_X_char_Y`), or across all scopes (global delete by sceneId)? The doc mentions both use-cases. --> Delete by metadata should support both use cases, with filtering based on Campaignid, Arcid, Sceneid, sceneID RoundID
   - Q3.2: When deleting by metadata (e.g., sceneId or roundId), do we delete all vectors whose metadata matches exactly, or should the filter be partial (match any provided keys)? Prefer `Partial<Metadata>` matching. Confirm. --> When we are deleting by metadata we will be looking for EXACT matches.

4. Config location & defaults
   - Q4.1: Confirm preferred config file path: `backend/config/vectorConfig.json` (per doc). If different, provide preferred path. --> This will work for now.
   - Q4.2: Confirm default provider: the doc suggests `transformers` (local). Do you want `vectra` only for storage and `transformers` as default embedding provider? Or support 'openai'/'ollama' as possible production options but default to local? --> Vectra will be the storage, however I want there to be an abstracted storage interface used, so that we can easily add different storage options in the future. For the embeddings the default will be the transformers. Currently implemented using ("@xenova/transformers": "^2.17.2") , be mindful that we had to make sure that Xenova was putting out vectors and not scalars. I do want us to have the ability to configure an ollama / openai connection to use as an alternative embedding agent.

Phase-specific clarifications

Phase 1 — config & injection
5. Vector config keys
   - Q5.1: For `chunkSize` and `chunkStrategy`, what units should be used? (chunkSize: characters, tokens, or words?) Suggested default: tokens. --> Use tokens
   - Q5.2: For `temporalDecay.halfLife` the doc mentions `50` — is that days? hours? Please confirm units. --> this is message count. This may be difficult to identify , given that it would be number of messages that the character had been involved in / present for. 

Phase 2 — multiple embedding providers
6. Provider support
   - Q6.1: Which providers must be implemented now (minimal): `transformers` (local xenova), `openai` (Kobold/OpenAI-compatible), and `ollama`? Confirm which to prioritize. --> Local is top priority, then open AI , then ollama
   - Q6.2: For OpenAI-compatible provider, do you want to reuse `backend/src/llm/client.ts` patterns or create a separate `EmbeddingManager` provider layer? Preferred design: one EmbeddingManager with provider strategy. --> yes we would need this layer, that way we can have configuration profiles that we can configure and select from the front end. 

Phase 3 — metadata and scoping
7. Active characters handling
   - Q7.1: When vectorizing a round, should the same embedding text be stored under each active character's scope, or should we transform the snippet (e.g., personalize) per character? Doc implies storing same memory under each active character; confirm. --> this is a very good question. I have been thinking about this strategy just this morning. Right now we can start with using the same embedding text. However, We should be able to hook into this so that we can have a personalization route. This could in fact be a stub routine where the text is sent to a method call called "PersonalizeMemory" or whatever , where the text is sent to the method, but just immediately returns the text without change. This would provide us a function that can be overriden later without major refactors.

Phase 4 — chunking
8. Chunking strategies
   - Q8.1: List supported strategies required at MVP: `perMessage`, `perRound`, `perScene`. Are there others? Confirm the desired default (doc suggests `perMessage`). --> The default would be per round, as this would give the most context. However, I would like to have the per scene strategy also available, as this would be hooked to summarization and allow for a complete scene summary to be vectorized.
   - Q8.2: For `perMessage` handling of very long messages, should we split by tokens into multiple chunks (sliding window?) — if yes, confirm overlap percent (suggest 20%). --> Lets not worry about doing per message. BUT the sliding window strategy would be very good for perRound and perScene, with a configurable overlap which can start with 20%.

Phase 5 — deletion by metadata
9. Implementation expectations
   - Q9.1: Should `VectraVectorStore.deleteByMetadata(filter, scope?)` be implemented by reading index items and matching `item.metadata`? Vectra's LocalIndex API may not export listing methods in the wrapper – confirm we should implement iteration over saved files. --> This could be a viable solution. 

Phase 6 — temporal decay & reranking
10. Decay and re-ranking config
   - Q10.1: Confirm whether decay should be applied in `MemoryRetriever.queryMemories()` after similarity scoring (recommended), and whether decay should be configurable per-query via `options.temporalDecay`. --> Yes apply in queryMemories() , and make it configurable so that it can be suited to the users wishes. 
   - Q10.2: Confirm `conditionalRules` schema (array) format. Example suggested: `{ field: 'metadata.keywords', match: 'silver', boost: 1.5 }`. Approve or provide preferred schema. --> I approve of this to start. We may need to extend later. 

Phase 7 — diagnostics & UI
11. UI expectations
   - Q11.1: Confirm minimal diagnostic fields required in backend endpoint: `scope name`, `memory count`, `size on disk`, `lastUpdated` (optional). Anything else?  --> take a look at frontend\src\components\DebugVectorPanel.tsx this is the current debug panel. We need to make sure that all of this is supported. It is very useful to view what is in vector storage. 

Phase 8 — integration & testing
12. Tests & coverage
   - Q12.1: Minimum acceptable tests: unit tests for `VectorStoreInterface` methods (add/query/deleteByMetadata), integration test for `VectorizationAgent.revectorizeScene(sceneId, clearExisting)`. Confirm acceptance criteria and whether mocking vectra is acceptable. --> Mock only what you have to . However make sure that ALL tests clean up what they have created, WITHOUT causing data loss from actual game data. 

Other implementation notes & choices
- O1: Backwards compatibility — older vectors may use characterName in scopes. Should retrieval attempt both `charId` and `characterName` scopes when characterId is provided and nothing is found? (recommended fallback) --> we have revectorize functionality that should be maintained. With this we will be able to rebuild old vectors. We don't need the overhead and complexity of supporting the old formats.
- O2: Templating — confirm if vector memories should continue to be pre-formatted by `MemoryRetriever.formatMemoriesForPrompt()` or moved into template logic for more control. --> OMG!!! Move it to a template logic. This is PHENOMENAL!!! GREAT IDEA!

Please populate answers below (replace `TODO` with your response):

Answers:

All of my answers are inline with your questions after --> 

---

Once you fill the answers I'll: 
1. Update `VectorizationEnhancement.md` implementation plan details where needed.
2. Implement the lowest-risk Phase 1 changes (config file + config injection), add tests, and open a branch/PR.

Thanks — answer the questions and I'll continue with implementation.
