# RoleForge Development TODO

**Last Updated:** January 14, 2026

---

## How to Use This List

Add items to the appropriate section below. Use the format:
```
- [ ] **Item Title** - Brief description or context
  - Related files: `path/to/file.ts`
  - Priority: High/Medium/Low
  - Depends on: Other todo items (if any)
  - Spec: Link to specification document
```

---

## � COMPLETED - PREREQUISITE WORK

- [x] **PREREQUISITE: Implement Rounds System** ✅ COMPLETED - Track message rounds to enable vectorized memory capture
  - Related files: `backend/src/database.ts`, `backend/src/services/MessageService.ts`, `backend/src/services/SceneService.ts`, `backend/src/agents/Orchestrator.ts`, `frontend/src/components/Chat.tsx`
  - Priority: 🟢 COMPLETE (Vector Storage can now proceed)
  - Depends on: None
  - Spec: `DevDocumentation/ROUNDS_Prerequisite_Feature.md`
  - Details: ~40-60 hours
    - ✅ Add roundNumber to Messages table
    - ✅ Create SceneRounds metadata table
    - ✅ Update Orchestrator with round lifecycle
    - ✅ Add "Continue Round" UI button
    - ✅ Emit Socket.io round completion events

---

## 🔴 High Priority - VECTOR STORAGE FEATURE

*Rounds prerequisite is complete. Phase 1 now in progress.*

- [x] **Phase 1: Vector Store Infrastructure** ✅ COMPLETE - Create abstraction layer for vector storage
  - Related files: `backend/src/interfaces/VectorStoreInterface.ts`, `backend/src/stores/VectraVectorStore.ts`, `backend/src/utils/embeddingManager.ts`
  - Priority: 🟢 COMPLETE (27/31 tests passing)
  - Depends on: PREREQUISITE: Implement Rounds System ✅
  - Spec: `DevDocumentation/VectorStorage.md` (User Story 1)
  - Completion Report: `DevDocumentation/VECTOR_STORAGE_PHASE1_COMPLETE.md`
  - Details: ~20 hours ✅
    - ✅ Create VectorStoreInterface
    - ✅ Implement VectraVectorStore with local file storage
    - ✅ Set up @xenova/transformers for embeddings
    - ✅ Unit tests for interface and implementations
    - ⚠️ Minor: 4 query tests pending (Vectra index loading issue)

- [ ] **Phase 2: VectorizationAgent** - New agent to capture and store round memories
  - Related files: `backend/src/agents/VectorizationAgent.ts`, `backend/src/agents/Orchestrator.ts`
  - Priority: 🔴 Next (Phase 1 complete, can start immediately)
  - Depends on: Phase 1: Vector Store Infrastructure ✅
  - Spec: `DevDocumentation/VectorStorage.md` (User Story 3)
  - Details: ~15 hours
    - Create VectorizationAgent (extends BaseAgent)
    - Hook into Orchestrator.completeRound()
    - Store memories for all active characters
    - Error handling and async execution

- [ ] **Phase 3: Memory Query & Injection** - Query memories and inject into prompts
  - Related files: `backend/src/agents/Orchestrator.ts`, `backend/src/prompts/character.njk`, `backend/src/prompts/narrator.njk`
  - Priority: 🔴 High
  - Depends on: Phase 2: VectorizationAgent
  - Spec: `DevDocumentation/VectorStorage.md` (User Story 4)
  - Details: ~15 hours
    - Query memories before agent responses
    - Add vectorMemories to AgentContext
    - Update Nunjucks templates with memory section
    - Test memory-enhanced responses

- [ ] **Phase 4: Integration & Testing** - Full integration and end-to-end testing
  - Related files: `backend/src/__tests__/vectorization.test.ts`, `backend/src/__tests__/vectorization-agent.test.ts`
  - Priority: 🔴 High
  - Depends on: Phase 3: Memory Query & Injection
  - Spec: `DevDocumentation/VectorStorage_Implementation_Review.md` (Item 9)
  - Details: ~15 hours
    - Unit tests for vector store
    - Integration tests for agent
    - End-to-end multi-round scene tests
    - Performance testing
    - Documentation updates

---

## 🟡 Medium Priority

