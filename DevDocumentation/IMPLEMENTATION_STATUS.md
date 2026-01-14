# RoleForge Implementation Status

**Last Updated:** January 14, 2026  
**Status:** Phases 1-5 Complete, Phases 6-8 In Design

---

## Executive Summary

RoleForge is a full-stack TypeScript application providing an immersive AI-guided roleplaying experience. It features a multi-agent backend orchestrator, world/campaign/arc/scene hierarchy, character management with override system, lore injection, tracker/state management, and real-time chat via Socket.io.

**Current Implementation**: ✅ Phase 1-5 Complete (Production Ready)
**Remaining**: 📋 Phase 6-8 (Visual Gen, Audio, Advanced Polish)

---

## Architecture Overview

### Technology Stack
- **Backend**: Node.js, Express, Socket.io, Nunjucks templating
- **Frontend**: React (TypeScript), Vite, Socket.io-client, Tailwind CSS
- **Database**: SQLite (better-sqlite3) for persistence
- **LLM Integration**: OpenAI-compatible API clients (OpenAI, Kobold, custom)
- **Image Generation**: Stable Diffusion API proxy, ComfyUI support

### System Design
- **Modular Agents**: Separate orchestration agents for different concerns
- **Real-time Communication**: Socket.io for bidirectional chat updates
- **Persistent State**: SQLite with migrations for data versioning
- **Template Engine**: Nunjucks for dynamic prompt assembly with macro expansion
- **Configuration**: JSON-based LLM profiles with per-agent customization

---

## Phase 1: Core Backend & Frontend ✅ COMPLETE

### Implementation
- ✅ Monorepo structure (backend, frontend, shared folders)
- ✅ TypeScript configuration across all packages
- ✅ Express server (port 3001) with Socket.io integration
- ✅ Vite React frontend (port 5173) with dev proxy
- ✅ Basic chat UI with message history
- ✅ Root workspace with build/dev scripts

### Files
- `backend/src/server.ts` - Main Express server
- `frontend/src/App.tsx` - React root component
- `package.json` (root and workspace packages)

---

## Phase 2: LLM Integration & Chat Proxy ✅ COMPLETE

### Implementation
- ✅ LLM client with retry logic and fallback profiles
- ✅ Support for OpenAI-compatible and Kobold APIs
- ✅ Nunjucks templating for dynamic prompt assembly
- ✅ Macro preprocessor for variable expansion ({{char}}, {{user}}, nested properties)
- ✅ Token counting and context trimming
- ✅ Streaming response support
- ✅ Response cleaning and JSON parsing with repair
- ✅ Per-message backslash escaping (\\\ → \)

### Key Features
- Max retries: 3 with exponential backoff
- Retryable errors: Network failures, 429/503 status codes
- Token budget enforcement with history trimming
- Sampler configuration: temperature, top_p, frequency_penalty, presence_penalty
- Multiple LLM profile fallback support

### Files
- `backend/src/llm/client.ts` - LLM integration
- `backend/src/configManager.ts` - Profile management
- `backend/src/utils/tokenCounter.ts` - Token estimation

---

## Phase 3: Multi-Agent System ✅ COMPLETE

### Implemented Agents

#### 1. **BaseAgent** (Abstract)
- Foundation class for all agents
- Handles template rendering and LLM calls
- Supports per-agent LLM profile selection

#### 2. **CharacterAgent**
- Role: Individual NPC responses
- Template: `character.njk`
- Context: Character data, state, user persona, world state
- Output: JSON with response + character state updates
- **NEW**: Receives and reacts to previous character responses in same turn

#### 3. **NarratorAgent**
- Role: Scene descriptions and narrative guidance
- Template: `narrator.njk`
- Triggered: Only on explicit user request ("/describe")

#### 4. **WorldAgent**
- Role: World state and tracker management
- Template: `world.njk`
- Context: Recent events, scene context, user actions
- Output: JSON with world state + tracker updates
- **NEW**: Explicit parsing of location, clothing, activity changes for user persona

