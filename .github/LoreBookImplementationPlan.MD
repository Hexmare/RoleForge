# Lorebook Matching & Prompt Injection Plan

This plan synthesizes the architectural guidance in `.github/roleforgearchitecture.md`, the agent responsibilities in `.github/agent-design.md`, and the lorebook requirements in `.github/LorebookFeature.md`. The objective is to wire `LorebookService` into the agent orchestration flow so keyword-matched entries are injected into prompts with proper budgeting and state awareness.

## Phase 1 · Service & Data Plumbing
1. **Finalize Lorebook Associations**
   - Expose `WorldService`/`CampaignService` helpers to attach/detach lorebook UUIDs via `World_Lorebooks` and `Campaign_Lorebooks` join tables (required by the architecture document).
   - Extend existing world/campaign CRUD responses to include assigned lorebooks so the frontend can manage them.
2. **LorebookService Enhancements**
   - Ensure `normalizeSillyTavern()` covers every legacy field listed in `LorebookFeature.md` (e.g., `keysecondary → optional_filter`, selective logic mapping, insertion position).
   - Add `LorebookService.getActiveLorebooks(worldId, campaignId)` that returns merged metadata + entries (utilized later by agents).
3. **API Surface**
   - Confirm `/api/lorebooks/import` and `/api/lorebooks/:uuid/export` mirror the SillyTavern shapes so the frontend tools keep parity.
   - Add `/api/worlds/:id/lorebooks` and `/api/campaigns/:id/lorebooks` routes for assignment management.

## Phase 2 · Backend Matching Engine
1. **Keyword Scanner Utility**
   - Build `backend/src/utils/loreMatcher.ts` that accepts `{ entries, context, scanDepth, tokenBudget }` and outputs selected entries plus cost.
   - Implement matching semantics from `LorebookFeature.md`: case sensitivity, whole-word enforcement, regex strings, probability gates, sticky/cooldown placeholders.
2. **Context Provider**
   - Extend `SceneService` (per architecture doc) with `getLoreContext(sceneId)` to gather:
     - Scene description/location/time
     - Recent messages (`scan_depth` window) from `MessageService`
     - Active characters & personas (for filters)
3. **Budgeting**
   - Use `utils/tokenCounter.ts` to approximate content + key metadata tokens; stop when `token_budget` per lorebook is reached, honoring `insertion_order` and `group` rules described in the feature doc.

## Phase 3 · Agent Integration
1. **SessionContext Updates**
   - Update `Orchestrator` (see `.github/agent-design.md`) to load active lorebooks via `getActiveLorebooks` when initializing the session context.
   - Append `loreEntries` array to the context object shared with agents.
2. **Injection Points**
   - **NarratorAgent** / **CharacterAgent**: Pass a `lore` array to their templates, truncated by insertion position (system prompt vs. character prompt) according to `LorebookFeature.md`.
   - **WorldAgent**: Provide matched lore facts so world-state adjustments remain consistent.
   - For outlets (e.g., `outletName`), store results in a map so templates can drop them into specialized sections (`{{ loreOutlet.director }}` etc.).
3. **Director & Creator Agents**
   - Supply lore context to the DirectorAgent for better pacing decisions.
   - Allow CreatorAgent to reference nearby lore when generating new entities.

## Phase 4 · Frontend Updates
1. **Assignment UI**
   - In `WorldManager`/`CampaignEditor`, add multi-select controls bound to the new assignment APIs.
   - Surface active lorebooks in `HierarchySidebar` or scene metadata so users know which sets drive injection.
2. **Lore Injection Debug View**
   - Add an optional debug panel (per `roleforgearchitecture.md` chat flow) to show which lore entries were injected for the last message, aiding tuning/testing.

## Phase 5 · Testing & Validation
1. **Unit Tests**
   - Add Vitest suites for `loreMatcher` covering: case sensitivity, regexes, probability, ordering, budgeting, and recursion guards.
   - Test `LorebookService.getActiveLorebooks` to ensure world + campaign associations merge without duplicates.
2. **Integration Tests**
   - Simulate a scene in `backend/src/__tests__/session.test.ts` that triggers lore injection; verify matched entries appear in agent prompts.
3. **Manual QA Checklist**
   - Import a SillyTavern lorebook, assign it to a campaign, send chat messages with known triggers, and confirm the NarratorAgent uses the lore without collapsing the UI.

## Deliverables
- `loreMatcher` utility and accompanying tests
- Updated services, routes, and orchestrator wiring
- Frontend management UI for lorebook assignment + debug visualization
- Documentation updates in `.github/LorebookFeature.md` / README to explain the workflow

Once these steps are complete, lorebooks loaded through `LorebookService` will participate in the full agent pipeline, providing keyword-driven context exactly as outlined in the design documents.