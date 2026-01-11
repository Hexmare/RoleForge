# Lorebooks Implementation Plan for RoleForge

## Introduction

This document outlines the user stories, tasks, schema, and guidelines for implementing lorebooks in RoleForge, a full-stack TypeScript application for AI-guided roleplaying. Lorebooks are collections of contextual entries (inspired by SillyTavern's World Info) that dynamically inject information into LLM prompts based on keywords, conditions, or programmatic triggers. This enhances storytelling by providing relevant lore without manual intervention.

Key principles:
- Achieve near-100% parity with SillyTavern's lorebook features, including import/export of JSON files.
- Lorebooks are global entities stored in a dedicated SQLite database (`lorebooks.db`), similar to `characters.db`.
- Each lorebook has a unique UUID for referencing.
- Worlds and campaigns can assign multiple lorebooks via references (stored as JSON arrays in their respective tables in `roleforge.db`).
- Support CRUD operations, import/export, and programmatic creation (e.g., via agents or API).
- Integration with prompt building: Scan messages for keywords to trigger entry injections, respecting budgets, orders, and filters.

Decisions / Clarifications (answers provided):
- Store `lorebooks.db` in the `data/` directory. When a lorebook is deleted, remove references in `roleforge.db`.
- ALTER TABLE migrations for existing installs: automatic (perform ALTER TABLE automatically when needed).
- Use a separate `LoreEntries` table rather than storing `entries` as a JSON array inside `Lorebooks` for better indexing and updates.
- `Lorebook.uuid`: keep as UUID v4 and used for references from worlds/campaigns. `LoreEntry.uid`: sequential per lorebook (integer). `LoreEntry` rows will reference the parent lorebook by its UUID. The lorebook UUID will not be exported and will be auto-created on import/creation.
- Regex storage: use the example format `/pattern/i`. `caseSensitive` and `matchWholeWords` are configurable per regex.
- `selectiveLogic` mapping: 0 = ANY, 1 = ALL, 2 = NONE, 3 = NOT ALL (see details later in document).
- `insertion_position`: import and store as-is for now; feature enhancement to utilize positions will come later.
- Macro/outlet behavior: multiple entries targeting the same outlet will append in insertion order.
- Token budgeting: budgets are in tokens. Use the existing `utils/countTokens` estimator for measuring cost.
- Recursion detection: start with a simple substring scan; recursion limit is configurable.
- Group selection: apply (1) highest `insertion_order`, (2) scoring tie-breaker, (3) weighted-random fallback.
- Sticky / cooldown / delay semantics: TBD (to be defined in a follow-up story).
- World/Campaign references: use many-to-many join tables `World_Lorebooks(worldId, lorebookUuid)` and `Campaign_Lorebooks(campaignId, lorebookUuid)` instead of JSON arrays.
- Import/Export: the system should be able to read SillyTavern JSON and cast/marshal into our class definition; export will serialize to JSON compatible with our interface.
- Programmatic generation constraints, vectorization/embeddings, API security, and concurrency semantics: defer detailed policies to later stories. For now, assume single-user and defer auth/rate-limiting.

This plan aligns with RoleForge's architecture:
- Backend: Node.js/Express for API, Socket.io for real-time, Nunjucks for templating.
- Frontend: React/Vite/Tailwind for UI.
- Databases: SQLite for persistence.
- LLM Integration: Custom client for KoboldCPP/OpenAI-compatible.
- Agents: Extend existing agents (e.g., DirectorAgent) to incorporate lore in prompts.

Assumptions: No external dependencies beyond the tech stack (e.g., use better-sqlite3 for DB, Axios for any imports if needed). Token counting uses a simple estimator or integrates with LLM client.

## User Stories

User stories are written in the format: *As a [role], I want [feature] so that [benefit].*

### Core Lorebook Management
- As a game master, I want to create a new lorebook with a name and description so that I can organize world-specific knowledge.
- As a game master, I want to view, edit, and delete lorebooks so that I can maintain accurate lore collections.
- As a game master, I want to add, edit, and remove individual entries within a lorebook so that I can fine-tune contextual information.
- As a game master, I want to assign multiple lorebooks to a world or campaign so that different lore sets can be combined for varied stories.
- As a player, I want lore to be automatically injected into scenes based on keywords in messages so that the story feels immersive without manual lookups.

### Import/Export
- As a game master, I want to import lorebooks from SillyTavern-compatible JSON files so that I can reuse existing content.
- As a game master, I want to export lorebooks as JSON files so that I can share or backup them, maintaining compatibility with SillyTavern.
- As a game master, I want validation during import to handle legacy fields and ensure data integrity.

### Advanced Features
- As a developer, I want programmatic creation of lore entries (e.g., via API or agents) so that lore can be generated dynamically during gameplay.
- As a game master, I want configurable global settings per lorebook (e.g., scan depth, token budget) so that I can control performance and relevance.
- As a player, I want lore triggers to respect conditions like probability, groups, and recursion to avoid overload or inconsistencies.

## Tasks

Tasks are broken down by component. Prioritize backend first for API stability, then frontend for UI, and integrate with existing agents/services.

### Backend Tasks

#### Database Setup (`lorebooks.db`)
1. [x] Create a new SQLite database file (`lorebooks.db`) in the `data/` directory (store DB in `data/`).
2. [x] Initialize the schema in `database.ts` (extend existing init function):
   - [x] Add table creation for `Lorebooks` and a separate `LoreEntries` table (see Schema section below).
   - [x] Ensure WAL mode and perform automatic ALTER TABLE migrations when needed.
3. [x] In `roleforge.db`, add many-to-many join tables for lorebook assignment instead of JSON fields:
   - [x] Create `World_Lorebooks(worldId INTEGER, lorebookUuid TEXT)`.
   - [x] Create `Campaign_Lorebooks(campaignId INTEGER, lorebookUuid TEXT)`.
   - [ ] Update `WorldService` and `CampaignService` to manage these associations.

#### Services and Models
1. [x] Create `LorebookService.ts`:
   - [x] Methods: `createLorebook(name, description, settings)`, `getLorebook(uuid)`, `updateLorebook(uuid, data)`, `deleteLorebook(uuid)`.
   - [x] Handle entries via the `LoreEntries` table: `addEntry(lorebookUuid, entry)`, `updateEntry(lorebookUuid, entryId, entry)`, `deleteEntry(lorebookUuid, entryId)`.
   - [ ] Normalization for imports: map legacy SillyTavern fields (e.g., `keysecondary` → `optional_filter`).
2. [ ] Integrate with `WorldService`/`CampaignService`:
   - [ ] `addLorebookToWorld(worldId, lorebookUuid)`, `removeLorebookFromWorld(worldId, lorebookUuid)`.
   - [ ] Similar API for campaigns.
   - [ ] Fetch active lorebooks for a scene by merging world + campaign associations and loading entries.
3. [ ] Update `SceneService`/`Orchestrator`:
   - [ ] In `processUserInput`/AI response generation: gather active lorebooks, scan context (last N messages + scene description, character personalities), match keys, apply filters, and inject selected lore entries into the prompt.
   - [ ] Use token budgeting via existing `utils/countTokens`.

#### API Endpoints (Express in `server.ts`)
1. [x] `/api/lorebooks`:
   - [x] GET: List all lorebooks (uuid, name, description).
   - [x] POST: Create new lorebook (body: `{name, description, settings}`).
2. [x] `/api/lorebooks/:uuid`:
   - [x] GET: Fetch lorebook details including entries.
   - [x] PUT: Update lorebook (body: partial data).
   - [x] DELETE: Delete lorebook (ensure removal of references from `roleforge.db` join tables).
3. [x] `/api/lorebooks/:uuid/entries`:
   - [x] POST: Add entry (body: entry object).
   - [x] GET: List entries (from `LoreEntries` table filtered by `lorebookUuid`).
4. [x] `/api/lorebooks/:uuid/entries/:entryId`:
   - [x] PUT: Update entry.
   - [x] DELETE: Delete entry.
5. [ ] `/api/lorebooks/import`: POST with file upload (Multer), parse JSON, normalize, create new lorebook (auto-generate lorebook UUID on import).
6. [ ] `/api/lorebooks/:uuid/export`: GET, return JSON file download (export uses our interface; lorebook UUID is not included in exports by default if not desired).
7. [ ] Integrate with world/campaign endpoints: update responses to include associated lorebooks via join tables; add PATCH endpoints for assigning/removing.

#### Programmatic Creation
1. [ ] Extend `CreatorAgent.ts`: add `generateLoreEntry(type, name, focus)` — use the LLM to create an entry object then call `LorebookService.addEntry`.
2. [ ] Add API endpoint `/api/lorebooks/:uuid/generate-entry`: POST (body: `{prompt}`), use the agent to generate and add (programmatic generation constraints deferred to later story).
3. [ ] In `Orchestrator`: on configured triggers (e.g., new NPC/event), auto-generate entries if enabled.

#### Prompt Integration
1. [ ] In `BaseAgent.ts`: add lore injection logic before templating.
   - [ ] Scan last `scan_depth` messages for keys (regex/plaintext, case/matchWholeWords).
   - [ ] Apply `selectiveLogic`, `probability` (`Math.random()`), and group selection (highest-order → scoring → weighted random).
   - [ ] Recursion: configurable limit (default 5); simple substring scan for detection to start.
   - [ ] Timed semantics: `sticky`/`cooldown`/`delay` states stored in `Scene.notes` (TBD persistence semantics).
   - [ ] Insert selected entries based on `insertion_position`, respecting `token_budget` measured in tokens via `utils/countTokens`.
2. [ ] Update LLM client to handle extended prompts where necessary.

### Frontend Tasks

#### UI Components
1. [ ] Create `LoreManager.tsx`: list lorebooks, create/edit modals, entry editor (form with fields for key, content, etc.).
   - [ ] Use React-Table for entry list, sortable by order/displayIndex.
2. [ ] Integrate into `WorldEditor`/`CampaignEditor`: dropdown/multi-select for assigning lorebooks (use join-table APIs).
3. [ ] In `Chat.tsx`: display injected lore in debug mode (backend performs injection by default).
4. [ ] Add import/export buttons: file upload for import, download link for export.

#### State and Socket.io
1. [ ] Add lorebooks to global state in `App.tsx`.
2. [ ] Emit events for real-time updates (e.g., `lorebook.created`, `lorebook.updated`, `lorebook.entryAdded`, `lorebook.entryDeleted`) and broadcast payloads to connected clients.

### Testing and Misc
1. [x] Unit tests: `LorebookService` (CRUD, normalization), prompt injection logic. Place tests under `backend/src/__tests__/lorebooks/`.
2. [ ] E2E: import SillyTavern JSON, assign to world, test trigger in chat (defer embedding/vector tests).
3. [x] Docs: update architecture docs to include new DB/tables and join tables.

## Lorebook Schema

### Database Table (Lorebooks in `lorebooks.db`)
```sql
CREATE TABLE IF NOT EXISTS Lorebooks (
  uuid TEXT PRIMARY KEY UNIQUE,  -- UUID v4 (generated via crypto.randomUUID())
  name TEXT NOT NULL,
  description TEXT,
  scan_depth INTEGER DEFAULT 4,  -- Messages back to scan
  token_budget INTEGER DEFAULT 2048,  -- Max tokens for injected lore
  recursive_scanning BOOLEAN DEFAULT TRUE,
  extensions JSON DEFAULT '["json"]',  -- File extensions for import (array)
   entries JSON DEFAULT '[]',  -- Deprecated for large collections; primary implementation uses `LoreEntries` table. Kept for compatibility for now.
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Additional tables (recommended):
-- LoreEntries: store each entry as a row for indexing and updates
-- World_Lorebooks and Campaign_Lorebooks: many-to-many association tables

-- Suggested additions (SQLite):
--
-- CREATE TABLE IF NOT EXISTS LoreEntries (
--   id INTEGER PRIMARY KEY AUTOINCREMENT,
--   lorebookUuid TEXT NOT NULL,
--   uid INTEGER NOT NULL, -- sequential per-lorebook
--   key JSON NOT NULL,
--   optional_filter JSON,
--   title_memo TEXT,
--   content TEXT NOT NULL,
--   constant BOOLEAN DEFAULT 0,
--   selective BOOLEAN DEFAULT 0,
--   selectiveLogic INTEGER DEFAULT 0,
--   insertion_order INTEGER DEFAULT 100,
--   insertion_position TEXT DEFAULT 'Before Char Defs',
--   outletName TEXT,
--   enabled BOOLEAN DEFAULT 1,
--   preventRecursion BOOLEAN DEFAULT 0,
--   probability INTEGER DEFAULT 100,
--   useProbability BOOLEAN DEFAULT 0,
--   depth INTEGER,
--   caseSensitive BOOLEAN DEFAULT 0,
--   matchWholeWords BOOLEAN DEFAULT 1,
--   vectorized BOOLEAN DEFAULT 0,
--   "group" TEXT,
--   groupOverride BOOLEAN DEFAULT 0,
--   groupWeight INTEGER DEFAULT 50,
--   useGroupScoring BOOLEAN DEFAULT 0,
--   automationId TEXT,
--   sticky INTEGER DEFAULT 0,
--   cooldown INTEGER DEFAULT 0,
--   delay INTEGER DEFAULT 0,
--   triggers JSON,
--   additional_matching_sources JSON,
--   extensions JSON,
--   createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
--   updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
-- );

-- CREATE TABLE IF NOT EXISTS World_Lorebooks (
--   worldId INTEGER NOT NULL,
--   lorebookUuid TEXT NOT NULL,
--  PRIMARY KEY (worldId, lorebookUuid)
-- );

-- CREATE TABLE IF NOT EXISTS Campaign_Lorebooks (
--   campaignId INTEGER NOT NULL,
--   lorebookUuid TEXT NOT NULL,
--  PRIMARY KEY (campaignId, lorebookUuid)
-- );
```

### LoreEntry Interface (TypeScript)
Entries are stored as JSON array in `entries`. Use this interface for typing:

```typescript
interface LoreEntry {
  uid: number;  // Auto-increment per lorebook
  key: string[];  // Primary triggers (array, supports regex e.g., '/pattern/i')
  optional_filter?: string[];  // Secondary filters
  title_memo?: string;  // UI comment/title
  content: string;  // Injected text
  constant?: boolean;  // Always insert (default: false)
  selective?: boolean;  // Require secondary (default: false)
  selectiveLogic?: number;  // 0=AND ANY, 1=AND ALL, 2=NOT ANY, 3=NOT ALL (default: 0)
  insertion_order?: number;  // Higher = later in prompt (default: 100)
  insertion_position?: string;  // e.g., "Before Char Defs", "@D:3 system" (default: "Before Char Defs")
  outletName?: string;  // For macro outlets
  enabled?: boolean;  // Active (default: true)
  preventRecursion?: boolean;  // Avoid loops (default: false)
  probability?: number;  // 0-100 (default: 100)
  useProbability?: boolean;  // (default: false)
  depth?: number;  // Per-entry scan override (default: null, use global)
  caseSensitive?: boolean;  // (default: false)
  matchWholeWords?: boolean;  // (default: true)
  vectorized?: boolean;  // For embeddings (future, default: false)
  group?: string;  // Comma-separated groups
  groupOverride?: boolean;  // Prioritize highest order (default: false)
  groupWeight?: number;  // For random selection (default: 50)
  useGroupScoring?: boolean;  // Score by matches (default: false)
  automationId?: string;  // Link to scripts (future)
  sticky?: number;  // Stays active N messages (default: 0)
  cooldown?: number;  // Can't retrigger for N (default: 0)
  delay?: number;  // Min messages to activate (default: 0)
  triggers?: string[];  // Generation types e.g., ["normal"] (default: [])
  additional_matching_sources?: string[];  // e.g., ["description", "scenario"] (default: [])
  extensions?: Record<string, any>;  // Future fields
}
```

- On import: Parse JSON, normalize legacy fields (e.g., position number → string, disable → !enabled), assign UIDs.
- On export: Stringify with newer fields, include legacy aliases for SillyTavern compatibility.

## Usage Guidelines

### Keyword Identification and Triggering
Lore inclusion happens during prompt building in agents (e.g., before LLM call):
1. **Gather Context**: Concat last `scan_depth` messages + additional sources (scene description, character personalities, world state).
2. **Scan for Keys**: For each entry:
   - Match primary `key` array: Plaintext (whole words/case) or regex.
   - If `selective`: Apply `selectiveLogic` to `optional_filter`.
   - If `useProbability`: Roll `Math.random() * 100 < probability`.
   - Groups: If multiple in same group, select one (override highest order, or weighted random, or score by matches).
   - Timed: Check session counters (stored in scene notes JSON).
3. **Recursion**: If content has keys, rescan up to max (5), skip if `preventRecursion`.
4. **Budget and Order**: Sort selected by `insertion_order`, inject until `token_budget` exceeded (estimate tokens via word count * 1.3 or LLM tokenizer).
5. **Insertion**: Place based on `insertion_position` (e.g., prepend to system prompt, insert at depth).
6. **Macros/Outlets**: If position="outlet", store in map; replace {{outlet::name}} in templates.

Triggers are passive (keyword-based) or constant. For programmatic: Agents can force inclusion by key.

### Programmatic Creation Provisions
- **API**: Use `/api/lorebooks/:uuid/generate-entry` – send prompt like "/generate_lorebook type:npc name:Villain focus:Evil plans".
- **Agent Integration**: In CreatorAgent, add lore gen logic: Prompt LLM with format (Title; Description; Keywords; etc.), parse response to LoreEntry, add to lorebook.
- **Auto-Triggers**: In Orchestrator, on events (new district, NPC death): Call agent to generate/update entry, log to journal.
- **Validation**: Ensure generated entries have 6-18 keywords, fit schema.

This plan provides a complete, self-contained implementation. Implement in phases: DB/Services → API → UI → Integration. Test with sample SillyTavern JSON for parity.