# Agent Restructure Plan

## Goals
- Unify agent input contexts (history, lore, memories, summaries, world/character status, director guidance) via a shared format.
- Keep agent-specific instructional prompts but inject a common context envelope before each agent call.
- Support agent profile config to specify JSON return expectations (object vs schema) and inject the correct return template automatically.
- Reorient round flow: user input/continuation → Director (select actors + per-character guidance + state updates/activation) → Character agents (act) → Director (post-actions reconciliation if needed) → round close.

## Phase 1 — Foundations & Contracts
**User stories**
- As a developer, I can see a single source of truth for the agent context shape so agents don’t assemble inputs ad hoc.
- As a User, I can configure per-agent JSON return expectations (object vs schema) without hardcoding prompts.

**Tasks**
1. Define a `AgentContextEnvelope` interface (TS) capturing: chat history (raw + summarized), lore (raw + formatted), vector memories, world status, character statuses, director guidance (per-character), round metadata, request type (user vs continuation), persona info.
2. Document required/optional fields and defaults; add a short README note in DevDocumentation linking to this plan.
3. Extend agent profile config to include: `expectsJson: boolean`, `jsonMode: 'object' | 'schema'`, `jsonSchema?: string | JsonSchemaObject`, `jsonExample?: object`. Clarify validation rules.
4. Write a helper to render the JSON return template for a profile (object vs schema) for prompt injection.

**Decisions & clarifications**
- Use JSON Schema Draft-07 (best tooling/compatibility) unless performance testing proves otherwise.
- Schemas live inline in the profile JSON (no external indirection for now).

**Additions**
- Add TS types for agent profile JSON settings plus a validator to reject bad `jsonMode/schema/example` on load.
- Provide a no-op path for non-JSON agents to bypass template injection cleanly.

## Phase 2 — Shared Context Builder
**User stories**
- As a developer, I can call one function to build the full agent context envelope given `sceneId`, `persona`, and request type.
- As an agent, I always receive the same context shape regardless of caller.

**Tasks**
1. Create `backend/src/agents/context/contextBuilder.ts` (or similar) exporting `buildAgentContextEnvelope(sceneId, options)` that assembles: session context, history, summaries, lore, vector memories, trackers, character states, world state, director guidance placeholders, scenario text, and author notes at world/campaign/arc/scene levels.
2. Add unit tests for the builder (mock DB/services) to validate presence and defaults of each field.
3. Wire Orchestrator to use the builder for Narrator, Director, Character, World agents (no ad-hoc assembly).
4. Ensure builder can accept injected overrides (e.g., pre-fetched memories, synthetic user input) for testing.
5. Produce compact per-character/persona summaries to keep prompts within budget; include last-round messages verbatim, per-round bullet summaries, and a running scene summary.

**Decisions & clarifications**
- Memory retrieval is eager per character (distinct memories per character).
- Summarization threshold becomes a config option (default can mirror current >10 behavior).

**Additions**
- Define config keys for history window and summarization trigger; document defaults.
- Ensure the builder returns both raw and summarized history sections so agents can choose.
- Add fields for scenario and author notes (world/campaign/arc/scene) and ensure they are included in the envelope with size-aware truncation rules.

## Phase 3 — JSON Prompting Integration
**User stories**
- As a developer, I can declare JSON expectations in the agent profile and have prompts automatically include the right return template.
- As a tester, I can validate agent JSON responses against the declared schema.

**Tasks**
1. Extend agent prompt assembly to inject the JSON return template based on profile config (`jsonMode`, `jsonSchema`, `jsonExample`).
2. Add runtime validation of JSON responses (when `expectsJson` is true) with clear logging and retry hooks.
3. Update existing agent profiles to include their JSON mode/schema or example payloads.
4. Add tests covering: object mode, schema mode, and non-JSON agents.

**Decisions & clarifications**
- On JSON validation failure (after retries), surface an error to the user (no silent fallback).
- No schema versioning needed; each call is atomic.

**Additions**
- Add a pluggable validator (Ajv or similar) behind a thin adapter; log validation errors with JSON paths.
- Add a developer-mode toggle to emit the validated/cleaned payload in logs for debugging.
- Define token allocation rules per agent section (history, summaries, lore, memories, scenario/author notes, director guidance, character guidance). Percentages auto-resolve to counts from `maxContextTokens` (round down); enforce hard caps per section.
- Default allocation (tunable): history 30%, summaries 10%, lore 15%, memories 20%, scenario/author notes 10%, director guidance 5%, character guidance 10%. If a section is absent, reallocate its budget proportionally to the remaining sections.

## Phase 4 — Director Rewrite (Pre-Character Pass)
**User stories**
- As a director, I receive a list of characters that are active, as well as a list of characters available.
- As a director, I output: (a) which characters act; (b) per-character guidance; (c) world/scene/state updates (locations, mood, clothing, activity, intentions); (d) activations/deactivations with entry/exit guidance.
- As the orchestrator, I consume director output to drive character order and state changes before characters speak.

**Tasks**
1. Redefine Director output schema to include:
   - `actingCharacters: CharacterDirective[]` (id/name, guidance, priority/order)
   - `activations`: characters to activate + how they enter
   - `deactivations`: characters to deactivate + how they exit
   - `stateUpdates`: location/mood/clothing/activity/intentions
   - `openGuidance`: global narrative guidance
2. Update Director prompt to request the above JSON (using Phase 3 templating).
3. Apply director `stateUpdates` and activation/deactivation to scene state before character agents run.
4. Persist updated character/world state after this director pass.

