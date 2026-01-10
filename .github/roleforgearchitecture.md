# RoleForge Architecture Document

## Overview

RoleForge is a full-stack TypeScript application designed for immersive AI-guided roleplaying experiences. It integrates local or remote Large Language Models (LLMs) to power character interactions, world state management, and visual generation. The system emphasizes modularity, extensibility, and pure JavaScript/TypeScript without Python dependencies for core functionality.

The application consists of:
- **Backend**: Node.js/Express server handling API requests, real-time communication, LLM proxying, and data persistence.
- **Frontend**: React-based UI for managing worlds, characters, chat, and configuration.
- **Databases**: SQLite for structured data storage.
- **Agents**: Modular AI agents for different aspects of roleplaying (narrator, characters, director, etc.).

## Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time Communication**: Socket.io
- **Templating**: Nunjucks for dynamic prompt generation
- **HTTP Client**: Axios for API calls
- **Database**: better-sqlite3 for SQLite
- **Image Processing**: Sharp for avatar resizing
- **File Upload**: Multer
- **LLM Integration**: Custom client supporting KoboldCPP and OpenAI-compatible APIs
- **Build Tool**: TypeScript compiler

### Frontend
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Real-time Communication**: Socket.io-client
- **State Management**: React hooks (useState, useEffect)
- **UI Components**: Custom components for chat, editors, modals

### Databases
- **Primary Database**: SQLite (`roleforge.db`) for worlds, campaigns, scenes, messages, personas, lore, and settings
- **Characters Database**: SQLite (`characters.db`) for character definitions and overrides
- **File Storage**: Local filesystem for avatars and generated images

### External Integrations
- **LLM Providers**: KoboldCPP, OpenAI API, or compatible endpoints
- **Image Generation**: ComfyUI (Automatic1111 API-compatible) for Stable Diffusion
- **Voice Generation**: (Future) ElevenLabs or similar for TTS

## Data Storage

### Database Schemas

#### Main Database (`roleforge.db`)

**Worlds Table**
- `id` (INTEGER PRIMARY KEY): Unique world identifier
- `slug` (TEXT UNIQUE): URL-friendly identifier
- `name` (TEXT): Display name
- `description` (TEXT): World description
- `createdAt` (DATETIME): Creation timestamp

**Campaigns Table**
- `id` (INTEGER PRIMARY KEY): Unique campaign identifier
- `worldId` (INTEGER REFERENCES Worlds(id)): Parent world
- `slug` (TEXT): URL-friendly identifier
- `name` (TEXT): Display name
- `description` (TEXT): Campaign description
- `createdAt` (DATETIME): Creation timestamp

**Arcs Table**
- `id` (INTEGER PRIMARY KEY): Unique arc identifier
- `campaignId` (INTEGER REFERENCES Campaigns(id)): Parent campaign
- `orderIndex` (INTEGER): Ordering within campaign
- `name` (TEXT): Display name
- `description` (TEXT): Arc description

**Scenes Table**
- `id` (INTEGER PRIMARY KEY): Unique scene identifier
- `arcId` (INTEGER REFERENCES Arcs(id)): Parent arc
- `orderIndex` (INTEGER): Ordering within arc
- `title` (TEXT): Scene title
- `description` (TEXT): Scene description
- `location` (TEXT): Current location
- `timeOfDay` (TEXT): Time of day (e.g., "dawn", "midnight")
- `elapsedMinutes` (INTEGER): Minutes since campaign start
- `notes` (JSON): Additional scene notes
- `backgroundImage` (TEXT): Background image URL
- `locationRelationships` (JSON): Spatial relationships (e.g., room connections)
- `worldState` (JSON): Current world state facts
- `lastWorldStateMessageNumber` (INTEGER): Last processed message for state updates
- `characterStates` (JSON): Per-character state (mood, clothing, etc.)
- `activeCharacters` (JSON): Array of active character IDs
- `summary` (TEXT): Scene summary for context
- `lastSummarizedMessageId` (INTEGER): Last summarized message
- `summaryTokenCount` (INTEGER): Token count of summary

