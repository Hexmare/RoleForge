-- Add userPersonaState column to Scenes table
ALTER TABLE Scenes ADD COLUMN userPersonaState JSON DEFAULT '{}';

-- Update existing scenes to extract user persona state from characterStates
-- This will be handled in code for existing data