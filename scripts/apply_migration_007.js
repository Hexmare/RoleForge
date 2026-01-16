const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const repoRoot = path.resolve('.');
const sqlPath = path.join(repoRoot, 'backend', 'migrations', '007_add_sourceId_to_messages.sql');
const dbPath = path.join(repoRoot, 'backend', 'roleforge.db');

try {
  if (!fs.existsSync(sqlPath)) {
    console.error('SQL file not found:', sqlPath);
    process.exit(2);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found, creating new DB at', dbPath);
  }
  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(sql);
    console.log('Migration applied successfully:', path.basename(sqlPath));
  } finally {
    db.close();
  }
  // Verify column exists
  const db2 = new Database(dbPath, { readonly: true });
  try {
    const row = db2.prepare("PRAGMA table_info('Messages')").all();
    const has = row.some(r => r.name === 'sourceId');
    console.log('sourceId column present on Messages table:', has);
    process.exit(has ? 0 : 3);
  } finally {
    db2.close();
  }
} catch (e) {
  console.error('Migration failed:', e && e.message ? e.message : e);
  process.exit(1);
}