**Messages Table**
- `id` (INTEGER PRIMARY KEY): Unique message identifier
- `sceneId` (INTEGER REFERENCES Scenes(id)): Parent scene
- `messageNumber` (INTEGER): Sequential numbering per scene
- `message` (TEXT): Message content (may include Markdown for images)
- `sender` (TEXT): Sender identifier (user:personaName, character:name, or system)
- `timestamp` (DATETIME): Message timestamp
- `charactersPresent` (JSON): Characters present at message time
- `tokenCount` (INTEGER): Estimated token count
- `metadata` (JSON): Additional data (e.g., image URLs, prompts)

**BaseCharacters Table**
- `id` (INTEGER PRIMARY KEY): Unique base character identifier
- `slug` (TEXT UNIQUE): URL-friendly identifier
- `data` (JSON): Full character object (appearance, personality, etc.)

**WorldCharacterOverrides Table**
- `worldId` (INTEGER REFERENCES Worlds(id)): Parent world
- `characterId` (TEXT): Character identifier (references BaseCharacters.id or slug)
- `overrideData` (JSON): Override properties for this world

**CampaignCharacterOverrides Table**
- `campaignId` (INTEGER REFERENCES Campaigns(id)): Parent campaign
- `characterId` (TEXT): Character identifier
- `overrideData` (JSON): Override properties for this campaign

**LoreEntries Table**
- `id` (INTEGER PRIMARY KEY): Unique lore entry identifier
- `worldId` (INTEGER REFERENCES Worlds(id)): Parent world
- `key` (TEXT): Lore key for activation
- `content` (TEXT): Lore content
- `tags` (JSON): Associated tags

**CampaignState Table**
- `campaignId` (INTEGER PRIMARY KEY REFERENCES Campaigns(id)): Parent campaign
- `currentSceneId` (INTEGER REFERENCES Scenes(id)): Active scene
- `elapsedMinutes` (INTEGER): Campaign elapsed time
- `dynamicFacts` (JSON): Dynamic world facts
- `trackers` (JSON): Stats, objectives, relationships
- `updatedAt` (DATETIME): Last update timestamp

**Personas Table**
- `id` (INTEGER PRIMARY KEY): Unique persona identifier
- `name` (TEXT): Display name
- `data` (JSON): Persona details (description, personality, etc.)
- `avatarUrl` (TEXT): Avatar image URL

**Lorebooks Table**
- `id` (INTEGER PRIMARY KEY): Unique lorebook identifier
- `name` (TEXT): Display name
- `description` (TEXT): Lorebook description
- `scan_depth` (INTEGER): Lore scanning depth
- `token_budget` (INTEGER): Token budget for lore injection
- `recursive_scanning` (BOOLEAN): Enable recursive scanning
- `extensions` (JSON): File extensions to scan
- `entries` (JSON): Lore entries array

**Settings Table**
- `key` (TEXT PRIMARY KEY): Setting key
- `value` (TEXT): Setting value

#### Characters Database (`characters.db`)

**Characters Table**
- `id` (TEXT PRIMARY KEY): UUID identifier
- `name` (TEXT): Character name
- `avatar` (TEXT): Avatar filename
- `data` (JSON): Full character data (appearance, personality, skills, etc.)

### File Storage Structure

**Avatars**
- Location: `frontend/public/avatars/`
- Naming: `avatar-{characterId}.png`
- Processing: Resized to 256x256px on upload

**Generated Images**
- Location: `public/generated/{worldId}/{campaignId}/{arcId}/{sceneId}/`
- Naming: `{timestamp}-{randomHex}.{ext}`
- Metadata: Stored in message metadata JSON

**Workflows**
- Location: `backend/workflows/`
- Format: JSON files for ComfyUI workflows

**Configuration**
- Location: `backend/config.json`
- Contains: LLM profiles, ComfyUI settings, feature flags

**Schemas**
- Location: `.github/`
- Files: `Character_Schema.json`, `Persona_Schema.json`

## System Components

### Backend Components

#### Server (`server.ts`)
- **Purpose**: Main application server
- **Responsibilities**:
  - HTTP API endpoints for CRUD operations
  - Socket.io real-time communication
  - Image upload and processing
  - LLM proxying and response handling
  - Periodic cleanup of orphaned files
