# phase5.md

## Phase 5: Hierarchical World Structure & Character Overrides

**Goal**: Implement a robust, persistent hierarchy of **World → Campaign → Arc → Scene** with a sophisticated character override system. This phase provides the foundation for long-term storytelling, reusable settings, and consistent world state management — directly inspired by Talemate's world separation while integrating SillyTavern-style character and lore management.
  - Expand state tracking: Include dynamic character attributes (outfits/personas), stats/objectives/relationships (via trackers like WTracker), and location awareness (e.g., spatial separation for unheard conversations/actions).
    - Advanced lore: Enhance LoreService with vector storage/embeddings (from LLM/local) for scored activation; include RAG-like data banks for external knowledge as REQUIREMENT.

All implementation must remain 100% TypeScript/Node.js with SQLite persistence and JSON fallbacks for easy editing/export.

### 1. Hierarchical Model Definitions

#### World
- The top-level container representing a complete setting (e.g., "Eberron", "Cyberpunk RED", "Homebrew Sci-Fi Universe").
- Contains:
  - Global lore entries (lorebooks)
  - World-level character overrides
  - List of campaigns

#### Campaign
- A self-contained story within a World.
- Contains:
  - Campaign metadata (name, description, start date, notes)
  - Campaign-level character overrides
  - List of arcs
  - Current state (active arc/scene pointer, elapsed time, dynamic facts)

#### Arc
- A major chapter or act in the campaign (e.g., "The Heist Setup", "Underground Chase").
- Contains:
  - Name, order index, description/goals
  - Ordered list of scenes

#### Scene
- The smallest narrative unit; the current "room" the player is in.
- Contains:
  - Title
  - Description/summary
  - Location name
  - Time of day / elapsed minutes since campaign start
  - Active characters (references with applied overrides)
  - Scene-specific notes or triggers
  - Optional background image/video references
  - Flags (e.g., combat active, time frozen)
  - Location relationships: Track spatial awareness (e.g., rooms/areas) to enforce visibility/hearing rules for characters/user.

### 2. Character Override System

Characters use a layered override mechanism for maximum reuse and customization:

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

This enables:
- Iconic characters with world-specific variations (e.g., Gandalf in Middle-earth vs. a parallel universe).
- Campaign-specific twists (ally → rival) without duplicating data.

### 3. Storage Strategy

#### Primary: SQLite (via better-sqlite3)
Recommended for type safety, querying, and future multi-user support.

**Schema**:
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
  locationRelationships JSON,                -- e.g., { "rooms": {"kitchen": ["user", "npc1"], "bedroom": ["npc2"]} }
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
  trackers JSON DEFAULT '{}',                -- e.g., { "stats": {"health": 100}, "objectives": ["quest1"], "relationships": {"npc1": "ally"} }
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### Fallback/Export: File System (Optional Hybrid)
Mirror structure in `data/worlds/` for easy manual editing/export:
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

Backend can sync DB ↔ files on demand.

### 4. Backend Implementation

#### Services (backend/src/services/)
- `WorldService.ts` – CRUD worlds, list campaigns
- `CampaignService.ts` – CRUD campaigns, manage state, advance scene
- `ArcService.ts` / `SceneService.ts`
- `CharacterService.ts` – 
  - getBaseCharacter(slug)
  - getMergedCharacter({ worldId?, campaignId?, characterSlug })
  - saveOverride(level: 'world'|'campaign', parentId, characterId, patch)
- `LoreService.ts` – getAllForWorld(worldId)
- `TrackerService.ts` – Manage stats/objectives/relationships; integrate with WorldAgent.

#### Session Context (passed to Orchestrator)
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
  locationMap: Record<string, string[]>;  // area → [entities present]
}
```

#### Orchestrator Updates
- On session init: Load full hierarchy via services → build SessionContext
- WorldAgent: May update `CampaignState.dynamicFacts` and advance `currentSceneId`
- DirectorAgent: Receives current arc description for pacing guidance
- WorldAgent: Also updates trackers (stats/objectives/relationships) and enforces location-based rules (e.g., filter audible actions).

### 5. Frontend Implementation

#### Navigation & Selection
- Top bar: World dropdown → Campaign dropdown
- Sidebar: Tree view of Arcs → Scenes (collapsible)
- Current scene indicator with time/location display

#### Editors
- World editor: Name, description, lorebook manager
- Campaign editor: Metadata, character override UI (form or JSON patch)
- Arc/Scene editor: Reorderable lists, rich text descriptions
- Character override editor: Side-by-side diff view (base vs. current)
- Tracker editor: UI for stats/objectives/relationships.
- Location mapper: Visual tool for spatial relationships.

#### Real-time Updates
- Socket.io events: `sceneAdvanced`, `stateUpdated`, `characterOverrideChanged`
- Chat component receives full SessionContext updates

### 6. Testing Requirements

1. Create "Test World" with two campaigns.
2. Add base character "Wizard" → world override (blue robes) → campaign override (scarred face).
3. Verify merged character shows correct final appearance.
4. Advance through multiple scenes → confirm elapsed time and dynamic facts persist.
5. Switch campaigns → verify isolation.
6. Manual override edit → immediate reflection in next AI response.

### 7. Deliverables

- SQLite schema + migration script (using better-sqlite3 prepared statements)
- All service classes with TypeScript interfaces
- Character deep-merge utility
- Backend API routes (REST + Socket.io events)
- Frontend components:
  - World/Campaign selector
  - Hierarchy tree view
  - Override editor
  - Current scene/status display
- Updated Orchestrator to use full SessionContext
- Sample data (at least one complete world + campaign)

This phase completes the structural backbone needed for rich, persistent roleplaying campaigns. Once complete, Phase 6 (Visual Generation) can fully leverage scene metadata for targeted image/video prompts.

Reference this document from `copilot-instructions.md` as:  
**"See phase5.md for complete World → Campaign → Arc → Scene hierarchy and character override specifications."**