#### 5. **DirectorAgent**
- Role: Character selection and pacing guidance
- Template: `director.njk`
- Output: JSON with character list and guidance text

#### 6. **SummarizeAgent**
- Role: Long-term memory compression
- Template: `summarize.njk`
- Triggered: When history > 10 messages

#### 7. **VisualAgent**
- Role: Image generation prompts
- Template: `visual.njk`
- Controlled by config flag: `visualAgentEnabled`

#### 8. **CreatorAgent**
- Role: Dynamic character/object generation
- Template: `creator.njk`
- Triggered: Via /create slash command

### Orchestrator Flow
1. User input received
2. Check for slash commands (/describe, /create, /image, etc.)
3. Initialize world state and character states
4. **Step 1**: Summarize if history > 10 messages
5. **Step 2**: Director selects which characters respond
6. **Step 3**: WorldAgent updates state and trackers
7. **Step 4**: CharacterAgent responses (in sequence, each sees previous)
8. **Step 5**: Save state and return responses

### Files
- `backend/src/agents/BaseAgent.ts`
- `backend/src/agents/Orchestrator.ts`
- `backend/src/agents/{Character,Narrator,Director,World,Summarize,Visual,Creator}Agent.ts`
- `backend/src/prompts/{character,narrator,director,world,summarize,visual,creator}.njk`

---

## Phase 4: Character & Lore Management ✅ COMPLETE

### Character Management

#### Data Structure
- **Base Characters**: System-wide definitions in `data/characters.db`
- **Character Fields**: Name, description, personality, appearance, skills, relationships, etc.
- **Dynamic Fields**: Clothing, mood, activity, position, location
- **Avatar**: Image uploads to `frontend/public/avatars/`

#### Frontend Components
- ✅ CharacterManager.tsx - CRUD interface
- ✅ Character import/export (JSON)
- ✅ Avatar upload and preview
- ✅ Active character selection modal

#### Services
- `CharacterService.ts` - CRUD + avatar management
- Integration with scene-level character states

### Persona System

#### Features
- ✅ Multiple user personas (profiles)
- ✅ Per-persona customization (name, description, appearance, personality)
- ✅ Avatar support for personas
- ✅ Persistent persona selection in localStorage
- ✅ Persona state tracking in scenes

#### Frontend
- PersonaManager.tsx - Full CRUD
- Persona dropdown with thumbnail selection
- Avatar-first lookup (personas over characters)

### Lore/Lorebook Management

#### Data Structure
```json
{
  "uuid": "unique-id",
  "name": "Lorebook name",
  "description": "...",
  "entries": [
    {
      "uid": "entry-id",
      "key": "Trigger keywords",
      "content": "Lore content",
      "insertion_position": "Before Char Defs",
      "enabled": true,
      "priority": 100
    }
  ]
}
```

#### Features
- ✅ Lore CRUD operations
- ✅ World-level lore entries (global)
- ✅ Campaign/Arc/Scene level association
- ✅ Contextual lore injection based on user input + history
- ✅ Priority-based scoring and sorting

#### Services
- `LorebookService.ts` - Lore CRUD
- `loreMatcher.ts` - Keyword matching and lore activation
- Integration into agent contexts via `formattedLore`

### Files
- `backend/src/services/CharacterService.ts`
- `backend/src/services/LorebookService.ts`
- `frontend/src/CharacterManager.tsx`
- `frontend/src/PersonaManager.tsx`
- `frontend/src/LoreManager.tsx`

---

## Phase 5: World Separation & State Tracking ✅ COMPLETE

### Hierarchical Model

#### World
- Top-level container for complete setting
- Contains campaigns, global lore, world-level character overrides
- Metadata: name, description

#### Campaign
- Self-contained story within a world
- Contains arcs and scenes
- Campaign state: elapsed time, current scene, dynamic facts, trackers
- Campaign-level character overrides

#### Arc
- Major chapter or act
- Contains ordered scenes
- Metadata: name, description, order index

