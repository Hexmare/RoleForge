PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Lorebooks (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scan_depth INTEGER DEFAULT 4,
  token_budget INTEGER DEFAULT 2048,
  recursive_scanning INTEGER DEFAULT 1,
  extensions TEXT DEFAULT '[]',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LoreEntries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lorebookUuid TEXT NOT NULL,
  uid INTEGER NOT NULL,
  key TEXT NOT NULL,
  optional_filter TEXT,
  title_memo TEXT,
  content TEXT NOT NULL,
  constant INTEGER DEFAULT 0,
  selective INTEGER DEFAULT 0,
  selectiveLogic INTEGER DEFAULT 0,
  insertion_order INTEGER DEFAULT 100,
  insertion_position TEXT DEFAULT 'Before Char Defs',
  outletName TEXT,
  enabled INTEGER DEFAULT 1,
  preventRecursion INTEGER DEFAULT 0,
  probability INTEGER DEFAULT 100,
  useProbability INTEGER DEFAULT 0,
  depth INTEGER,
  caseSensitive INTEGER DEFAULT 0,
  matchWholeWords INTEGER DEFAULT 1,
  vectorized INTEGER DEFAULT 0,
  groupName TEXT,
  groupOverride INTEGER DEFAULT 0,
  groupWeight INTEGER DEFAULT 50,
  useGroupScoring INTEGER DEFAULT 0,
  automationId TEXT,
  sticky INTEGER DEFAULT 0,
  cooldown INTEGER DEFAULT 0,
  delay INTEGER DEFAULT 0,
  triggers TEXT,
  additional_matching_sources TEXT,
  extensions TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lorebookUuid) REFERENCES Lorebooks(uuid) ON DELETE CASCADE,
  UNIQUE (lorebookUuid, uid)
);

CREATE INDEX IF NOT EXISTS ix_LoreEntries_lorebookUuid ON LoreEntries(lorebookUuid);
CREATE INDEX IF NOT EXISTS ix_LoreEntries_groupName ON LoreEntries(groupName);
