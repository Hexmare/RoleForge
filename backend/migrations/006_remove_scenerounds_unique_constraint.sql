-- Migration 006: Remove UNIQUE constraint from SceneRounds
-- Purpose: Allow multiple metadata entries for same (sceneId, roundNumber) since rounds can have multiple messages
-- Date: January 14, 2026

-- SQLite doesn't support dropping constraints directly, so we need to recreate the table
-- Step 1: Create new table without UNIQUE constraint
CREATE TABLE SceneRounds_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sceneId INTEGER NOT NULL REFERENCES Scenes(id) ON DELETE CASCADE,
  roundNumber INTEGER NOT NULL,
  status TEXT DEFAULT 'in-progress',      -- 'in-progress' | 'completed'
  activeCharacters JSON NOT NULL,          -- Array of character IDs/names active in this round
  roundStartedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  roundCompletedAt DATETIME,
  vectorized BOOLEAN DEFAULT 0,            -- Has this round been vectorized?
  vectorizedAt DATETIME
);

-- Step 2: Copy all existing data to new table
INSERT INTO SceneRounds_new SELECT * FROM SceneRounds;

-- Step 3: Drop old table
DROP TABLE SceneRounds;

-- Step 4: Rename new table to original name
ALTER TABLE SceneRounds_new RENAME TO SceneRounds;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_scene_rounds_scene_vectorized ON SceneRounds(sceneId, vectorized);
CREATE INDEX IF NOT EXISTS idx_scene_rounds_status ON SceneRounds(sceneId, status);
