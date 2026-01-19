-- Migration 007: Add timeline column to SceneRounds for multi-pass director flow
-- Date: January 19, 2026

-- Add timeline JSON column to store per-round director/character flow snapshots
ALTER TABLE SceneRounds ADD COLUMN timeline JSON;