#### Scene
- Smallest narrative unit (current "room")
- Contains messages, character states, world state
- Metadata: title, location, time of day, elapsed minutes
- Scene-specific character overrides

### Character Override System

#### Three-Level Merge
1. **Base Character** - System-wide definition
2. **World Override** - Applied to all campaigns in world
3. **Campaign Override** - Highest priority

#### Merge Logic
```
finalCharacter = deepMerge(base, worldOverride, campaignOverride)
```
Properties flow through levels, later levels override earlier.

#### Services
- `WorldService.ts` - World CRUD
- `CampaignService.ts` - Campaign CRUD + state management
- `ArcService.ts` - Arc CRUD
- `SceneService.ts` - Scene CRUD + character state management
- `CharacterService.ts` - Override merge logic

### State Tracking

#### CampaignState (Per-Campaign)
```sql
{
  campaignId: number,
  currentSceneId: number,
  elapsedMinutes: number,
  dynamicFacts: JSON,
  trackers: {
    stats: { [key]: value },
    objectives: [string],
    relationships: { [npc]: status }
  }
}
```

#### SceneState (Per-Scene)
```sql
{
  worldState: JSON,
  characterStates: { [charName]: state },
  userPersonaState: state,
  activeCharacters: [charData]
}
```

### Message Logging

#### Database Schema
```sql
CREATE TABLE Messages (
  id INTEGER PRIMARY KEY,
  sceneId INTEGER,
  messageNumber INTEGER,
  message TEXT,
  sender TEXT,
  timestamp DATETIME,
  charactersPresent JSON,
  tokenCount INTEGER,
  metadata JSON,
  source TEXT
)
```

#### Features
- ✅ Sequential message numbering per scene
- ✅ Default 100 messages on load, with pagination
- ✅ Inline editing (double-click to edit, reorder on delete)
- ✅ Message metadata (images, visual tags)
- ✅ Character presence tracking

#### Services
- `MessageService.ts` - Message CRUD and retrieval

### Frontend Components

#### Navigation & Selection
- ✅ World/Campaign dropdown selectors
- ✅ Sidebar hierarchy (Arcs → Scenes tree)
- ✅ Current scene indicator
- ✅ Active characters modal

#### Editors
- ✅ WorldManager.tsx - Full world/campaign/arc/scene CRUD
- ✅ Character override UI with merge preview
- ✅ Tracker editor (stats/objectives/relationships)

#### Chat & Messages
- ✅ Chat.tsx - Real-time message display
- ✅ Inline message editor (double-click to edit)
- ✅ Message reordering/deletion with sequential updates
- ✅ Metadata display (sender, timestamp, tokens)

#### World Status Panel
- ✅ WorldStatus.tsx - Inline editable world state display
- ✅ Trackers section with bulleted objectives
- ✅ Character states section with edit support
- ✅ Responsive panel layout (384px width constraint)

### Session Context

Passed to agents during processing:
```ts
{
  world: { id, slug, name, loreEntries },
  campaign: { id, slug, name },
  arc: { id, name, description },
  scene: { id, title, location, timeOfDay, characterStates },
  activeCharacters: [mergedCharacters],
  worldState: dynamicFacts,
  trackers: { stats, objectives, relationships },
  userPersona: userData,
  formattedLore: injectedLore
}
```

### Files
- `backend/src/services/{World,Campaign,Arc,Scene,CharacterService}.ts`
- `backend/src/agents/Orchestrator.ts` - Session context builder
- `frontend/src/WorldManager.tsx`
- `frontend/src/components/{Chat,Panel,WorldStatus}.tsx`

---

## Phase 5 Supplemental Features ✅ COMPLETE

### Inline Message Editor
- ✅ Double-click to open multiline textarea
- ✅ Save (green check), Cancel (red X), Delete (trash) buttons
- ✅ Move Up/Down arrows for reordering
- ✅ Sequential message renumbering on delete

### Message Reordering Semantics
- ✅ Delete decrements subsequent message numbers
- ✅ Move swaps message numbers (transactional)
- ✅ Avoids UNIQUE constraint violations

