# Agent Restructure Architecture Reference

Reference plans: [DevDocumentation/AgentRestructure.md](DevDocumentation/AgentRestructure.md) and [DevDocumentation/AgentRestructure-imp-plan.md](DevDocumentation/AgentRestructure-imp-plan.md).
See also: backend reference [DevDocumentation/AgentRestructure-backend.md](DevDocumentation/AgentRestructure-backend.md) and frontend reference [DevDocumentation/AgentRestructure-frontend.md](DevDocumentation/AgentRestructure-frontend.md). Keep all three in sync.

> Critical: Only the user will handle commits and pull requests. Keep this document in sync with plan/design changes. Update this reference whenever backend or frontend architecture shifts.

## Repository Topography (high-level)
- Root configs: `package.json`, `tsconfig.json`, `setupinstructions.md`, `README.md`.
- Backend: `backend/` (Express/Node, SQLite via better-sqlite3, Socket.io, Nunjucks, agents, services, utils, data, migrations, public, scripts). Key entry: `backend/src/server.ts` (Express + Socket.io bootstrap), `backend/src/agents/` (agent implementations), `backend/src/services/` (DB/business logic), `backend/src/utils/` (helpers), `localConfig/config.json` (runtime config, profiles).
- Frontend: `frontend/` (Vite + React + Tailwind). Entry: `frontend/src/App.tsx`, components in `frontend/src/components/`, styling via `frontend/src/index.css`, config via `vite.config.ts`, `tailwind.config.js`.
- Dev docs: `DevDocumentation/` (designs, plans, status, this reference).
- Data/migrations: `migrations/` SQL, `vector_data/` stores, `backend/migrations/` for backend DB.

## Backend Architecture (overview)
- Server: Express app with Socket.io server (see `backend/src/server.ts`). Handles HTTP API, WebSocket events for state updates and agent status.
- Database: SQLite via better-sqlite3. Core tables: Scenes, Campaigns, Arcs, Worlds, Messages, CampaignState, Scenes.activeCharacters (JSON), Scenes.characterStates (JSON), lorebooks, personas, BaseCharacters. Migrations live in `backend/migrations/`.
- Services (examples):
  - `SceneService` (scene retrieval, round completion, lore context).
  - `CharacterService` (merged character data across world/campaign overrides, listing characters).
  - `MessageService` (message retrieval per round).
  - `LorebookService` (active lorebooks lookup).
- Agents (`backend/src/agents/`):
  - `BaseAgent`, `NarratorAgent`, `CharacterAgent`, `DirectorAgent`, `WorldAgent` (feature-flagged), `SummarizeAgent`, `VisualAgent`, `CreatorAgent`, `VectorizationAgent`.
  - Orchestrator: `backend/src/agents/Orchestrator.ts` coordinates multi-agent flow, world/character state persistence, socket events.
- Utilities: `utils/memoryRetriever.ts` (vector retrieval), `utils/loreMatcher.ts`, `utils/jsonRepair.ts`, `utils/memoryHelpers.ts`, `logging`.

## Planned Shared Types (key references)
- `AgentContextEnvelope` (planned): unified context passed to all agents, containing:
  - request metadata: requestType (user|continuation), sceneId, roundNumber.
  - history: raw messages, summarized history, per-round bullet summaries, last-round messages (always included).
  - lore: raw entries, formatted lore.
  - memories: vector memories per character (with scope IDs).
  - scenario & author notes: world/campaign/arc/scene (size-aware truncation).
  - persona & characters: persona info, compact per-character/persona summaries, character states, trackers, world state.
  - director guidance placeholders and token budget metadata (per-section allocation).

## Operational Flow (per interaction/round)
1) **Input**: user message or continuation trigger arrives.
2) **Director Pass 1**
   - Inputs: context envelope (history raw+summaries, lore, memories, scenario/author notes, persona/character summaries, world/character state, trackers, placeholders).
   - Outputs (JSON): actingCharacters (with priority/order and guidance), activations (entry guidance), deactivations (exit guidance), stateUpdates (location/mood/clothing/activity/intentions), openGuidance.
   - Apply: persist stateUpdates; apply activations/deactivations; store entry/exit guidance for audit; order characters by priority then name (stable).
3) **Character Pass**
   - For each acting character in order: build per-character context (shared envelope + characterDirective + entry/exit guidance). Character responds; heuristics infer state deltas; set hasActedThisRound, entered/exited flags; update character state.