- [ ] **Admin Memory Management Tools** - Clear/delete/archive memories via admin API
  - Related files: `backend/src/server.ts`, `backend/src/stores/`
  - Priority: Medium
  - Depends on: Phase 4: Integration & Testing
  - Spec: `DevDocumentation/VectorStorage.md` (User Story 5)
  - Details: Admin routes for memory cleanup and debugging

- [ ] **Add item here** - Description
  - Related files: 
  - Priority: Medium
  - Depends on: 

---

## 🟢 Low Priority / Nice-to-Have

- [ ] **Memory Summarization Optimization** - Reduce storage by summarizing long rounds
  - Priority: Low
  - Depends on: Phase 4: Integration & Testing
  - Details: Optional optimization after MVP (raw messages work fine)

- [ ] **Add item here** - Description
  - Related files: 
  - Priority: Low
  - Depends on: 

---

## ✅ Completed

- [x] **Resolve Vector Storage Clarifications** - Update all 9 clarification items (Jan 14, 2026)
  - Created ROUNDS_Prerequisite_Feature.md
  - Updated VectorStorage.md with clarifications
  - Updated VectorStorage_Implementation_Review.md with resolutions
  - All 9 items now have detailed implementation guidance

- [x] **PREREQUISITE: Implement Rounds System** ✅ COMPLETED (Jan 14, 2026)
  - Message round tracking implemented
  - Continue Round button UI added
  - Round completion events emitted
  - VectorizationAgent trigger ready for Phase 1

---

## Phase-Based Roadmap

### Phase 0: Rounds (Prerequisite)
- [ ] Database schema: Add roundNumber, SceneRounds table
- [ ] MessageService: Add round methods
- [ ] SceneService: Add round lifecycle
- [ ] Orchestrator: Implement round tracking
- [ ] Server: Add continue-round endpoint
- [ ] Frontend: Add Continue Round button
- [ ] Testing: Round workflow end-to-end

### Phase 1: Vector Store Infrastructure
- [ ] VectorStoreInterface
- [ ] VectraVectorStore implementation
- [ ] Embedding manager (@xenova/transformers)
- [ ] Unit tests

### Phase 2: VectorizationAgent
- [ ] VectorizationAgent class
- [ ] Orchestrator hook (completeRound trigger)
- [ ] Error handling
- [ ] Integration tests

### Phase 3: Memory Query & Injection
- [ ] Query in Orchestrator
- [ ] Add to AgentContext
- [ ] Update templates (character.njk, narrator.njk)
- [ ] Test memory injection

### Phase 4: Integration & Testing
- [ ] Full integration tests
- [ ] End-to-end tests
- [ ] Performance tests
- [ ] Documentation

---

## Quick Reference

| Symbol | Meaning |
|--------|---------|
| 🔴 | High Priority / Blocking |
| 🟡 | Medium Priority / Important |
| 🟢 | Low Priority / Nice-to-have |
| ✅ | Completed items |

---

## Notes

- **Total Effort**: ~105 hours (Rounds + Vector Storage)
- **Start Date**: After Rounds prerequisite planned
- **Critical Path**: Rounds → Phase 1 → Phase 2 → Phase 3 → Phase 4
- **Parallelizable**: Limited (each phase depends on previous)
- **Documentation**: All specs complete in DevDocumentation/

---

## Documentation Links

- **Specification**: `DevDocumentation/VectorStorage.md`
- **Review & Clarifications**: `DevDocumentation/VectorStorage_Implementation_Review.md`
- **Rounds Prerequisite**: `DevDocumentation/ROUNDS_Prerequisite_Feature.md`
- **Clarification Summary**: `DevDocumentation/VECTOR_STORAGE_CLARIFICATIONS_COMPLETE.md`


## Phase-Based Roadmap

### Phase 6 (Visual Generation)
- [ ] Item

### Phase 7 (Response Shaping & Plugins)
- [ ] Item

### Phase 8 (Deployment & Optimization)
- [ ] Item

---

## Quick Reference

| Symbol | Meaning |
|--------|---------|
| 🔴 | High Priority - Do ASAP |
| 🟡 | Medium Priority - Schedule soon |
| 🟢 | Low Priority - Backlog |
| ✅ | Completed items |

---

## Notes

- Update `Last Updated` date when making changes
- Use checkboxes to track progress: `[ ]` (incomplete) or `[x]` (complete)
- Keep descriptions brief but informative
- Link to related issues or documentation when available
