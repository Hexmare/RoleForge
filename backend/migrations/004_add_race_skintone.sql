-- Add race and skinTone columns to personas table
ALTER TABLE personas ADD COLUMN race TEXT DEFAULT 'Caucasian';
ALTER TABLE personas ADD COLUMN skinTone TEXT DEFAULT 'white';

-- Add skinTone column to characters table
ALTER TABLE characters ADD COLUMN skinTone TEXT DEFAULT 'white';
