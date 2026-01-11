import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(new URL(import.meta.url).pathname, '..', '..');
const migrationsDir = path.join(repoRoot, 'migrations');

function applySqlFile(dbPath, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(sql);
    console.log(`Applied ${path.basename(filePath)} -> ${dbPath}`);
  } finally {
    db.close();
  }
}

function main() {
  const dataDir = path.join(repoRoot, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const lorebooksDbPath = path.join(dataDir, 'lorebooks.db');
  const roleforgeDbPath = path.join(repoRoot, 'backend', 'roleforge.db');

  // Migration 002 -> apply to data/lorebooks.db
  const m002 = path.join(migrationsDir, '002_create_lorebooks.sql');
  if (fs.existsSync(m002)) {
    applySqlFile(lorebooksDbPath, m002);
  } else {
    console.warn('Migration file missing:', m002);
  }

  // Migration 003 -> apply to backend/roleforge.db
  const m003 = path.join(migrationsDir, '003_add_lorebook_join_tables.sql');
  if (fs.existsSync(m003)) {
    applySqlFile(roleforgeDbPath, m003);
  } else {
    console.warn('Migration file missing:', m003);
  }

  console.log('Migrations complete.');
}

main();
