# Copilot-Instructions.md

## Project Overview

**Project Name**: RoleForge

**Description**: RoleForge is a full-stack TypeScript application built with Node.js on the backend and a Vite-powered React frontend. It provides an immersive roleplaying experience where users interact with AI-guided stories via local or remote LLMs (using OpenAI-compatible or Kobold APIs). The app features multi-character roleplay, world/lore management, story guidance, and on-demand image/video generation for scenes. No local LLM inference is performed; all AI calls are proxied to external backends.

The system emphasizes modularity, extensibility, and pure JavaScript/TypeScript (no Python). Curly braces are preferred for structure and readability.

**Core Technologies**:
- Backend: Node.js, Express, Socket.io for real-time, Nunjucks for Jinja-like prompt templating, Axios/OpenAI npm for LLM integrations.
- Frontend: React (TypeScript), Vite for build/dev server, Socket.io-client for real-time chat.
- Database/Storage: Local JSON/SQLite for characters, worlds, history (via better-sqlite3).
- Templating: Nunjucks for dynamic prompt assembly.
- Visual Gen: Proxy to Stable Diffusion APIs (e.g., Automatic1111) for images; optional video diffusion endpoints.
- Dynamic Templating: Preprocess macros and variables (e.g., {{char}}, {{user}} with property expansions) before Nunjucks rendering for flexible prompts.
- Enhanced State Management: Track dynamic character attributes (outfits, personas), stats/objectives/relationships, and location awareness (e.g., spatial separation for conversations/actions).
- User Controls: Slash commands for in-chat actions, response shaping tools (continue/regen/edit), and meta-interfaces like Director chat.
- Advanced Knowledge: Vector-based lore activation and RAG-like data banks for contextual retrieval.
- Group Dynamics: Polished multi-character handling with presence, turn order, and quick switching.
- Visual Management: Library for browsing/regenerating images with iteration (inpainting/reference).
- Audio Integration: TTS for narrated/dialogue playback with per-character voices.

**Key Principles**:
- Modular Agents: Separate concerns like narration, dialogue, and world state.
- Configurability: Connection profiles for LLMs with system default and per-agent overrides.
- User Agency: LLM responses react to inputs without railroading.
- Visual Integration: Inline triggers for images/videos mid-chat.
- Extensibility: Plugins folder for custom agents/tools.
- Database Migrations: Use database migrations at all times for schema changes to ensure data integrity and version control.
- UUID Linking: Use UUIDs instead of slugs for all entity linking to ensure uniqueness and stability.

## Sources of Inspiration

RoleForge draws from existing open-source projects to blend user-friendly interfaces with advanced AI orchestration. Specific features of interest are noted below.

