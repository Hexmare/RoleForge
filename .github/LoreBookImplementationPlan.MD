# Lorebook Matching & Prompt Injection Plan

This plan synthesizes the architectural guidance in `.github/roleforgearchitecture.md`, the agent responsibilities in `.github/agent-design.md`, and the lorebook requirements in `.github/LorebookFeature.md`. The objective is to wire `LorebookService` into the agent orchestration flow so keyword-matched entries are injected into prompts with proper budgeting and state awareness.

## Phase 1 · Service & Data Plumbing
1. **Finalize Lorebook Associations**
   - [x] Expose `WorldService`/`CampaignService` helpers to attach/detach lorebook UUIDs via `World_Lorebooks` and `Campaign_Lorebooks` join tables (required by the architecture document).
   - [x] Extend existing world/campaign CRUD responses to include assigned lorebooks so the frontend can manage them.
2. **LorebookService Enhancements**
   - [x] Ensure `normalizeSillyTavern()` covers every legacy field listed in `LorebookFeature.md` (e.g., `keysecondary → optional_filter`, selective logic mapping, insertion position).
   - [x] Add `LorebookService.getActiveLorebooks(worldId, campaignId)` that returns merged metadata + entries (utilized later by agents).
3. **API Surface**
   - [x] Confirm `/api/lorebooks/import` and `/api/lorebooks/:uuid/export` mirror the SillyTavern shapes so the frontend tools keep parity.
   - [x] Add `/api/worlds/:id/lorebooks` and `/api/campaigns/:id/lorebooks` routes for assignment management.

## Phase 2 · Backend Matching Engine
1. **Keyword Scanner Utility**
   - [x] Build `backend/src/utils/loreMatcher.ts` that accepts `{ entries, context, scanDepth, tokenBudget }` and outputs selected entries plus cost.
   - [x] Implement matching semantics from `LorebookFeature.md`: case sensitivity, whole-word enforcement, regex strings, probability gates, sticky/cooldown placeholders.
2. **Context Provider**
   - [x] Extend `SceneService` (per architecture doc) with `getLoreContext(sceneId)` to gather:
     - Scene description/location/time
     - Recent messages (`scan_depth` window) from `MessageService`
     - Active characters & personas (for filters)
3. **Budgeting**
   - [x] Use `utils/tokenCounter.ts` to approximate content + key metadata tokens; stop when `token_budget` per lorebook is reached, honoring `insertion_order` and `group` rules described in the feature doc.

## Phase 3 · Agent Integration
1. **SessionContext Updates**
   - [x] Update `Orchestrator` (see `.github/agent-design.md`) to load active lorebooks via `getActiveLorebooks` when initializing the session context.
   - [x] Append `loreEntries` array to the context object shared with agents.
2. **Injection Points**
   - [x] **NarratorAgent** / **CharacterAgent**: Pass a `lore` array to their templates, truncated by insertion position (system prompt vs. character prompt) according to `LorebookFeature.md`.
   - [x] **WorldAgent**: Provide matched lore facts so world-state adjustments remain consistent.
   - For outlets (e.g., `outletName`), store results in a map so templates can drop them into specialized sections (`{{ loreOutlet.director }}` etc.).
3. **Director & Creator Agents**
   - [x] Supply lore context to the DirectorAgent for better pacing decisions.
   - [x] Allow CreatorAgent to reference nearby lore when generating new entities.

## Phase 4 · Frontend Updates
1. **Assignment UI**
   - [x] In `WorldManager`/`CampaignEditor`, add multi-select controls bound to the new assignment APIs.
   - [x] Surface active lorebooks in `HierarchySidebar` or scene metadata so users know which sets drive injection.
2. **Lore Injection Debug View**
   - [x] Add backend debug logging showing which lore entries were matched and injected for each message.
   - [ ] Add optional frontend debug panel (per `roleforgearchitecture.md` chat flow) to show lore injection metadata.

## Phase 5 · Testing & Validation
1. **Unit Tests**
   - [x] Added Vitest suites for `loreMatcher` covering: case sensitivity, regexes, probability, ordering, budgeting, selective logic, and recursion guards.
   - [x] Test `LorebookService.getActiveLorebooks` to ensure world + campaign associations merge without duplicates.
2. **Integration Tests**
   - [x] Simulate a scene that triggers lore injection; verify matched entries appear in agent prompts (via console debug logs).
   - [x] Verified: Keyword matching works end-to-end with selective logic, probability gates, and token budgeting.
3. **Manual QA Checklist**
   - [x] Import a SillyTavern lorebook, assign it to a campaign, send chat messages with known triggers, and confirmed lore entries are injected into character responses.
   - [x] Verified: UI remains stable, new entries stay open after saving, lore matching respects all settings.

## Deliverables
- `loreMatcher` utility and accompanying tests
- Updated services, routes, and orchestrator wiring
- Frontend management UI for lorebook assignment + debug visualization
- Documentation updates in `.github/LorebookFeature.md` / README to explain the workflow

Once these steps are complete, lorebooks loaded through `LorebookService` will participate in the full agent pipeline, providing keyword-driven context exactly as outlined in the design documents.