### Inline-Quote Highlighting
- ✅ Auto-wrap quoted text with `<span class="inline-quote">`
- ✅ Yellow-orange color styling
- ✅ ReactMarkdown rehype-raw integration for safe rendering

### Persona UX Polish
- ✅ Persona thumbnail dropdown
- ✅ Avatar-first lookup (personas preferred)
- ✅ Persona GET/PUT endpoints
- ✅ Avatar upload to `public/avatars/`
- ✅ Persona selection persistence in localStorage

### Active Characters UI
- ✅ People-plus icon to open modal
- ✅ Multi-select for active characters
- ✅ Selection persistence in localStorage
- ✅ Real-time updates via Socket.io

### Race Condition Guards
- ✅ Request-id + ref tracking for message loads
- ✅ Discard stale fetch results during fast scene switches

### Visual Tag Handling
- ✅ Parse `[VISUAL: prompt]` tags in responses
- ✅ Render visual placeholder with prompt text
- ✅ Image inline rendering support

### CSS & Layout Polish
- ✅ Centered root layout (90% width)
- ✅ Chat/input width matching
- ✅ Blockquote and inline element styling
- ✅ Message metadata under avatars
- ✅ Panel width constraints (384px right, 320px left)

---

## Core Features Implementation

### Multi-Character Conversations ✅ COMPLETE

**Implementation Details:**
- **Sequential Character Processing**: Characters respond one at a time to user input
- **Contextual Awareness**: Each character receives:
  - User's original message
  - Responses from previously triggered characters in the same turn
  - Full world state and scene context
- **Response Tracking**: `turnResponses` array accumulates character responses
- **History Integration**: Previous character responses injected with `[Other Characters in this turn:]` label
- **Acknowledgment**: Character prompt explicitly instructs reacting naturally to other responses
- **No Duplication**: Characters instructed not to repeat what others said

**Example Flow (User, CharA, CharB):**
1. User sends message
2. CharA triggered with: `history = [User: message]`
3. CharA responds
4. CharB triggered with: `history = [User: message, [Other Characters:] CharA: response]`
5. CharB sees CharA's response and reacts

### World State Management ✅ COMPLETE

**Features:**
- ✅ Persistent world facts across scenes
- ✅ Dynamic user persona state tracking (location, clothing, mood, activity)
- ✅ Tracker state: stats (key-value), objectives (array), relationships (dict)
- ✅ Scene-level facts + global dynamic facts
- ✅ User persona state extraction from recent events
- ✅ Clothing/location/activity change detection in messages
- ✅ "Unchanged" state optimization (no-op saves)

**WorldAgent Enhancements:**
- Explicit parsing keywords for state extraction
- Examples in prompt for location ("entered", "went to", "arrived at")
- Examples for clothing ("put on", "wore", "dressed in", "took off")
- Must include `userPersonaState` in output
- Validates against "default" and "Default" sentinel values

### Prompt Templates ✅ COMPLETE

#### character.njk
- Character profile injection
- Current state (clothing, mood, activity, location, position)
- User persona context
- World state and trackers
- Formatted lore
- Message history
- Output: JSON with response + state updates
- **NEW**: Instructions to acknowledge other characters' responses

#### director.njk
- Scene context and history
- Active characters list
- Guidance request
- Output: JSON with characters to respond + guidance text

#### world.njk
- Scene context (location, time)
- Previous world state
- User persona state
- Current trackers
- Formatted lore
- Recent events
- Output: JSON with world state + trackers updates
- **NEW**: Explicit parsing instructions for location, clothing, activity changes

#### narrator.njk
- Scene description prompt
- Output: Narrative text

#### summarize.njk
- Long history compression
- Output: JSON with summary

#### visual.njk
- Image generation prompt assembly
- Output: Image description/prompt

#### creator.njk
- Dynamic character/entity creation
- Output: JSON with new entity data

### Lore Injection ✅ COMPLETE

