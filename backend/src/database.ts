import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = path.join(__dirname, '..', '..', 'roleforge.db');
// Ensure parent directories exist to avoid disk I/O errors in packaged/dist tests
import fs from 'fs';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath) as any;

const charactersDbPath = path.join(__dirname, '..', '..', 'data', 'characters.db');
const charactersDbDir = path.dirname(charactersDbPath);
if (!fs.existsSync(charactersDbDir)) {
  fs.mkdirSync(charactersDbDir, { recursive: true });
}
const charactersDb = new Database(charactersDbPath) as any;

// Enable foreign key constraints (required for CASCADE deletes to work)
db.pragma('foreign_keys = ON');
charactersDb.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency; fall back quietly if unavailable (e.g., sandboxed test FS)
try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('Failed to enable WAL on primary db, continuing with default mode:', e instanceof Error ? e.message : String(e));
}
try {
  charactersDb.pragma('journal_mode = WAL');
} catch (e) {
  console.warn('Failed to enable WAL on characters db, continuing with default mode:', e instanceof Error ? e.message : String(e));
}

// Create characters table in characters.db
charactersDb.exec(`
  CREATE TABLE IF NOT EXISTS Characters (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

// Ensure Characters table has required columns
try {
  const cols = safePragmaAll(charactersDb, 'Characters');
  const hasName = cols.some((c: any) => c.name === 'name');
  if (!hasName) {
    charactersDb.exec(`ALTER TABLE Characters ADD COLUMN name TEXT NOT NULL DEFAULT 'Unknown';`);
  }
  const hasAvatar = cols.some((c: any) => c.name === 'avatar');
  if (!hasAvatar) {
    charactersDb.exec(`ALTER TABLE Characters ADD COLUMN avatar TEXT;`);
  }
} catch (e) {
  console.warn('Could not ensure Characters table columns:', e);
}

// Helper: safe wrapper for PRAGMA queries to avoid throwing when DB isn't ready
function safePragmaAll(database: any, tableName: string) {
  try {
    if (!database || typeof database.prepare !== 'function') return [];
    const stmt = database.prepare(`PRAGMA table_info('${tableName}')`);
    if (!stmt || typeof stmt.all !== 'function') return [];
    return stmt.all();
  } catch (err) {
    console.warn(`Could not query PRAGMA table_info('${tableName}')`, err);
    return [];
  }
}

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatarUrl TEXT,
    description TEXT,
    personality TEXT,
    scenario TEXT,
    first_mes TEXT,
    mes_example TEXT,
    creator_notes TEXT,
    system_prompt TEXT,
    post_history_instructions TEXT,
    alternate_greetings TEXT, -- JSON array
    tags TEXT, -- JSON array
    creator TEXT,
    character_version TEXT,
    extensions TEXT, -- JSON object
    character_book TEXT -- JSON object
  );

  CREATE TABLE IF NOT EXISTS lorebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    scan_depth INTEGER,
    token_budget INTEGER,
    recursive_scanning BOOLEAN,
    extensions TEXT, -- JSON
    entries TEXT -- JSON array
  );

  CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT -- JSON
  );
`);

// Ensure persona avatarUrl column exists for older DBs
try {
  const pcols = safePragmaAll(db, 'personas');
  const hasAvatarPersona = pcols.some((c: any) => c.name === 'avatarUrl');
  if (!hasAvatarPersona) {
    db.exec(`ALTER TABLE personas ADD COLUMN avatarUrl TEXT;`);
  }
} catch (e) {
  console.warn('Could not ensure personas.avatarUrl column exists:', e);
}

// If running against an existing DB without avatarUrl, add the column
try {
  const cols = safePragmaAll(db, 'characters');
  const hasAvatar = cols.some((c: any) => c.name === 'avatarUrl');
  if (!hasAvatar) {
    db.exec(`ALTER TABLE characters ADD COLUMN avatarUrl TEXT;`);
  }
} catch (e) {
  console.warn('Could not ensure avatarUrl column exists:', e);
}

