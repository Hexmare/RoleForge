const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'roleforge.db');
const db = new Database(dbPath);

const res1 = db.prepare('UPDATE CampaignState SET trackers = ?').run('{}');
const res2 = db.prepare('UPDATE Scenes SET worldState = ?, characterStates = ?').run('{}', '{}');
console.log(JSON.stringify({ dbPath, campaignTrackersCleared: res1.changes, scenesCleared: res2.changes }, null, 2));