**Features:**
- ✅ Keyword-based matching against user input + history
- ✅ Priority-based sorting (higher priority injected first)
- ✅ Context-aware activation (relevant to current scene)
- ✅ Formatted insertion with boundaries
- ✅ Integration into all agent contexts
- ✅ Multi-level association (World/Campaign/Arc/Scene)

**Scoring Algorithm:**
- Keyword frequency in input
- Priority level
- Recency weighting
- Context relevance

### Configuration Management ✅ COMPLETE

**Features:**
- ✅ JSON-based LLM profiles
- ✅ Per-agent profile override
- ✅ Sampler settings: temperature, top_p, frequency_penalty, presence_penalty
- ✅ Format options (JSON, text)
- ✅ Model and baseURL configuration
- ✅ API key management
- ✅ Fallback profile chain

**Profile Structure:**
```json
{
  "name": "default",
  "type": "openai",
  "baseURL": "http://localhost:8000",
  "apiKey": "sk-...",
  "model": "model-name",
  "sampler": {
    "temperature": 0.7,
    "topP": 0.9,
    "max_completion_tokens": 400
  }
}
```

### Error Handling & Resilience ✅ COMPLETE

**Features:**
- ✅ Exponential backoff retry logic (3 max retries)
- ✅ Retryable error detection (network, 429, 503, etc.)
- ✅ Non-retryable error fast-fail
- ✅ Fallback profile chain
- ✅ JSON parsing with 3-attempt repair
- ✅ Graceful degradation (plain text fallback)
- ✅ Detailed error logging with context

### Prompt Optimization ✅ COMPLETE

**Features:**
- ✅ Context trimming based on max token budget
- ✅ Preservation of system message + current user input
- ✅ Recent history prioritization
- ✅ Token counting estimation
- ✅ Macro expansion before templating
- ✅ Nested property access ({{char.appearance.age}})

---

## Database Schema