// Ensure personas table has race and skinTone columns
try {
  const pcols = safePragmaAll(db, 'personas');
  const hasRace = pcols.some((c: any) => c.name === 'race');
  if (!hasRace) {
    db.exec(`ALTER TABLE personas ADD COLUMN race TEXT DEFAULT 'Caucasian';`);
  }
  const hasSkinTone = pcols.some((c: any) => c.name === 'skinTone');
  if (!hasSkinTone) {
    db.exec(`ALTER TABLE personas ADD COLUMN skinTone TEXT DEFAULT 'white';`);
  }
} catch (e) {
  console.warn('Could not ensure personas race/skinTone columns exist:', e);
}

// Ensure characters table has skinTone column
try {
  const ccols = safePragmaAll(db, 'characters');
  const hasSkinTone = ccols.some((c: any) => c.name === 'skinTone');
  if (!hasSkinTone) {
    db.exec(`ALTER TABLE characters ADD COLUMN skinTone TEXT DEFAULT 'white';`);
  }
} catch (e) {
  console.warn('Could not ensure characters skinTone column exists:', e);
}

// Phase 5: World/Campaign/Arc/Scene and related tables
db.exec(`
  CREATE TABLE IF NOT EXISTS Worlds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    authorNote TEXT,
    settingDetails TEXT,
    storyDetails TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    authorNote TEXT,
    plot TEXT,
    goals TEXT,
    storyDetails TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(worldId, slug)
  );

  CREATE TABLE IF NOT EXISTS Arcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaignId INTEGER REFERENCES Campaigns(id) ON DELETE CASCADE,
    orderIndex INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    authorNote TEXT,
    plot TEXT,
    goals TEXT,
    storyDetails TEXT,
    UNIQUE(campaignId, orderIndex)
  );

  CREATE TABLE IF NOT EXISTS Scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arcId INTEGER REFERENCES Arcs(id) ON DELETE CASCADE,
    orderIndex INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    authorNote TEXT,
    plot TEXT,
    goals TEXT,
    scenario TEXT,
    location TEXT,
    timeOfDay TEXT,
    elapsedMinutes INTEGER DEFAULT 0,
    notes JSON,
    backgroundImage TEXT,
    locationRelationships JSON,
    worldState JSON DEFAULT '{}',
    lastWorldStateMessageNumber INTEGER DEFAULT 0,
    characterStates JSON DEFAULT '{}',
    activeCharacters JSON DEFAULT '[]',
    UNIQUE(arcId, orderIndex)
  );

  CREATE TABLE IF NOT EXISTS BaseCharacters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    data JSON NOT NULL
  );

  CREATE TABLE IF NOT EXISTS WorldCharacterOverrides (
    worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
    characterId TEXT,
    overrideData JSON NOT NULL,
    PRIMARY KEY(worldId, characterId)
  );

  CREATE TABLE IF NOT EXISTS CampaignCharacterOverrides (
    campaignId INTEGER REFERENCES Campaigns(id) ON DELETE CASCADE,
    characterId TEXT,
    overrideData JSON NOT NULL,
    PRIMARY KEY(campaignId, characterId)
  );

  CREATE TABLE IF NOT EXISTS LoreEntries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worldId INTEGER REFERENCES Worlds(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    tags JSON,
    UNIQUE(worldId, key)
  );

  CREATE TABLE IF NOT EXISTS CampaignState (
    campaignId INTEGER PRIMARY KEY REFERENCES Campaigns(id) ON DELETE CASCADE,
    currentSceneId INTEGER REFERENCES Scenes(id),
    elapsedMinutes INTEGER DEFAULT 0,
    dynamicFacts JSON DEFAULT '{}',
    trackers JSON DEFAULT '{}',
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
    messageNumber INTEGER NOT NULL,
    message TEXT NOT NULL,
    sender TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tokenCount INTEGER DEFAULT 0,
    UNIQUE(sceneId, messageNumber)
  );
`);

// Simple settings table for persisting small user preferences (single-user app)
db.exec(`
  CREATE TABLE IF NOT EXISTS Settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Ensure settings table exists (no-op if present)

// If migrating an older DB, ensure Messages.tokenCount column exists
try {
  const mcols = safePragmaAll(db, 'Messages');
  const hasToken = mcols.some((c: any) => c.name === 'tokenCount');
  if (!hasToken) {
    db.exec(`ALTER TABLE Messages ADD COLUMN tokenCount INTEGER DEFAULT 0;`);
  }
} catch (e) {
  console.warn('Could not ensure Messages.tokenCount column exists:', e);
}

// Ensure Scenes.activeCharacters column exists
try {
  const scols = safePragmaAll(db, 'Scenes');
  const hasActive = scols.some((c: any) => c.name === 'activeCharacters');
  if (!hasActive) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN activeCharacters JSON DEFAULT '[]';`);
  }
} catch (e) {
  console.warn('Could not ensure Scenes.activeCharacters column exists:', e);
}

