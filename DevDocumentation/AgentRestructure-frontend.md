# Agent Restructure Frontend Reference

Keep in sync with: [DevDocumentation/AgentRestructure-architecture.md](DevDocumentation/AgentRestructure-architecture.md) and [DevDocumentation/AgentRestructure-imp-plan.md](DevDocumentation/AgentRestructure-imp-plan.md).

> Critical: Only the user will handle commits and pull requests. Update this document whenever frontend structure or contracts change.

## Stack & Runtime
- Vite + React + TypeScript + Tailwind CSS.
- Entry: `frontend/src/main.tsx` (Vite bootstrap) -> `frontend/src/App.tsx`.
- Config: `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`.

## Directory Layout (frontend/)
- `src/App.tsx`: root app wiring.
- `src/components/`: UI components (chat, panels, status, etc.).
- `src/index.css`: global styles (Tailwind + custom).
- `public/`: static assets.

## Expected Responsibilities (aligned to restructure)
- Connect to Socket.io backend to receive:
  - Agent status events (director pass 1/2, character, world if enabled).
  - State updates: world state, trackers, character states, round completion.
  - Round metadata timeline (dir1, characters, dir2) when emitted.
- Render: chat/history, character/world state panels, round/agent status indicators, guidance summaries (if exposed), and error/validation messages when surfaced.
- Provide controls: send user input, trigger continuation, display loading/status for agents.

## Event Contracts (standardized, Phase 8)
- All events include `sceneId`, `roundNumber`, and `timestamp`.
- Lifecycle: `roundStarted`, `roundCompleted`, `remainingActorsQueued`.
- Passes: `directorPassStarted`/`directorPassCompleted` (payload: pass, orderedActors, activations, deactivations), `characterRunStarted`/`characterRunCompleted` (character, responsePreview, flags), `worldUpdateStarted`/`worldUpdateCompleted` (enabled flags, state changes), `agentStatus` (compat).
- State/outputs: `stateUpdated` (world/trackers/characterStates), `characterResponse` (sender, content).
- UI should tolerate missing fields; prefer optional chaining.

## Data Shapes (consumed)
- World/trackers/characterStates as emitted by backend (Orchestrator/world updates).
- Round timeline (if provided): director pass 1 output, character outputs, director pass 2 output.
- Agent status: start/complete markers for progress UI.

## UI/UX Notes
- Keep displays resilient to missing fields; prefer optional chaining and defensive defaults.
- Respect token-budgeted summaries: show latest round messages and running scene summary where helpful.
- Do not store configuration/flags in localStorage (per project directive); fetch from backend if needed.

## Testing
- Component tests for sockets and rendering of agent/round status.
- Integration (if applicable) for flows: user input → status updates → render state/trackers → round completion.

## Operational Notes
- User owns commits/PRs; update this doc with any frontend event/shape changes.
- Keep event names and payloads in sync with backend emits as they evolve during restructure.
