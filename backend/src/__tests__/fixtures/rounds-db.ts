/**
 * Test Database Fixtures for Rounds Testing
 * Provides helper functions to set up test databases with round-based data
 */

const Database = require('better-sqlite3');

/**
 * Create an in-memory test database with full schema
 */
export function createTestDatabase(): any {
  const testDb = new Database(':memory:');

  // Enable WAL mode
  testDb.pragma('journal_mode = WAL');

  // Create all necessary tables for testing
  testDb.exec(`
    CREATE TABLE Worlds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
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
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(campaignId, slug)
    );

    CREATE TABLE Scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arcId INTEGER REFERENCES Arcs(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      activeCharacters JSON DEFAULT '[]',
      summary TEXT,
      lastSummarizedMessageId INTEGER,
      summaryTokenCount INTEGER DEFAULT 0,
      worldState JSON DEFAULT '{}',
      lastWorldStateMessageNumber INTEGER DEFAULT 0,
      characterStates JSON DEFAULT '{}',
      currentRoundNumber INTEGER DEFAULT 1,
      UNIQUE(arcId, slug)
    );

    CREATE TABLE Messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
      messageNumber INTEGER NOT NULL,
      message TEXT NOT NULL,
      sender TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      tokenCount INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      source TEXT DEFAULT '',
      roundNumber INTEGER DEFAULT 1 NOT NULL,
      UNIQUE(sceneId, messageNumber)
    );

    CREATE TABLE SceneRounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sceneId INTEGER NOT NULL REFERENCES Scenes(id) ON DELETE CASCADE,
      roundNumber INTEGER NOT NULL,
      status TEXT DEFAULT 'in-progress',
      activeCharacters JSON NOT NULL,
      roundStartedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      roundCompletedAt DATETIME,
      vectorized BOOLEAN DEFAULT 0,
      vectorizedAt DATETIME,
      timeline JSON,
      UNIQUE(sceneId, roundNumber)
    );

    CREATE INDEX idx_messages_scene_round ON Messages(sceneId, roundNumber);
    CREATE INDEX idx_scene_rounds_scene_vectorized ON SceneRounds(sceneId, vectorized);
    CREATE INDEX idx_scene_rounds_status ON SceneRounds(sceneId, status);

    CREATE TABLE CampaignState (
      campaignId INTEGER PRIMARY KEY REFERENCES Campaigns(id) ON DELETE CASCADE,
      currentSceneId INTEGER REFERENCES Scenes(id),
      elapsedMinutes INTEGER DEFAULT 0,
      dynamicFacts JSON DEFAULT '{}',
      trackers JSON DEFAULT '{}',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return testDb;
}

/**
 * Seed test database with a complete world/campaign/arc/scene hierarchy
 */
export function seedTestScene(db: any, sceneOverride?: number): any {
  // Create world
  const worldStmt = db.prepare(`
    INSERT INTO Worlds (slug, name, description)
    VALUES (?, ?, ?)
  `);
  const worldResult = worldStmt.run('test-world', 'Test World', 'A test world for rounds');
  const worldId = worldResult.lastInsertRowid;

  // Create campaign
  const campaignStmt = db.prepare(`
    INSERT INTO Campaigns (worldId, slug, name, description)
    VALUES (?, ?, ?, ?)
  `);
  const campaignResult = campaignStmt.run(worldId, 'test-campaign', 'Test Campaign', 'A test campaign');
  const campaignId = campaignResult.lastInsertRowid;

  // Create arc
  const arcStmt = db.prepare(`
    INSERT INTO Arcs (campaignId, slug, name, description)
    VALUES (?, ?, ?, ?)
  `);
  const arcResult = arcStmt.run(campaignId, 'test-arc', 'Test Arc', 'A test arc');
  const arcId = arcResult.lastInsertRowid;

  // Create scene if not overridden
  let sceneId: number;
  if (sceneOverride !== undefined) {
    sceneId = sceneOverride;
  } else {
    const sceneStmt = db.prepare(`
      INSERT INTO Scenes (arcId, slug, name, description, currentRoundNumber)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sceneResult = sceneStmt.run(arcId, 'test-scene', 'Test Scene', 'A test scene', 1);
    sceneId = sceneResult.lastInsertRowid;
  }

  return { worldId, campaignId, arcId, sceneId };
}