// Ensure Messages.metadata column exists (JSON metadata for images, etc.)
try {
  const mcols2 = safePragmaAll(db, 'Messages');
  const hasMetadata = mcols2.some((c: any) => c.name === 'metadata');
  if (!hasMetadata) {
    // Add metadata column to store JSON as TEXT; default to '{}'
    db.exec(`ALTER TABLE Messages ADD COLUMN metadata TEXT DEFAULT '{}';`);
  }
} catch (e) {
  console.warn('Could not ensure Messages.metadata column exists:', e);
}

// Ensure Messages.source column exists
try {
  const mcols3 = safePragmaAll(db, 'Messages');
  const hasSource = mcols3.some((c: any) => c.name === 'source');
  if (!hasSource) {
    db.exec(`ALTER TABLE Messages ADD COLUMN source TEXT DEFAULT '';`);
  }
} catch (e) {
  console.warn('Could not ensure Messages.source column exists:', e);
}

// Ensure Scenes.summary column exists for summarization
try {
  const scols = safePragmaAll(db, 'Scenes');
  const hasSummary = scols.some((c: any) => c.name === 'summary');
  if (!hasSummary) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN summary TEXT;`);
  }
} catch (e) {
  console.warn('Could not ensure Scenes.summary column exists:', e);
}

// Ensure new narrative metadata columns exist for legacy DBs
try {
  const wcols = safePragmaAll(db, 'Worlds');
  if (!wcols.some((c: any) => c.name === 'authorNote')) db.exec(`ALTER TABLE Worlds ADD COLUMN authorNote TEXT;`);
  if (!wcols.some((c: any) => c.name === 'settingDetails')) db.exec(`ALTER TABLE Worlds ADD COLUMN settingDetails TEXT;`);
  if (!wcols.some((c: any) => c.name === 'storyDetails')) db.exec(`ALTER TABLE Worlds ADD COLUMN storyDetails TEXT;`);
} catch (e) {
  console.warn('Could not ensure Worlds metadata columns exist:', e);
}

try {
  const cc = safePragmaAll(db, 'Campaigns');
  if (!cc.some((c: any) => c.name === 'authorNote')) db.exec(`ALTER TABLE Campaigns ADD COLUMN authorNote TEXT;`);
  if (!cc.some((c: any) => c.name === 'plot')) db.exec(`ALTER TABLE Campaigns ADD COLUMN plot TEXT;`);
  if (!cc.some((c: any) => c.name === 'goals')) db.exec(`ALTER TABLE Campaigns ADD COLUMN goals TEXT;`);
  if (!cc.some((c: any) => c.name === 'storyDetails')) db.exec(`ALTER TABLE Campaigns ADD COLUMN storyDetails TEXT;`);
} catch (e) {
  console.warn('Could not ensure Campaigns metadata columns exist:', e);
}

try {
  const ac = safePragmaAll(db, 'Arcs');
  if (!ac.some((c: any) => c.name === 'authorNote')) db.exec(`ALTER TABLE Arcs ADD COLUMN authorNote TEXT;`);
  if (!ac.some((c: any) => c.name === 'plot')) db.exec(`ALTER TABLE Arcs ADD COLUMN plot TEXT;`);
  if (!ac.some((c: any) => c.name === 'goals')) db.exec(`ALTER TABLE Arcs ADD COLUMN goals TEXT;`);
  if (!ac.some((c: any) => c.name === 'storyDetails')) db.exec(`ALTER TABLE Arcs ADD COLUMN storyDetails TEXT;`);
} catch (e) {
  console.warn('Could not ensure Arcs metadata columns exist:', e);
}

try {
  const sc = safePragmaAll(db, 'Scenes');
  if (!sc.some((c: any) => c.name === 'authorNote')) db.exec(`ALTER TABLE Scenes ADD COLUMN authorNote TEXT;`);
  if (!sc.some((c: any) => c.name === 'plot')) db.exec(`ALTER TABLE Scenes ADD COLUMN plot TEXT;`);
  if (!sc.some((c: any) => c.name === 'goals')) db.exec(`ALTER TABLE Scenes ADD COLUMN goals TEXT;`);
  if (!sc.some((c: any) => c.name === 'scenario')) db.exec(`ALTER TABLE Scenes ADD COLUMN scenario TEXT;`);
} catch (e) {
  console.warn('Could not ensure Scenes metadata columns exist:', e);
}

// Ensure Scenes.lastSummarizedMessageId and summaryTokenCount columns exist
try {
  const scols2 = safePragmaAll(db, 'Scenes');
  const hasLastSummarized = scols2.some((c: any) => c.name === 'lastSummarizedMessageId');
  const hasSummaryTokens = scols2.some((c: any) => c.name === 'summaryTokenCount');
  if (!hasLastSummarized) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN lastSummarizedMessageId INTEGER;`);
  }
  if (!hasSummaryTokens) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN summaryTokenCount INTEGER DEFAULT 0;`);
  }
} catch (e) {
  console.warn('Could not ensure Scenes summarization tracking columns exist:', e);
}

// Ensure Scenes world state and character state columns exist
try {
  const scols3 = safePragmaAll(db, 'Scenes');
  const hasWorldState = scols3.some((c: any) => c.name === 'worldState');
  const hasLastWorldStateMessageNumber = scols3.some((c: any) => c.name === 'lastWorldStateMessageNumber');
  const hasCharacterStates = scols3.some((c: any) => c.name === 'characterStates');
  if (!hasWorldState) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN worldState JSON DEFAULT '{}';`);
  }
  if (!hasLastWorldStateMessageNumber) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN lastWorldStateMessageNumber INTEGER DEFAULT 0;`);
  }
  if (!hasCharacterStates) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN characterStates JSON DEFAULT '{}';`);
  }
} catch (e) {
  console.warn('Could not ensure Scenes world state columns exist:', e);
}