- **Key Routes**:
  - `/api/worlds/*`: World management
  - `/api/campaigns/*`: Campaign management
  - `/api/arcs/*`: Arc management
  - `/api/scenes/*`: Scene management
  - `/api/messages/*`: Message operations
  - `/api/characters/*`: Character CRUD and generation
  - `/api/personas/*`: Persona management
  - `/api/lorebooks/*`: Lorebook management
  - `/api/settings/*`: Configuration endpoints

#### Database (`database.ts`)
- **Purpose**: Database initialization and schema management
- **Responsibilities**:
  - Create and migrate database tables
  - Ensure column existence for backward compatibility
  - WAL mode for concurrency

#### Configuration Manager (`configManager.ts`)
- **Purpose**: Load and manage application configuration
- **Responsibilities**:
  - Parse `config.json`
  - Provide LLM profiles and settings
  - Reload configuration on changes

#### Services
- **WorldService.ts**: CRUD for worlds
- **CampaignService.ts**: CRUD for campaigns, state management
- **ArcService.ts**: CRUD for arcs
- **SceneService.ts**: CRUD for scenes, state updates
- **MessageService.ts**: Message logging, retrieval, editing
- **CharacterService.ts**: Character management, merging overrides

#### Agents (`agents/`)
- **BaseAgent.ts**: Abstract base class for all agents
  - Template rendering with Nunjucks
  - LLM API calls with streaming support
  - JSON response parsing
- **CharacterAgent.ts**: Generates character dialogue and actions
- **DirectorAgent.ts**: Selects responding characters and provides guidance
- **WorldAgent.ts**: Updates world state and trackers
- **NarratorAgent.ts**: Provides scene descriptions
- **SummarizeAgent.ts**: Condenses conversation history
- **VisualAgent.ts**: Generates images via ComfyUI
- **CreatorAgent.ts**: Creates new characters and personas

#### LLM Client (`llm/client.ts`)
- **Purpose**: Unified interface for LLM APIs
- **Supported Providers**: KoboldCPP, OpenAI-compatible
- **Features**: Streaming responses, token counting, error handling

#### Templates (`prompts/`)
- Nunjucks templates for agent prompts
- Dynamic variable substitution
- JSON serialization for structured outputs

### Frontend Components

#### Main App (`App.tsx`)
- **Purpose**: Root component and state management
- **Responsibilities**:
  - Socket.io connection and event handling
  - Global state for worlds, campaigns, scenes, messages
  - Tab navigation and modal management
  - Message sending and receiving

#### Chat Component (`components/Chat.tsx`)
- **Purpose**: Real-time chat interface
- **Features**: Message display, input handling, image rendering, editing

#### Managers
- **CharacterManager.tsx**: Character listing, editing, import
- **LoreManager.tsx**: Lorebook management
- **PersonaManager.tsx**: Persona CRUD
- **WorldManager.tsx**: World hierarchy management

#### Editors
- **WorldEditor.tsx**: World creation/editing
- **CampaignEditor.tsx**: Campaign management
- **ArcEditor.tsx**: Arc management
- **SceneEditor.tsx**: Scene configuration
- **OverrideEditor.tsx**: Character overrides

#### UI Components
- **TopBar.tsx**: Navigation and controls
- **HierarchySidebar.tsx**: World/campaign/arc/scene tree
- **ActiveCharacterComponent.tsx**: Active character selection
- **ImageCard.tsx**: Image display with controls
- **Toast.tsx**: Notification system

## Workflows

### User Interaction Flow

1. **Initialization**:
   - User selects world → campaign → arc → scene
   - Frontend fetches session context (`/api/scenes/:sceneId/session`)
   - Loads active characters, world state, trackers

2. **Message Sending**:
   - User types message in chat input
   - Frontend emits `userMessage` via Socket.io with persona and active characters

3. **Backend Processing** (`Orchestrator.processUserInput`):
   - Log user message to database
   - Check for slash commands (`/image`, `/create`, etc.)
   - If scene description request: Call NarratorAgent
   - Otherwise:
     - Summarize history if >10 messages
     - Call DirectorAgent for character selection
     - Call WorldAgent for state updates
     - For each selected character: Call CharacterAgent
   - Log AI responses to database
   - Emit responses via `aiResponse`