/**
 * Add messages to a scene across a specific round
 */
export function addRoundMessages(db: any, options: any): number[] {
  const { sceneId, roundNumber, messages } = options;

  // Get current max messageNumber for this scene
  const maxResult = db.prepare(`
    SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?
  `).get(sceneId);
  let messageNumber = (maxResult?.maxNum || 0) + 1;

  const messageIds: number[] = [];

  for (const msg of messages) {
    const stmt = db.prepare(`
      INSERT INTO Messages (sceneId, messageNumber, message, sender, roundNumber)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(sceneId, messageNumber, msg.text, msg.sender, roundNumber);
    messageIds.push(result.lastInsertRowid);
    messageNumber++;
  }

  return messageIds;
}

/**
 * Create a completed round with metadata
 */
export function createCompletedRound(db: any, options: any): number {
  const { sceneId, roundNumber, activeCharacters, vectorized = false } = options;

  const stmt = db.prepare(`
    INSERT INTO SceneRounds (sceneId, roundNumber, status, activeCharacters, roundCompletedAt, vectorized, vectorizedAt)
    VALUES (?, ?, 'completed', ?, CURRENT_TIMESTAMP, ?, ?)
  `);

  const result = stmt.run(
    sceneId,
    roundNumber,
    JSON.stringify(activeCharacters),
    vectorized ? 1 : 0,
    vectorized ? new Date().toISOString() : null
  );

  return result.lastInsertRowid;
}

/**
 * Get all messages for a specific round
 */
export function getRoundMessages(db: any, sceneId: number, roundNumber: number): any[] {
  return db.prepare(`
    SELECT * FROM Messages 
    WHERE sceneId = ? AND roundNumber = ? 
    ORDER BY messageNumber ASC
  `).all(sceneId, roundNumber);
}

/**
 * Get the latest round number for a scene
 */
export function getLatestRoundNumber(db: any, sceneId: number): number {
  const result = db.prepare(`
    SELECT MAX(roundNumber) as maxRound FROM Messages WHERE sceneId = ?
  `).get(sceneId);
  return result?.maxRound || 1;
}

/**
 * Get round metadata
 */
export function getRoundMetadata(db: any, sceneId: number, roundNumber: number): any {
  return db.prepare(`
    SELECT * FROM SceneRounds 
    WHERE sceneId = ? AND roundNumber = ?
  `).get(sceneId, roundNumber);
}

/**
 * Get all rounds for a scene
 */
export function getSceneRounds(db: any, sceneId: number): any[] {
  return db.prepare(`
    SELECT * FROM SceneRounds 
    WHERE sceneId = ? 
    ORDER BY roundNumber ASC
  `).all(sceneId);
}

/**
 * Clean up test database
 */
export function cleanupTestDatabase(db: any): void {
  try {
    db.exec(`
      DELETE FROM SceneRounds;
      DELETE FROM Messages;
      DELETE FROM CampaignState;
      DELETE FROM Scenes;
      DELETE FROM Arcs;
      DELETE FROM Campaigns;
      DELETE FROM Worlds;
    `);
    db.close();
  } catch (e) {
    console.warn('Error cleaning up test database:', e);
  }
}

/**
 * Create a complete test scenario with multiple rounds
 */
export function createTestScenario(db: any, options: any): any {
  const { roundCount, messagesPerRound, characters } = options;

  // Seed the scene
  const setup = seedTestScene(db);

  const roundIds: number[] = [];

  // Create multiple rounds with messages
  for (let r = 1; r <= roundCount; r++) {
    // Add messages for this round
    const messages = [];
    for (let m = 0; m < messagesPerRound; m++) {
      const charIndex = m % characters.length;
      messages.push({
        text: `Message ${m + 1} from ${characters[charIndex]}`,
        sender: characters[charIndex],
      });
    }

    addRoundMessages(db, {
      sceneId: setup.sceneId,
      roundNumber: r,
      messages,
    });

    // Create completed round metadata
    const roundId = createCompletedRound(db, {
      sceneId: setup.sceneId,
      roundNumber: r,
      activeCharacters: characters,
      vectorized: r < roundCount, // Vectorize all but last round
    });

    roundIds.push(roundId);
  }

  return { setup, roundIds };
}