**Decisions & clarifications**
- Director computes character action ordering (no round-robin fallback unless guidance is missing).
- Location updates from Director are authoritative; World agent is disabled for now (will use unified context when re-enabled).

**Additions**
- Define conflict resolution: Director state updates win before characters act.
- Persist director-produced entry/exit guidance alongside activation data for round audit.

## Phase 5 — Character Agent Updates
**User stories**
- As a character agent, I receive my specific guidance plus shared context and respond accordingly.
- As the orchestrator, I can mark characters as having acted and apply exit/entry changes.

**Tasks**
1. Extend Character agent input to include `characterDirective` (from Director) and updated state.
2. If a character was activated this round, include entry guidance in the prompt; likewise include exit guidance when deactivating.
3. After each character response, update character state (mood/location/activity/clothing/intentions) based on response and Director hints.
4. Track `hasActedThisRound` to know when all active characters have acted.

**Decisions & clarifications**
- Character state deltas are inferred from text; Director’s later pass authoritatively reconciles and writes state.
- Conflict rule: Director reconciliation overrides character self-reporting; can re-enable explicit deltas later if needed.

**Additions**
- Add heuristic module for extracting inferred deltas (mood/location/activity/clothing/intentions) to feed Director reconciliation.
- Track `hasActedThisRound` and `enteredThisRound`/`exitedThisRound` flags to simplify reconciliation logic.

## Phase 6 — Director Reconciliation Pass (Post-Character)
**User stories**
- As a director, I reconcile after-character actions, deciding if additional characters must act or if the round can end.
- As the orchestrator, I only re-run Director if not all active characters have acted or new activations are needed.

**Tasks**
1. Invoke Director again with recent character responses and updated state; request `remainingActors`/`newActivations`.
2. If no remaining actors, skip; otherwise, enqueue another character pass (loop until done or max iterations to avoid stalls).
3. Ensure state persistence after reconciliation.

**Decisions & clarifications**
- Director runs twice per round: pre-character and post-character reconciliation only (no extra loops unless future config enables it).
- Second Director pass can override earlier guidance/state updates to reflect the latest actions.

**Additions**
- Add a guardrail config (`maxDirectorPasses`, default 2) for future flexibility; currently hard-cap at 2.
- Persist a per-round timeline: director pass 1 output, character outputs, director pass 2 output.

## Phase 7 — World/Tracker Integration
**User stories**
- As a world agent (if still used), I work from the unified context and post-character updates to reconcile world facts and trackers.
- As a developer, I can disable World agent if Director now owns world-state updates.

**Tasks**
1. Decide ownership: keep World agent for environmental changes, or fold into Director state updates. Document the choice.
2. If kept, adapt World agent to the common context envelope and JSON prompting.
3. Ensure trackers/world state are persisted once per round (after reconciliation) to avoid double-writes.

**Decisions & clarifications**
- World agent is disabled; Director owns trackers and world/scene updates for now.

**Additions**
- Keep World agent path behind a feature flag; when disabled, skip invocation but keep context builder compatibility.
- Document how to re-enable World agent using the unified context and JSON templating when needed.

## Phase 8 — Persistence, Events, and UX
**User stories**
- As a frontend consumer, I receive consistent socket events for agent status, state updates, and round completion.
- As a developer, I can audit rounds with clear logs of director/character passes and state changes.

**Tasks**
1. Standardize socket events for: director start/complete (pass 1 and 2), character start/complete, world updates (if applicable), round completed.
2. Add structured logs for each pass including selected actors, state deltas, activations/deactivations, and validation results.
3. Update state persistence to record per-round metadata (actors, guidance, activations, deactivations, summaries).
4. Update documentation and quick references to reflect the new flow.

**Decisions & clarifications**
- No UI surfacing of per-character guidance/activations for now; may add later.
- Surface validation errors in logs only (not UI) for now.

**Additions**
- Add socket event contract doc for director/character pass status, activations/deactivations, and reconciliation completion.
- Add audit log format for per-round metadata (actors, guidance, activations, deactivations, summaries).

## Testing Strategy
- Unit tests: context builder, JSON template injection, Director schema validation, Character state updates, activation/deactivation logic.
- Integration tests: end-to-end round flow (user input and continuation), multi-pass Director loop, persistence of state and trackers.
- Regression tests: legacy non-JSON agents (if any), summarize thresholds, memory retrieval boundaries.

## Implementation Plan Reference
- See the step-by-step plan in [DevDocumentation/AgentRestructure-imp-plan.md](DevDocumentation/AgentRestructure-imp-plan.md).
- Keep the architecture reference synced: [DevDocumentation/AgentRestructure-architecture.md](DevDocumentation/AgentRestructure-architecture.md).
- Keep backend/frontend references synced: [DevDocumentation/AgentRestructure-backend.md](DevDocumentation/AgentRestructure-backend.md) and [DevDocumentation/AgentRestructure-frontend.md](DevDocumentation/AgentRestructure-frontend.md).

## Open Questions (General)
- Action ordering tie-breakers: approved stable sort by priority, then name.
- Guidance persistence: no persistence between director passes. Director rebuilds guidance from history plus scenario/author notes (world/campaign/arc/scene), character mood/personality/goals. We need compact character/persona summaries to stay in budget; always include last round messages, add per-round bullet summaries, and maintain an improved running scene summary for the director.
- Token budgeting: percentage budgets auto-resolve to numeric counts from `maxContextTokens` (round down). Need concrete allocation rules per section.
- Retrieval caps: include topK/maxChars per section as part of budgeting config.
- Telemetry: add rolling token-usage tracking per section, capped to last 500 messages to avoid storage bloat.
