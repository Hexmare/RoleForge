# Agent Restructure Implementation Plan

Reference design: see [DevDocumentation/AgentRestructure.md](DevDocumentation/AgentRestructure.md).
Reference architecture: see [DevDocumentation/AgentRestructure-architecture.md](DevDocumentation/AgentRestructure-architecture.md).
Backend/front-end references: [DevDocumentation/AgentRestructure-backend.md](DevDocumentation/AgentRestructure-backend.md) and [DevDocumentation/AgentRestructure-frontend.md](DevDocumentation/AgentRestructure-frontend.md). Keep all references updated as changes are made.

> Critical: Only the user will handle all commits and pull requests. Mark each checkbox `[ ]` as tasks are completed.

## Phase 1 — Foundations & Contracts
- [ ] Define `AgentContextEnvelope` TypeScript interface with all fields (history raw/summarized, lore raw/formatted, memories, world/character state, director guidance, round metadata, request type, persona info, scenario/author notes).
- [ ] Add defaults and required/optional notes in code comments and a short README entry in DevDocumentation pointing to this plan.
- [ ] Extend agent profile config typings with `expectsJson`, `jsonMode`, `jsonSchema`, `jsonExample`; add loader-time validation to reject invalid profiles.
- [ ] Implement helper to render JSON return template per profile (`object` vs `schema`), integrating schema/example as needed.
- [ ] Add no-op bypass path for non-JSON agents so prompt injection is skipped cleanly.

## Phase 2 — Shared Context Builder
- [ ] Create `backend/src/agents/context/contextBuilder.ts` exporting `buildAgentContextEnvelope(sceneId, options)` assembling session context, history, summaries, lore, vector memories, trackers, character states, world state, director guidance placeholders, scenario text, author notes (world/campaign/arc/scene).
- [ ] Implement size-aware truncation for scenario/author notes and compact per-character/persona summaries; always include last-round messages verbatim, per-round bullet summaries, and running scene summary.
- [ ] Add config keys for history window and summarization trigger; ensure builder returns both raw and summarized history.
- [ ] Add unit tests (mock DB/services) covering presence/defaults/truncation and override injection (prefetched memories, synthetic user input).
- [ ] Wire Orchestrator to consume the builder for Narrator, Director, Character, World (feature-flagged) instead of ad-hoc assembly.

## Phase 3 — JSON Prompting Integration
- [ ] Update agent prompt assembly to inject JSON return template based on profile `jsonMode/jsonSchema/jsonExample`.
- [ ] Add runtime JSON validation (Ajv adapter) with clear logging and retry hooks; surface errors to user on repeated failure.
- [ ] Add developer-mode toggle to log validated/cleaned payloads; include JSON path info on validation errors.
- [ ] Define token allocation rules per section with defaults: history 30%, summaries 10%, lore 15%, memories 20%, scenario/author notes 10%, director guidance 5%, character guidance 10%; reallocate proportionally if a section is absent.
- [ ] Enforce per-section hard caps (counts derived from `maxContextTokens`, rounded down) and document them.
- [ ] Update all agent profiles with JSON mode/schema/examples where applicable; add tests for object mode, schema mode, non-JSON agents.

## Phase 4 — Director Rewrite (Pre-Character Pass)
- [ ] Define Director output schema: `actingCharacters` (id/name, guidance, priority/order), `activations`, `deactivations`, `stateUpdates` (location/mood/clothing/activity/intentions), `openGuidance`.
- [ ] Update Director prompt using new JSON templating; include scenario/author notes and compact summaries in context envelope.
- [ ] Apply Director `stateUpdates` and activations/deactivations to scene state before character agents run; persist updates.
- [ ] Store entry/exit guidance for audit; enforce conflict rule that Director state updates win before characters act.
- [ ] Implement stable action ordering (priority, then name) when ordering not explicit.

## Phase 5 — Character Agent Updates
- [ ] Extend Character agent input to include `characterDirective` and updated state from Director pass.
- [ ] Inject entry guidance for activated characters and exit guidance for deactivations.
- [ ] After each character response, infer state deltas (mood/location/activity/clothing/intentions) via heuristic module and mark `hasActedThisRound`, `enteredThisRound`, `exitedThisRound` flags.
- [ ] Update character state storage accordingly; prepare data for Director reconciliation pass.

## Phase 6 — Director Reconciliation Pass
- [ ] Run Director post-character pass with recent responses and updated state; request `remainingActors`/`newActivations`.
- [ ] Enforce guardrail `maxDirectorPasses` (default 2); current flow is exactly two passes.
- [ ] Persist per-round timeline: Director pass 1 output, character outputs, Director pass 2 output.
- [ ] If remaining actors exist, enqueue another character pass only if guardrail allows (future-proofing); otherwise end round.

## Phase 7 — World/Tracker Integration
- [ ] Keep World agent behind feature flag (disabled by default); ensure context builder compatibility if re-enabled.
- [ ] Document how to re-enable World agent using unified context and JSON templating; when disabled, Director owns trackers/world updates.
- [ ] Ensure trackers/world state persist once per round after reconciliation to avoid double writes.

## Phase 8 — Persistence, Events, and UX
- [ ] Standardize socket events: director start/complete (pass 1 & 2), character start/complete, world updates (if enabled), round completed.
- [ ] Add structured logs per pass (actors, state deltas, activations/deactivations, validation results); include audit log format for per-round metadata.
- [ ] Update persistence to record per-round metadata (actors, guidance, activations, deactivations, summaries).
- [ ] Update documentation/quick references to reflect new flow.

## Testing & Telemetry
- [ ] Add unit tests: context builder, JSON template injection, Director schema validation, Character state update heuristics, activation/deactivation logic.
- [ ] Add integration tests: end-to-end round flow (user input and continuation), two-pass Director loop, persistence of state/trackers.
- [ ] Regression tests: legacy non-JSON agents, summarize thresholds, memory retrieval limits.
- [ ] Add token-usage telemetry per section; maintain rolling window (last 500 messages) to cap storage.

## Token Budget & Retrieval Caps
- [ ] Implement percentage-to-count resolver based on `maxContextTokens`; apply round-down and proportional reallocation when sections are absent.
- [ ] Set per-section hard caps for history, lore, memories, and notes; document defaults and make configurable.
- [ ] Add topK/maxChars limits for memories and lore to prevent prompt bloat; enforce in retrieval.

## Operational Notes
- [ ] Ensure deterministic tie-breakers for action ordering (priority then name) are coded and tested.
- [ ] Keep guidance non-persistent between director passes; rely on history + summaries + notes.
- [ ] Always include last-round messages verbatim in context sent to Director.
- [ ] Mark each task above when completed; user will handle commits/PRs.
