-- Migration 005: Add Round Tracking Support
-- Purpose: Add roundNumber column to Messages and create SceneRounds metadata table
-- Date: January 14, 2026

-- Add roundNumber column to Messages table
ALTER TABLE Messages ADD COLUMN roundNumber INTEGER DEFAULT 1 NOT NULL;

-- Create index for efficient round-based queries
CREATE INDEX IF NOT EXISTS idx_messages_scene_round ON Messages(sceneId, roundNumber);

-- Create SceneRounds metadata table to track round status and vectorization
CREATE TABLE IF NOT EXISTS SceneRounds (
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

-- Create indexes for SceneRounds queries
CREATE INDEX IF NOT EXISTS idx_scene_rounds_scene_vectorized ON SceneRounds(sceneId, vectorized);
CREATE INDEX IF NOT EXISTS idx_scene_rounds_status ON SceneRounds(sceneId, status);

-- Add currentRoundNumber column to Scenes table
ALTER TABLE Scenes ADD COLUMN currentRoundNumber INTEGER DEFAULT 1;