4. **Real-time Updates**:
   - Frontend receives and displays messages
   - Updates world state, trackers, character states
   - Handles image generation and storage

### Character Management

1. **Creation**:
   - User provides description/instructions
   - CreatorAgent generates character data
   - Saved to Characters table

2. **Merging Overrides**:
   - CharacterService.getMergedCharacter() combines base + world + campaign overrides
   - Deep merge prioritizes campaign > world > base

3. **Active Selection**:
   - Scene.activeCharacters array stores IDs
   - Frontend displays merged character data

### Image Generation

1. **Trigger**:
   - User command `/image <prompt>`
   - Automatic via [GEN_IMAGE] in agent responses

2. **Processing**:
   - VisualAgent constructs prompt
   - Calls ComfyUI API
   - Downloads and stores image locally
   - Returns Markdown with metadata

3. **Management**:
   - Images stored in hierarchical folders
   - Metadata in message JSON
   - UI allows next/prev/regen/delete

### State Management

1. **World State**:
   - Stored in Scenes.worldState JSON
   - Updated by WorldAgent based on conversation
   - Includes dynamic facts, elapsed time

2. **Trackers**:
   - Stats, objectives, relationships in CampaignState.trackers
   - Updated by WorldAgent

3. **Character States**:
   - Per-character state in Scenes.characterStates
   - Updated by CharacterAgent responses

### Summarization

1. **Trigger**: Every N messages (configurable)
2. **Process**: SummarizeAgent condenses history
3. **Storage**: Scene.summary with token count

### Cleanup

- **Orphaned Images**: Periodic deletion of unreferenced generated images
- **Database**: Foreign key constraints ensure referential integrity

## Agent System Details

### Base Agent Architecture
- **renderLLMTemplate()**: Renders Nunjucks template with context, calls LLM
- **Streaming**: Supports async iteration for real-time responses
- **Error Handling**: Fallback responses on LLM failure
- **JSON Parsing**: Extracts structured data from responses

### Agent Responsibilities

- **DirectorAgent**: Analyzes conversation, selects responding characters, provides narrative guidance
- **WorldAgent**: Updates world facts, character states, trackers based on events
- **CharacterAgent**: Generates in-character responses with actions and state changes
- **NarratorAgent**: Provides third-person scene descriptions
- **SummarizeAgent**: Creates concise summaries of conversation history
- **VisualAgent**: Generates images from text prompts
- **CreatorAgent**: Creates new characters/personas from descriptions

### Prompt Engineering
- Templates use Nunjucks for dynamic content
- JSON serialization for structured outputs
- Token limits and formatting instructions
- Context injection (history, world state, character data)

## Configuration and Extensibility

### Configuration (`config.json`)
- **profiles**: LLM endpoint configurations (KoboldCPP, OpenAI)
- **features**: Flags for summarization, visual agent, etc.
- **comfyui**: Image generation settings
- **agents**: Per-agent overrides

### Extensibility
- **Plugins**: `plugins/` folder for custom functionality
- **Workflows**: ComfyUI workflows for different image styles
- **Templates**: Custom Nunjucks templates for agents
- **Services**: Modular CRUD services

## Deployment and Operations

### Build Process
- **Root**: `npm run build` compiles TypeScript
- **Backend**: Outputs to `dist/backend/`
- **Frontend**: Builds to `frontend/build/`

### Runtime
- **Backend**: `npm run dev:backend` (nodemon + ts-node)
- **Frontend**: `npm run dev:frontend` (Vite dev server)
- **Combined**: `npm run dev` (concurrently)

### Production
- **Static Serving**: Frontend built into backend public folder
- **Single Process**: Node.js server on port 3001
- **Database**: SQLite files in project root

### Monitoring
- **Logs**: Console output for agent calls, errors
- **Socket Events**: Debug logging configurable
- **Performance**: Token counting, response times

This architecture provides a scalable, modular foundation for AI-powered roleplaying with strong separation of concerns between UI, business logic, data persistence, and external integrations.</content>
<parameter name="filePath">c:\AI_Tools\RoleForge\.github\roleforgearchitecture.md