1. **SillyTavern** (GitHub: https://github.com/SillyTavern/SillyTavern)
   - **Features of Interest**:
     - Character card management: Import/export, backstories, avatars.
     - Lore books (WorldInfo): Contextual injections into prompts for story consistency.
     - Inline image generation: Trigger mid-chat via commands (e.g., "/gen image [desc]") using APIs like Stable Diffusion's web UI.
     - Visual novel mode: Narrative flair with backgrounds, portraits.
     - Multi-character conversations: Switching between NPCs.
     - Plugin/extensions system: For custom features.
     - Config.yaml for API setups (adapted to JSON/YAML in RoleForge).
     - Real-time chat interface with WebSockets.
  - Macros 2.0: Nested variables/expansions (e.g., {{char}} properties) for dynamic prompts.
     - Extensions like ST-Outfits/AlternateDescriptions: Dynamic character attributes.
     - WTracker: Stat/objective/relationship tracking.
     - ProsePolisher/Rewrite/MoreFlexibleContinues: Response shaping tools.
     - Advanced WorldInfo: Vector/scored lore activation.
     - Slash commands/STscript: In-chat controls.
     - Presence/CharSwitch: Group chat enhancements.

2. **Talemate** (GitHub: https://github.com/vegu-ai/talemate)
   - **Features of Interest**:
     - Multi-agent backend: Agents for narrator, dialogue, world keeper, summarizer, director, etc., collaborating for consistency.
     - World separation: Distinct "worlds" or campaigns with isolated state, lore, and scenes.
     - Scene management: Tracking time passage, long-term memory, and state updates.
     - Prompt templates: Jinja-like for customizable agent behaviors (ported to Nunjucks).
     - Image gen integration: Tied to scenes via backends like KoboldCpp.
     - Vue-based UI: Adapted to React for character/scenario building.
     - Director chat: Dedicated meta-discussion interface.
     - Visual library: Image browsing/iteration/analysis.

These inspirations are blended: SillyTavern's frontend simplicity with Talemate's agent sophistication, all in TypeScript/Node.

## Agent Design Reference

For detailed multi-agent system specifications, including per-agent LLM profiles, intentions, TypeScript implementations, and Nunjucks templates, refer to the design documents in the `.github` folder (`.github/agent-design.md`). This includes:
- BaseAgent abstract class.
- Specific agents: NarratorAgent, CharacterAgent, DirectorAgent, WorldAgent, SummarizeAgent, VisualAgent, CreatorAgent.
- Orchestrator for chaining agents.
- Connection profiles in `config.json` for flexible LLM backends (OpenAI-compatible, Kobold).

Do not duplicate agent details here; use `.github/agent-design.md` as the single source of truth for iteration.

## Feature Roadmap

This roadmap is numbered for sequential development, with detailed steps for each phase. It prioritizes a working base frontend from the start for rapid testing. Each phase includes setup, build/debug instructions, and key deliverables. Assume a monorepo structure with `backend/`, `frontend/`, and `shared/` folders.

### Phase 1: Project Setup and Base Frontend (Minimal Working App for Testing)
   - **Goal**: Establish monorepo, TypeScript configs, and a basic React frontend connected to a Node backend via Socket.io. Enable rapid testing with a simple chat interface.
   - **Setup**:
     - [x] Create root `package.json` with workspaces: `"workspaces": ["backend", "frontend", "shared"]`.
     - [x] Install root dev deps: `npm i -D typescript @types/node concurrently nodemon`.
     - [x] Run `npx tsc --init` for root `tsconfig.json` (target: ES2022, module: ESNext, strict: true).
     - [x] In `backend/`: `npm init -y; npm i express socket.io nunjucks axios openai; npm i -D typescript ts-node nodemon @types/express @types/node @types/nunjucks`.
     - [x] Backend `tsconfig.json` extends root, outDir: ../dist/backend.
     - [x] In `frontend/`: `npm create vite@latest . -- --template react-ts; npm i socket.io-client`.
     - [x] Frontend `vite.config.ts`: Add proxy for /api and /socket.io to http://localhost:3001.
     - [x] Root scripts: `dev:backend` (nodemon ts-node server.ts), `dev:frontend` (vite dev), `dev` (concurrently both), `build` (tsc -b && vite build).
   - **Backend Implementation**:
     - [x] Basic `server.ts`: Express server on 3001, Socket.io for 'chat' events (echo user messages initially).
     - [x] ConfigManager for loading `config.json` (start with dummy profiles).
   - **Frontend Implementation**:
     - [x] Simple chat UI in `App.tsx`: Input field, send button, message list.
     - [x] Use Socket.io-client to connect to backend, emit 'userMessage', listen for 'aiResponse'.
   - **Build/Debug**:
     - [x] Dev: `npm run dev` – Frontend at localhost:5173, proxy to backend.
     - [x] Debug: VSCode launch.json with ts-node for backend; Vite's built-in for frontend.
     - [x] Build: `npm run build` – Outputs dist/ for backend, frontend/build for deploy.
   - **Testing**: User types message, sees echo. Add console logs for Socket.io events.
   - **Deliverables**: Commit monorepo setup, basic chat working.

### Phase 2: LLM Integration and Basic Chat Proxy
   - **Goal**: Connect to LLM backends via profiles; proxy simple chat to OpenAI/Kobold.
   - **Setup**: 
     - [x] Add `llm/client.ts` with chatCompletion function supporting 'openai' and 'kobold' types.
   - **Implementation**:
     - [x] Update `server.ts`: On userMessage, resolve default profile, call LLM with basic prompt ("Respond as a storyteller: {{userInput}}").
     - [x] Use Nunjucks for initial prompt template (simple .njk file).
     - [x] Handle errors, stream responses if possible (Socket.io emit chunks).
     - [x] Add macro preprocessor: Resolve dynamic variables (e.g., {{char.name}}, {{user.location}}) before Nunjucks; support nested expansions as REQUIREMENT.
   - **Build/Debug**: 
     - [x] Add tests with Vitest (modern alternative to Jest, avoids deprecated dependencies); debug LLM calls with logs.
   - **Testing**: 
     - [x] User messages get AI replies; switch profiles in config.json.
   - **Deliverables**: 
     - [x] Functional LLM proxy; config.json with examples.

### Phase 3: Multi-Agent System Core
  - **Goal**: Implement agents from `.github/agent-design.md` (BaseAgent, Narrator, Character, Orchestrator).
   - **Setup**: 
     - [x] Create `agents/` folder with classes; `prompts/` with .njk files.
   - **Implementation**:
     - [x] Orchestrator processes userInput: Conditionally calls NarratorAgent for scene descriptions or CharacterAgent(s) for interactions.
     - [x] Per-agent profiles: Fetch via ConfigManager in each run().
     - [x] Context object: Pass {userInput, history, worldState, etc.} between agents.
     - [x] Basic state: In-memory history/worldState.
     - [x] LLM integration: renderLLMTemplate() with configurable templates (chatml.njk), sampler settings (temperature, maxTokens, maxContextTokens), and context trimming.
     - [x] Response cleaning: Remove thinking traces and malformed content.
   - **Build/Debug**: 
     - [x] Step-through chaining in debugger; Vitest unit tests for LLM client.
   - **Testing**: 
     - [x] Simple roleplay: User action → Narrated response + character dialogue.
   - **Deliverables**: 
     - [x] Agent classes/templates; basic orchestration; LLM client with advanced features.

### Phase 4: Character and Lore Management
   - **Goal**: UI and backend for characters/lore, inspired by SillyTavern.
     - **Data Models**: These are examples, with comments for clarity.
       - Lorebook schema found in .github/Lorebook_Schema.json. 
       - character schema found in .github/Character_Schema.json.
   - **Setup**: [x] Add SQLite (better-sqlite3) for persistence.
   - **Implementation**:
     - [x] Backend routes: CRUD for characters , lore books.
     - [x] Frontend: Character manager page/component; [ ] lore editor.
     - [x] Inject into prompts: e.g., Narrator template includes {{lore}}.
     - [x] Multi-character: Orchestrator instantiates CharacterAgents dynamically.
     - [x] frontend ui for selecting active character(s) in chat.
     - [x] frontend ui allow for importing of character/lore JSON files. (character import done, lore import not)
     - [x] Persona system for the user. To include in prompts as {{user.persona}}, this will also include description and other details. that will be editable in the frontend. 
     - [x] persona system will allow for multiple personas to be created and selected between.
   - **Build/Debug**: [x] Database migrations; debug injections.
   - **Testing**: [x] Create character, see in responses; [ ] lore affects story.
   - **Deliverables**: [x] Management UIs (character); [ ] persistence (lore).

### Phase 5: World Separation and State Tracking
   - **Goal**: Implement a robust, persistent hierarchy of **World → Campaign → Arc → Scene** with a sophisticated character override system. This phase provides the foundation for long-term storytelling, reusable settings, and consistent world state management — directly inspired by Talemate's world separation while integrating SillyTavern-style character and lore management.
   - All implementation must remain 100% TypeScript/Node.js with SQLite persistence and JSON fallbacks for easy editing/export.
   - **Clarifications and Requirements:**
     - Every change must include a fully operational frontend: all CRUD (Create, Read, Update, Delete) for World, Campaign, Arc, and Scene must be available in the UI, with no backend-only steps.
     - All unique identifiers (IDs, slugs, etc.) for these entities must be generated automatically by the backend/services. The user should never be required to create, edit, or even see these IDs.
     - Character override merge logic should be implemented within the CharacterService, not as a standalone utility.
     - Message logging must capture all chat events that appear in the chat window (user messages, AI/character replies, narrator descriptions, etc.).
     - When a scene is selected, the frontend must be able to retrieve the latest 100 messages by default, with the ability to load more via a separate API call.
     - Double-clicking a message in the frontend should allow editing its content (with appropriate backend support).
     - The narrator agent must only be called when explicitly requested by the user to describe something (retain current behavior).
     - The visualization agent must remain controlled by its configuration flag (retain current behavior).
     - All new tables and schema updates are permitted as needed; existing tables/files may be extended but not broken.
     - No major restructuring of existing systems: all updates must extend or improve current implementations, not replace them.
   - ### 1. Hierarchical Model Definitions
     - #### World
       - The top-level container representing a complete setting (e.g., "Eberron", "Cyberpunk RED", "Homebrew Sci-Fi Universe").
       - Contains:
         - [x] Global lore entries (lorebooks)
         - [x] World-level character overrides
         - [x] List of campaigns
     - #### Campaign
       - A self-contained story within a World.
       - Contains:
         - [x] Campaign metadata (name, description, start date, notes)
         - [x] Campaign-level character overrides
         - [x] List of arcs
         - [x] Current state (active arc/scene pointer, elapsed time, dynamic facts)
     - #### Arc
       - A major chapter or act in the campaign (e.g., "The Heist Setup", "Underground Chase").
       - Contains:
         - [x] Name, order index, description/goals
         - [x] Ordered list of scenes
     - #### Scene
       - The smallest narrative unit; the current "room" the player is in.
       - Contains:
         - [x] Title
         - [x] Description/summary
         - [x] Location name
         - [x] Time of day / elapsed minutes since campaign start
         - [x] Active characters (references with applied overrides)
         - [x] Scene-specific notes or triggers
         - [x] Optional background image/video references
         - [x] Flags (e.g., combat active, time frozen)
         - [x] Location relationships: Track spatial awareness (e.g., rooms/areas) for future location-based features.
   - ### 2. Character Override System
     - Characters use a layered override mechanism for maximum reuse and customization:
       1. **Base Character**  
          Defined system-wide in `data/characters/base/` or `BaseCharacters` table.  
          Full default definition: name, appearance, personality, backstory, traits, portrait URL, etc.
       2. **World-Level Override**  
          Optional patch in `worlds/<worldId>/characters/<charId>.override.json` or DB table.  
          Applied whenever the character appears in any campaign of this world.
       3. **Campaign-Level Override**  
          Optional patch in `worlds/<worldId>/campaigns/<campId>/characters/<charId>.override.json` or DB table.  
          Highest priority.
       4. **Merge Order** (at runtime):  
          `finalCharacter = deepMerge(base, worldOverride, campaignOverride)`  
          Later properties overwrite earlier ones. Use a deep merge utility (e.g., lodash.merge or custom).
       5. **Dynamic Runtime Attributes**  
          Extend overrides with mutable fields (e.g., outfits, personas) that can change via WorldAgent updates or user actions; persist in CampaignState.
       - This enables:
         - [x] Iconic characters with world-specific variations (e.g., Gandalf in Middle-earth vs. a parallel universe).
         - [x] Campaign-specific twists (ally → rival) without duplicating data.
   - ### 3. Storage Strategy
     - #### Primary: SQLite (via better-sqlite3)
       - [x] Recommended for type safety, querying, and future multi-user support.
       - **Schema**:
         ```sql
         -- Core Hierarchy
         CREATE TABLE Worlds (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           slug TEXT UNIQUE NOT NULL,          -- e.g., "forgotten-realms"
           name TEXT NOT NULL,
           description TEXT,
           createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE Campaigns (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
           slug TEXT NOT NULL,
           name TEXT NOT NULL,
           description TEXT,
           createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
           UNIQUE(worldId, slug)
         );
         CREATE TABLE Arcs (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           campaignId INTEGER REFERENCES Campaigns(id) ON DELETE CASCADE,
           orderIndex INTEGER NOT NULL,
           name TEXT NOT NULL,
           description TEXT,
           UNIQUE(campaignId, orderIndex)
         );
         CREATE TABLE Scenes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           arcId INTEGER REFERENCES Arcs(id) ON DELETE CASCADE,
           orderIndex INTEGER NOT NULL,
           title TEXT NOT NULL,
           description TEXT,
           location TEXT,
           timeOfDay TEXT,                     -- e.g., "dawn", "midnight"
           elapsedMinutes INTEGER DEFAULT 0,
           notes JSON,
           backgroundImage TEXT,               -- URL or generated ID
           locationRelationships JSON,         -- e.g., { "rooms": {"kitchen": ["user", "npc1"], "bedroom": ["npc2"]} } for future use
           UNIQUE(arcId, orderIndex)
         );
         -- Characters
         CREATE TABLE BaseCharacters (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           slug TEXT UNIQUE NOT NULL,
           data JSON NOT NULL                  -- full character object
         );
         CREATE TABLE WorldCharacterOverrides (
           worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
           characterId INTEGER REFERENCES BaseCharacters(id) ON DELETE CASCADE,
           overrideData JSON NOT NULL,
           PRIMARY KEY(worldId, characterId)
         );
         CREATE TABLE CampaignCharacterOverrides (
           campaignId INTEGER REFERENCES Campaigns(id) ON DELETE CASCADE,
           characterId INTEGER REFERENCES BaseCharacters(id) ON DELETE CASCADE,
           overrideData JSON NOT NULL,
           PRIMARY KEY(campaignId, characterId)
         );
         -- Lore & State
         CREATE TABLE LoreEntries (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
           key TEXT NOT NULL,
           content TEXT NOT NULL,
           tags JSON,
           UNIQUE(worldId, key)
         );
         CREATE TABLE CampaignState (
           campaignId INTEGER PRIMARY KEY REFERENCES Campaigns(id) ON DELETE CASCADE,
           currentSceneId INTEGER REFERENCES Scenes(id),
           elapsedMinutes INTEGER DEFAULT 0,
           dynamicFacts JSON DEFAULT '{}',      -- key facts updated by WorldAgent
           trackers JSON DEFAULT '{}',          -- e.g., { "stats": {"health": 100}, "objectives": ["quest1"], "relationships": {"npc1": "ally"} }
           updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
         );
         -- Message Logging for Persistence
         CREATE TABLE Messages (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
           messageNumber INTEGER NOT NULL,      -- sequential per scene
           message TEXT NOT NULL,
           sender TEXT NOT NULL,                -- e.g., "user:personaName" or "character:charName"
           timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
           charactersPresent JSON,             -- list of character slugs present at time of message
           UNIQUE(sceneId, messageNumber)
         );
         ```
     - #### Fallback/Export: File System (Optional Hybrid)
       - [x] Mirror structure in `data/worlds/` for easy manual editing/export:
         ```
         data/
         ├── characters/base/<slug>.json
         ├── worlds/<world-slug>/
         │   ├── world.json
         │   ├── lore/<key>.json
         │   ├── characters/<char-slug>.override.json
         │   └── campaigns/<campaign-slug>/
         │       ├── campaign.json
         │       ├── state.json
         │       ├── characters/<char-slug>.override.json
         │       └── arcs/<order>-<slug>/
         │           ├── arc.json
         │           └── scenes/<order>-<slug>.json
         ```
       - [x] Backend can sync DB ↔ files on demand.
   - ### 4. Backend Implementation
     - #### Services (backend/src/services/)
       - [x] `WorldService.ts` – CRUD worlds, list campaigns
       - [x] `CampaignService.ts` – CRUD campaigns, manage state, advance scene
       - [x] `ArcService.ts` / `SceneService.ts`
       - [x] `CharacterService.ts` – 
         - [x] getBaseCharacter(slug)
         - [x] getMergedCharacter({ worldId?, campaignId?, characterSlug })
         - [x] saveOverride(level: 'world'|'campaign', parentId, characterId, patch)
       - [x] `LoreService.ts` – getAllForWorld(worldId)
       - [x] `TrackerService.ts` – Manage stats/objectives/relationships; integrate with WorldAgent.
       - [x] `MessageService.ts` – Log and retrieve messages (default last 100, with options for more/range).
     - #### Session Context (passed to Orchestrator)
       ```ts
       interface SessionContext {
         world: { id: number; slug: string; name: string; loreEntries: LoreEntry[] };
         campaign: { id: number; slug: string; name: string };
         arc: { id: number; name: string; description?: string };
         scene: {
           id: number;
           title: string;
           description?: string;
           location: string;
           timeOfDay: string;
           elapsedMinutes: number;
         };
         activeCharacters: MergedCharacter[];  // fully resolved with overrides
         worldState: {
           elapsedMinutes: number;
           dynamicFacts: Record<string, any>;
         };
         trackers: { stats: Record<string, any>; objectives: string[]; relationships: Record<string, string> };
         locationMap: Record<string, string[]>;  // area → [entities present] for future use
       }
       ```
     - #### Orchestrator Updates
       - [x] On session init: Load full hierarchy via services → build SessionContext
       - [x] WorldAgent: May update `CampaignState.dynamicFacts` and advance `currentSceneId`
       - [x] DirectorAgent: Receives current arc description for pacing guidance
       - [x] WorldAgent: Also updates trackers (stats/objectives/relationships).
       - [x] Message Logging: Automatically log each user message and character agent response to Messages table, linked to scene.
   - ### 5. Frontend Implementation
     - #### Navigation & Selection
       - [x] Top bar: World dropdown → Campaign dropdown
       - [x] Sidebar: Tree view of Arcs → Scenes (collapsible)
       - [x] Current scene indicator with time/location display
     - #### Editors & CRUD
       - [x] World editor: Name, description, lorebook manager, full CRUD (create, edit, delete worlds)
       - [x] Campaign editor: Metadata, character override UI (form or JSON patch), full CRUD
       - [x] Arc/Scene editor: Reorderable lists, rich text descriptions, full CRUD
       - [x] Character override editor: Side-by-side diff view (base vs. current)
       - [x] Tracker editor: UI for stats/objectives/relationships.
     - #### Message Management
       - [x] When a scene is selected, display the latest 100 messages by default, with a UI to load more (older) messages as needed.
       - [x] Double-clicking a message allows editing its content in the frontend, with changes persisted to the backend.
     - #### Real-time Updates
       - [x] Socket.io events: `sceneAdvanced`, `stateUpdated`, `characterOverrideChanged`
       - [x] Chat component receives full SessionContext updates
   - ### 6. Testing Requirements
     - [x] 1. Create "Test World" with two campaigns.
     - [x] 2. Add base character "Wizard" → world override (blue robes) → campaign override (scarred face).
     - [x] 3. Verify merged character shows correct final appearance.
     - [x] 4. Advance through multiple scenes → confirm elapsed time and dynamic facts persist.
     - [x] 5. Switch campaigns → verify isolation.
     - [x] 6. Manual override edit → immediate reflection in next AI response.
   - ### 7. Deliverables
     - [x] SQLite schema + migration script (using better-sqlite3 prepared statements)
     - [x] All service classes with TypeScript interfaces
     - [x] Character deep-merge utility
     - [x] Backend API routes (REST + Socket.io events)
     - [x] Frontend components:
       - [x] World/Campaign selector
       - [x] Hierarchy tree view
       - [x] Override editor
       - [x] Current scene/status display
     - [x] Updated Orchestrator to use full SessionContext
     - [x] Message logging system with retrieval API
     - [x] Sample data (at least one complete world + campaign)
   - This phase completes the structural backbone needed for rich, persistent roleplaying campaigns. Once complete, Phase 5A (Advanced Lore) and Phase 5B (Location Awareness) can add optional enhancements.

### Phase 5 Supplemental

These features were added during Phase 5 work but were not explicitly listed in the original Phase 5 roadmap:

- [x] **Inline message editor UI:** An in-place multiline editor appears on double-click, with icon controls for Save (green check), Cancel (red X), Delete (trash), Move Up/Down (arrows). Delete reorders later messages to keep sequential numbering.
- [x] **Message reordering semantics:** Deleting a message decrements subsequent `messageNumber`s in the same scene; moving a message swaps `messageNumber` values with the neighbor inside a transaction to avoid UNIQUE conflicts.
- [x] **Inline-quote highlighting:** Implemented automatic wrapping of text in double-quotes with a styled `<span class="inline-quote">` and enabled `rehype-raw` to render that safely for ReactMarkdown, giving inline quoted strings the yellow-orange color used in the UI.
- [x] **Persona UX polish:** Persona thumbnail dropdown with proper selection handling (pointer events fix), avatar-first lookup (personas preferred over characters), persona GET/PUT endpoints and persisted selected persona setting, and persona avatar upload endpoints.
- [x] **Active characters UI:** Added a people-plus icon to open an active-characters modal and persistence of active character selection in `localStorage` to mirror the chat's active cast.
- [x] **Race-condition guards:** Added request-id + selectedSceneRef patterns when loading messages to discard stale fetch results and avoid UI glitches during fast scene switches.
- [x] **Visual tag handling:** Basic parsing/rendering of `[VISUAL: prompt]` tags in AI responses so the frontend shows a visual placeholder/tag with the prompt.
- [x] **Small UX and CSS polish:** Centered root layout (90% width), adjusted chat/input widths to match, colored blockquotes and inline elements per design, and added message metadata under avatars.

### Phase 5A: Advanced Lore (Optional)
   - **Goal**: Enhance LoreService with vector storage/embeddings for scored activation and RAG-like data banks.
   - **Implementation**: Integrate embeddings (e.g., via external API or JS library), vector search for contextual retrieval, inject top-k relevant lore into prompts.
   - **Deliverables**: Updated LoreService, embedding utilities, RAG integration.

### Phase 5B: Location Awareness (Optional)
   - **Goal**: Implement spatial separation for conversations/actions.
   - **Implementation**: Filter CharacterAgent calls based on locationMap, enforce hearing rules (e.g., adjacent areas audible).
   - **Deliverables**: Location-based filtering in Orchestrator, configurable scene flags.

### Phase 6: Visual Generation Integration
   - **Goal**: Inline image/video gen, triggered manually or auto.
   - **Setup**: Add `integrations/stableDiffusion.ts` with Axios to API (e.g., /sdapi/v1/txt2img).
   - **Implementation**:
     - [x] VisualAgent: Generates prompts, calls API, returns <img>/<video> tags.
     - [x] Triggers: Parse [GEN_IMAGE] in responses or user commands (/image [desc]).
     - [x] Frontend: Render inline in chat (Markdown support via react-markdown).
     - Add visual library: UI for browsing chat history images; support regeneration, inpainting/reference editing, image analysis.
   - **Build/Debug**: Mock API responses; debug rendering.
   - **Testing**: Command triggers image; auto in dramatic scenes.
   - **Deliverables**: Visual UI elements; API proxy.

### Phase 6b: Audio Integration (TTS)
   - **Goal**: Add TTS for immersive playback, inspired by SillyTavern/Talemate.
   - **Setup**: Add TTSAgent class (extends BaseAgent) with .njk template; proxy to ElevenLabs/Coqui/local APIs.
   - **Implementation**:
     - Per-character voice config in character data/overrides.
     - Trigger via slash commands (/tts on) or auto in visual novel mode.
     - Frontend: Audio player for narrated responses/dialogue.
   - **Build/Debug**: Mock TTS API; test per-character voices.
   - **Testing**: Generate speech for scenes; verify separation.
   - **Deliverables**: TTSAgent, voice configs, playback UI.

### Phase 7: Advanced Features and Polish
   - **Goal**: Extensions, visual novel mode, mobile responsiveness.
    - Add response shaping: Core buttons for continue/regen/edit selected; plugin hooks for advanced tools like ProsePolisher.
     - Director chat: Dedicated UI pane for meta-discussion with DirectorAgent.
   - **Setup**: `plugins/` folder for dynamic JS modules.
   - **Implementation**:
     - CreatorAgent for on-demand generation (/create character).
     - Visual novel: Backgrounds/portraits from gen.
     - Auth/multi-user: Optional JWT.
     - Mobile: Tailwind or CSS for responsive.
   - **Build/Debug**: Plugin loading tests; E2E with Cypress.
   - **Testing**: Full roleplay sessions; edge cases.
   - **Deliverables**: Plugins system; UI enhancements.

### Phase 7b: Immersive Enhancements (Optional Polish)
   - **Goal**: Final extensions for advanced users.
   - **Implementation**: Full plugin system for custom slash commands, trackers, etc.
   - **Deliverables**: Documentation for extending features.

### Phase 8: Deployment and Optimization
   - **Goal**: Production-ready; Docker, performance.
   - **Setup**: Dockerfile for monorepo; PM2 for Node.
   - **Implementation**:
     - Build scripts: Bundle frontend into backend static.
     - Optimizations: Context trimming, caching.
   - **Build/Debug**: Prod builds; load testing.
   - **Testing**: Deploy to local Docker; simulate users.
   - **Deliverables**: Deployment guide; optimized code.

## Iteration Guidelines

- **Development Cycle**: Use Git branches per phase; PRs with tests.
- **Copilot Usage**: Reference this MD and .github/agent-design.md for specs; iterate via user feedback.
- **Server Management**: Do not attempt to start the frontend or backend servers unless explicitly directed by the user. If testing requires running the application, request the user to execute the necessary commands and provide the output for analysis.
- **Extensibility**: All features modular; easy to add agents/plugins.
- **Testing Focus**: Rapid frontend iterations; ensure Socket.io reliability.
- **Future Expansions**: TTS, more gen backends, multiplayer.