### Worlds
```sql
CREATE TABLE Worlds (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Campaigns
```sql
CREATE TABLE Campaigns (
  id INTEGER PRIMARY KEY,
  worldId INTEGER REFERENCES Worlds(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(worldId, slug)
);
```

### Arcs
```sql
CREATE TABLE Arcs (
  id INTEGER PRIMARY KEY,
  campaignId INTEGER REFERENCES Campaigns(id),
  orderIndex INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE(campaignId, orderIndex)
);
```

### Scenes
```sql
CREATE TABLE Scenes (
  id INTEGER PRIMARY KEY,
  arcId INTEGER REFERENCES Arcs(id),
  orderIndex INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  timeOfDay TEXT,
  elapsedMinutes INTEGER DEFAULT 0,
  worldState JSON DEFAULT '{}',
  lastWorldStateMessageNumber INTEGER DEFAULT 0,
  characterStates JSON DEFAULT '{}',
  activeCharacters JSON DEFAULT '[]',
  UNIQUE(arcId, orderIndex)
);
```

### CampaignState
```sql
CREATE TABLE CampaignState (
  campaignId INTEGER PRIMARY KEY REFERENCES Campaigns(id),
  currentSceneId INTEGER REFERENCES Scenes(id),
  elapsedMinutes INTEGER DEFAULT 0,
  dynamicFacts JSON DEFAULT '{}',
  trackers JSON DEFAULT '{}',
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Messages
```sql
CREATE TABLE Messages (
  id INTEGER PRIMARY KEY,
  sceneId INTEGER REFERENCES Scenes(id),
  messageNumber INTEGER NOT NULL,
  message TEXT NOT NULL,
  sender TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  charactersPresent JSON,
  tokenCount INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  source TEXT DEFAULT '',
  UNIQUE(sceneId, messageNumber)
);
```

### Characters & Personas
```sql
CREATE TABLE characters (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  avatarUrl TEXT,
  description TEXT,
  personality TEXT,
  skinTone TEXT DEFAULT 'white',
  /* Additional fields... */
);

CREATE TABLE personas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT,
  avatarUrl TEXT,
  race TEXT DEFAULT 'Caucasian',
  skinTone TEXT DEFAULT 'white'
);
```

### Lorebooks
```sql
CREATE TABLE lorebooks (
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  entries TEXT  -- JSON array
);
```

---

## API Endpoints

### World Management
- `GET /api/worlds` - List all worlds
- `POST /api/worlds` - Create world
- `PUT /api/worlds/:id` - Update world
- `DELETE /api/worlds/:id` - Delete world

### Campaigns
- `GET /api/worlds/:worldId/campaigns` - List campaigns
- `POST /api/worlds/:worldId/campaigns` - Create campaign
- `GET /api/campaigns/:id` - Get campaign
- `PUT /api/campaigns/:id` - Update campaign
- `DELETE /api/campaigns/:id` - Delete campaign
- `GET /api/campaigns/:id/state` - Get campaign state
- `PUT /api/campaigns/:id/state` - Update campaign state

### Arcs & Scenes
- `GET /api/campaigns/:campaignId/arcs` - List arcs
- `POST /api/campaigns/:campaignId/arcs` - Create arc
- `GET /api/arcs/:id/scenes` - List scenes
- `POST /api/arcs/:id/scenes` - Create scene
- `GET /api/scenes/:id` - Get scene
- `PUT /api/scenes/:id` - Update scene
- `GET /api/scenes/:sceneId/session` - Build session context

### Messages
- `GET /api/scenes/:sceneId/messages?limit=100&offset=0` - List messages
- `POST /api/scenes/:sceneId/messages` - Create message
- `PUT /api/scenes/:sceneId/messages/:messageId` - Edit message
- `DELETE /api/scenes/:sceneId/messages/:messageId` - Delete message
- `PUT /api/scenes/:sceneId/messages/:messageId/move` - Reorder message

### Characters & Personas
- `GET /api/characters` - List characters
- `POST /api/characters` - Create character
- `GET /api/characters/:id` - Get character
- `PUT /api/characters/:id` - Update character
- `DELETE /api/characters/:id` - Delete character
- `POST /api/characters/:id/avatar` - Upload avatar
- `GET /api/personas` - List personas
- `POST /api/personas` - Create persona
- `GET /api/personas/:id` - Get persona
- `PUT /api/personas/:id` - Update persona

### Lore
- `GET /api/lorebooks` - List lorebooks
- `POST /api/lorebooks` - Create lorebook
- `GET /api/lorebooks/:id` - Get lorebook
- `PUT /api/lorebooks/:id` - Update lorebook
- `DELETE /api/lorebooks/:id` - Delete lorebook

### Chat
- `POST /api/chat` - Process user message
- `POST /api/chat/stream` - Stream response

---

## Socket.io Events

### Server → Client
- `aiResponse` - Agent response received
- `stateUpdated` - World state/trackers changed
- `characterStatesUpdated` - Character states changed
- `sceneAdvanced` - Scene advanced/changed
- `agentStatus` - Agent processing status (start/complete)
- `messageAdded` - New message in scene
- `typingIndicator` - User typing

### Client → Server
- `userMessage` - User sends message
- `activeCharactersChanged` - Active character selection changed
- `sceneSelected` - User selected scene

---

## Key Code Patterns & Standards

### Nunjucks Templating
```njk
{{ variable }}           -- Variable insertion
{{ object.property }}    -- Property access
{{ array | length }}     -- Filters
{% for item in array %} -- Loops
{% if condition %}       -- Conditionals
{# Comment #}           -- Comments
```

### Macro Expansion
Before Nunjucks rendering, preprocess:
- `{{char.name}}` - Character name
- `{{user.persona}}` - User persona name
- `{{scene.location}}` - Current location
- Nested properties: `{{char.appearance.age}}`

### JSON Response Format
```json
{
  "response": "Character's dialogue/action",
  "characterState": {
    "clothingWorn": "description",
    "mood": "emotional state",
    "activity": "current action",
    "location": "current location",
    "position": "stance/position"
  }
}
```

### Error Handling
```typescript
try {
  // Operation
} catch (error) {
  console.error('Context: description', { error, context });
  if (isRetryableError(error)) {
    // Retry with backoff
  } else {
    // Fast fail
  }
}
```

### Async Agent Processing
```typescript
const agent = this.agents.get(agentName)!;
this.emitAgentStatus(agentName, 'start', sceneId);
const response = await agent.run(context);
this.emitAgentStatus(agentName, 'complete', sceneId);
```

### State Management Pattern
```typescript
const existing = StateService.get(id);
if (!existing) {
  // Create with defaults
  StateService.create(defaults);
} else {
  // Update selective fields
  StateService.update(id, updates);
}
```

---

## Development Workflow

### Running Locally
```bash
# Install dependencies
npm install

# Backend (port 3001)
npm run dev:backend

# Frontend (port 5173)
npm run dev:frontend

# Both (concurrently)
npm run dev
```

### Configuration
1. Copy `backend/config.example.json` to `backend/config.json`
2. Add LLM profiles (OpenAI, Kobold, etc.)
3. Set API keys
4. Configure sampler defaults

### Database Migrations
- Migrations in `backend/migrations/`
- Run automatically on server start
- Schema defined in `backend/src/database.ts`

### Testing
- Unit tests: `backend/src/__tests__/`
- Run: `npm run test` (Vitest)
- Coverage for LLM client, agents, services

---

## Known Limitations & Future Work

### Phase 6: Visual Generation (📋 Planned)
- VisualAgent framework exists (agent/template/config flag)
- Needs: Stable Diffusion proxy completion, image library UI
- Features: Inline image generation, iteration/regeneration

### Phase 6b: Audio Integration (📋 Planned)
- Framework: TTSAgent class, per-character voice config
- Needs: TTS API integration (ElevenLabs, Coqui, local)
- Features: Narrated playback, dialogue voices

### Phase 7: Advanced Features (📋 Planned)
- Response shaping tools (continue/regen/edit)
- Director chat UI pane
- Plugin system for custom slash commands
- Mobile responsiveness

### Phase 8: Deployment (📋 Planned)
- Docker containerization
- Production build optimization
- Performance tuning (caching, context trimming)
- Multi-user support (optional JWT auth)

---

## File Organization

```
RoleForge/
├── backend/
│   ├── src/
│   │   ├── agents/          -- Agent implementations
│   │   ├── services/        -- Data services
│   │   ├── llm/             -- LLM integration
│   │   ├── prompts/         -- Nunjucks templates
│   │   ├── utils/           -- Utilities
│   │   ├── server.ts        -- Express setup
│   │   ├── database.ts      -- SQLite init
│   │   └── configManager.ts -- LLM profiles
│   ├── config.json          -- LLM profiles
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      -- React components
│   │   ├── App.tsx          -- Root component
│   │   ├── ChatManager.tsx   -- Chat logic
│   │   ├── WorldManager.tsx  -- World CRUD
│   │   └── index.css        -- Tailwind
│   ├── vite.config.ts       -- Vite setup
│   └── package.json
├── .github/
│   ├── IMPLEMENTATION_STATUS.md (this file)
│   ├── copilot-instructions.md   -- Coding standards
│   └── [schema files]
└── package.json (root)
```

---

## Deployment Checklist

- [ ] Update `backend/config.json` with production LLM endpoints
- [ ] Verify database migrations applied
- [ ] Build: `npm run build`
- [ ] Test: `npm run test`
- [ ] Run production: `node dist/backend/server.js` (after build)
- [ ] Frontend served via backend or separate static host
- [ ] Environment: Set NODE_ENV=production
- [ ] Monitor: LLM API usage, database size, log files

---

## Contact & Support

For implementation details, refer to:
- `.github/agent-design.md` - Agent specifications
- `.github/copilot-instructions.md` - Coding standards
- `backend/BACKEND_SUPPORT.md` - Backend development guide
- `backend/ERROR_HANDLING.md` - Error handling patterns
- Individual agent template comments in `backend/src/prompts/`
