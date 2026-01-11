PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS World_Lorebooks (
  worldId INTEGER NOT NULL,
  lorebookUuid TEXT NOT NULL,
  PRIMARY KEY (worldId, lorebookUuid),
  FOREIGN KEY (worldId) REFERENCES Worlds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Campaign_Lorebooks (
  campaignId INTEGER NOT NULL,
  lorebookUuid TEXT NOT NULL,
  PRIMARY KEY (campaignId, lorebookUuid),
  FOREIGN KEY (campaignId) REFERENCES Campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_World_Lorebooks_lorebookUuid ON World_Lorebooks(lorebookUuid);
CREATE INDEX IF NOT EXISTS ix_Campaign_Lorebooks_lorebookUuid ON Campaign_Lorebooks(lorebookUuid);