4) **Director Pass 2 (Reconciliation)**
   - Inputs: updated state, recent character responses, refreshed summaries/history.
   - Outputs: remainingActors/newActivations (if any), stateUpdates, openGuidance.
   - Apply: update state; if remainingActors and guardrail allows, schedule additional character pass (default guardrail = 2 passes total).
5) **Round Close**: persist timeline (dir1, characters, dir2), trackers/world state, character states; emit socket events.

## Context Assembly (planned builder)
- File (planned): `backend/src/agents/context/contextBuilder.ts`.
- Responsibilities: assemble envelope, perform truncation per token budget, include scenario/author notes, compact character/persona summaries, last-round verbatim messages, per-round bullet summaries, running scene summary.
- Config knobs: history window, summarization trigger, section token allocations, retrieval caps (topK/maxChars), maxContextTokens from agent profile.

## Token Budgeting
- Default percentages (reallocate proportionally if section absent): History 30%, Summaries 10%, Lore 15%, Memories 20%, Scenario/Author Notes 10%, Director Guidance 5%, Character Guidance 10%.
- Resolution: percentages → counts from agent profile `maxContextTokens`, round down; enforce per-section caps before prompt assembly.
- Telemetry: rolling token usage per section (last 500 messages) to tune budgets.

## Director Output Schema (planned enforcement)
- actingCharacters: [{ id|name, guidance, priority, order? }]
- activations: [{ id|name, entryGuidance }]
- deactivations: [{ id|name, exitGuidance }]
- stateUpdates: { location?, mood?, clothing?, activity?, intentions? }
- openGuidance: string
- Rules: Director updates are authoritative pre-character; action ordering stable by priority then name; entry/exit guidance persisted for audit.

## Character Agent Input & Behavior
- Inputs: shared envelope, characterDirective (from Director), entry/exit guidance when applicable.
- Behavior: generate response; heuristics infer deltas (mood/location/activity/clothing/intentions); set flags hasActedThisRound, enteredThisRound, exitedThisRound; update state.
- Conflict handling: Director reconciliation overrides character self-reporting; explicit deltas can be reintroduced if needed.

## Guardrails & Feature Flags
- maxDirectorPasses: default 2 (pass 1 + reconciliation). Future-proof to allow more if configured.
- World agent: feature-flagged off by default; when enabled, uses same envelope and JSON templating; Director currently owns trackers/world updates.

## Persistence & Events
- Persist per-round timeline (director pass 1, character outputs, director pass 2), activations/deactivations, stateUpdates, summaries, trackers/world state, character states.
- Socket events (names to confirm in code): director start/complete (pass 1 & 2), character start/complete, world updates (if enabled), round completed, stateUpdated.
- Audit log: actors, guidance, activations/deactivations, state deltas, validation results.

## Validation & JSON Handling
- Agent profiles: expectsJson, jsonMode, jsonSchema, jsonExample (inline schema per decisions).
- Prompt assembly injects return template; runtime validation via Ajv adapter; on repeated failure, surface error to user.
- Non-JSON agents bypass template injection; add compatibility shim.

## Frontend Snapshot (reference)
- Stack: Vite + React + TypeScript + Tailwind.
- Structure: `frontend/src/App.tsx` root; `frontend/src/components/` for UI pieces; `frontend/src/index.css` for styles; configs in `vite.config.ts`, `tailwind.config.js`, `tsconfig.app.json`.
- Responsibilities (expected): consume socket events for agent status, state updates, round completion; render chat/history, world and character status. (Confirm specific component mappings during implementation.)

## File Pointers (non-exhaustive, high-value)
- Orchestrator: `backend/src/agents/Orchestrator.ts` (current flow coordination, state persistence, socket emits).
- Agents: `backend/src/agents/*.ts` (NarratorAgent, CharacterAgent, DirectorAgent, WorldAgent, SummarizeAgent, VisualAgent, CreatorAgent, VectorizationAgent).
- Services: `backend/src/services/` (SceneService, CharacterService, MessageService, LorebookService, etc.).
- Utils: `backend/src/utils/` (memoryRetriever, loreMatcher, jsonRepair, memoryHelpers, logging).
- Config: `localConfig/config.json` (profiles, endpoints); `backend/config.example.json`.
- DB migrations: `backend/migrations/`.
- Frontend entry: `frontend/src/main.tsx` or Vite entry (verify), `frontend/src/App.tsx`.

## Operational Notes
- Always include last-round messages verbatim in Director context; guidance is rebuilt each pass (not persisted between passes).
- Scenario/author notes and character/persona summaries must be compact and respect token budgets.
- Stable ordering: priority then name for acting characters.
- User owns commits/PRs; keep this reference updated whenever architecture, flow, or file locations change.
