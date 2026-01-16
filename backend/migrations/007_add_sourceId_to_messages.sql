-- Migration: add sourceId column to Messages
-- Adds a nullable sourceId to track personaId or characterId for message author
ALTER TABLE Messages ADD COLUMN sourceId TEXT;