// Phase 6: Round Tracking for Memory System
// Ensure Messages.roundNumber column exists
try {
  const mcols = safePragmaAll(db, 'Messages');
  const hasRoundNumber = mcols.some((c: any) => c.name === 'roundNumber');
  if (!hasRoundNumber) {
    db.exec(`ALTER TABLE Messages ADD COLUMN roundNumber INTEGER DEFAULT 1 NOT NULL;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_scene_round ON Messages(sceneId, roundNumber);`);
    console.log('✓ Added roundNumber column to Messages table and created index');
  }
} catch (e) {
  console.warn('Could not ensure Messages.roundNumber column exists:', e);
}

// Create SceneRounds metadata table for tracking round status and vectorization
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS SceneRounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sceneId INTEGER NOT NULL REFERENCES Scenes(id) ON DELETE CASCADE,
      roundNumber INTEGER NOT NULL,
      status TEXT DEFAULT 'in-progress',
      activeCharacters JSON NOT NULL,
      roundStartedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      roundCompletedAt DATETIME,
      vectorized BOOLEAN DEFAULT 0,
      vectorizedAt DATETIME
    );
    
    CREATE INDEX IF NOT EXISTS idx_scene_rounds_scene_vectorized ON SceneRounds(sceneId, vectorized);
    CREATE INDEX IF NOT EXISTS idx_scene_rounds_status ON SceneRounds(sceneId, status);
  `);
  console.log('✓ Created SceneRounds metadata table with indexes');
} catch (e) {
  console.warn('Could not create SceneRounds table:', e);
}

// Ensure Scenes.currentRoundNumber column exists
try {
  const scols = safePragmaAll(db, 'Scenes');
  const hasCurrentRoundNumber = scols.some((c: any) => c.name === 'currentRoundNumber');
  if (!hasCurrentRoundNumber) {
    db.exec(`ALTER TABLE Scenes ADD COLUMN currentRoundNumber INTEGER DEFAULT 1;`);
    console.log('✓ Added currentRoundNumber column to Scenes table');
  }
} catch (e) {
  console.warn('Could not ensure Scenes.currentRoundNumber column exists:', e);
}

export { charactersDb };
export default db;