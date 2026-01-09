-- Migration: add metadata column to Messages
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
ALTER TABLE Messages RENAME TO Messages_old;

CREATE TABLE Messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sceneId INTEGER REFERENCES Scenes(id) ON DELETE CASCADE,
  messageNumber INTEGER NOT NULL,
  message TEXT NOT NULL,
  sender TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  charactersPresent JSON,
  tokenCount INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  UNIQUE(sceneId, messageNumber)
);

INSERT INTO Messages (id, sceneId, messageNumber, message, sender, timestamp, charactersPresent, tokenCount)
SELECT id, sceneId, messageNumber, message, sender, timestamp, charactersPresent, tokenCount FROM Messages_old;

DROP TABLE Messages_old;
COMMIT;
