# Agent Restructure Backend Reference

Keep in sync with: [DevDocumentation/AgentRestructure-architecture.md](DevDocumentation/AgentRestructure-architecture.md) and [DevDocumentation/AgentRestructure-imp-plan.md](DevDocumentation/AgentRestructure-imp-plan.md).

> Critical: Only the user will handle commits and pull requests. Update this document whenever backend structure, flows, or contracts change.

## Stack & Runtime
- Node.js + Express + Socket.io, SQLite (better-sqlite3), Nunjucks for prompt templates, OpenAI-compatible LLM client, Tailwind assets for backend public (if any).
- Entry: `backend/src/server.ts` (Express app + Socket.io bootstrap).
- Config: `backend/config.json` (profiles, endpoints), `backend/config.example.json` (template), `backend/package.json` (scripts, deps), `backend/tsconfig.json`.

## Directory Layout (backend/)
- `src/server.ts`: Express/Socket.io setup, route wiring, event emitters.
- `src/agents/`: BaseAgent + concrete agents: NarratorAgent, CharacterAgent, DirectorAgent, WorldAgent (flagged), SummarizeAgent, VisualAgent, CreatorAgent, VectorizationAgent; Orchestrator orchestrates flows.
- `src/services/`: DB/business logic (SceneService, CharacterService, MessageService, LorebookService, CampaignState, etc.).
- `src/utils/`: helpers (memoryRetriever, loreMatcher, jsonRepair, memoryHelpers, logging).
- `src/prompts/`: Nunjucks templates (if present).
- `migrations/`: SQL migrations (backend/migrations/ also present in repo root for DB setup).
- `data/`, `public/`, `scripts/`, `config/`, `workflows/` as supporting directories.

## Data Model (high level)
- SQLite tables: Worlds, Campaigns, Arcs, Scenes, Messages, CampaignState, BaseCharacters, personas, lorebooks.
- Scenes: fields for activeCharacters (JSON array of IDs), characterStates (JSON), worldState (JSON), lastWorldStateMessageNumber, summary.
- CampaignState: trackers (JSON), dynamicFacts (JSON), elapsedMinutes.
- Messages: messageNumber, sender/character, message, sceneId.
- Lorebooks: entries (JSON); Personas: data (JSON).

## Orchestrator & Flow (current + planned restructure)
- File: `src/agents/Orchestrator.ts`.
- Responsibilities: initialize rounds, build session context, call Director/Character/World/Narrator, manage history/summary, persist world/character state, emit socket events.
- Planned flow per round: user/continuation → Director pass 1 (select actors, guidance, state updates, activations/deactivations) → Character agents (per actor) → Director pass 2 (reconcile) → round close (persist + events).
- Guardrails: `maxDirectorPasses` default 2; WorldAgent feature-flagged off by default; Director authoritative on pre-character state updates.
- WorldAgent flag: set `features.worldAgentEnabled=true` in `backend/config.json` to enable; default false keeps Director as owner of trackers/world updates. When enabled, WorldAgent uses the shared context envelope + JSON templating. Trackers/world state persist once per round after reconciliation to avoid double writes.

## Context Envelope (planned shared type)
- `AgentContextEnvelope`: request metadata (requestType, sceneId, roundNumber); history (raw, summaries, per-round bullets, last-round messages verbatim); lore (raw/formatted); memories (per character, with scopes); scenario/author notes (world/campaign/arc/scene) truncated; persona & character summaries; character/world state; trackers; director guidance placeholders; token budget metadata.
- Builder (planned): `src/agents/context/contextBuilder.ts` will assemble and truncate per token allocations.

## Token Budgeting (planned enforcement)
- Defaults: history 30%, summaries 10%, lore 15%, memories 20%, scenario/author notes 10%, director guidance 5%, character guidance 10%; proportional reallocation if sections absent.
- Resolve percentages → counts using agent profile `maxContextTokens` (round down). Enforce per-section caps. Telemetry: rolling window (last 500 messages).

## Director Contract (planned)
- Output JSON: actingCharacters [{id|name, guidance, priority, order?}], activations [{id|name, entryGuidance}], deactivations [{id|name, exitGuidance}], stateUpdates {location?, mood?, clothing?, activity?, intentions?}, openGuidance.
- Ordering: stable priority then name. Director updates authoritative pre-character; entry/exit guidance stored for audit.

## Character Contract (planned)
- Inputs: envelope + characterDirective + entry/exit guidance. Output: narrative response. Heuristics infer deltas (mood/location/activity/clothing/intentions); flags hasActedThisRound, enteredThisRound, exitedThisRound. Director reconciliation overrides conflicts.

## Services (key behaviors)
- `SceneService`: scene retrieval, round completion, lore context assembly.
- `CharacterService`: merged characters with overrides (world/campaign), list, fetch by id.
- `MessageService`: messages per round; supports continuation flows.
- `LorebookService`: active lorebooks for world/campaign; provide entries for matching.
- `ConfigManager` (if present): profile retrieval for agents, sampler/token settings.

## Utilities
- `memoryRetriever.ts`: vector retrieval (scoped per world/char); provides formatted + raw memories.
- `loreMatcher.ts`: selects relevant lore entries given context.
- `jsonRepair.ts`: attempts to fix LLM JSON output.
- `memoryHelpers.ts`: nested field access, etc.
- `logging`: namespaced logger factory.

## Socket Events (expected)
- `agentStatus` per agent start/complete; `stateUpdated` for world/trackers/character states; `roundCompleted`; director/character pass status events (to standardize in restructure). Confirm exact event names in `server.ts` and Orchestrator.

## Validation & JSON Handling
- Agent profiles: expectsJson/jsonMode/jsonSchema/jsonExample (inline schema). Prompt assembly injects return template; runtime validation via Ajv adapter; surface errors after retries. Non-JSON agents bypass.

## File Pointers (quick)
- Orchestrator: `src/agents/Orchestrator.ts`
- Agents: `src/agents/*.ts`
- Services: `src/services/*.ts`
- Utils: `src/utils/*.ts`
- Config: `backend/config.json`
- Server: `src/server.ts`
- Migrations: `backend/migrations/`

## Operational Notes
- Always include last-round messages verbatim for Director. Guidance rebuilt each pass (not persisted).
- Keep scenario/author notes and character/persona summaries compact per budgets.
- User owns commits/PRs; update this doc with any backend contract/flow/file changes.
