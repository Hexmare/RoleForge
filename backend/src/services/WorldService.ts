import db from '../database';

function slugify(text: string) {
  return text.toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const WorldService = {
  create(name: string, description?: string) {
    const slug = slugify(name);
    const stmt = db.prepare('INSERT INTO Worlds (slug, name, description) VALUES (?, ?, ?)');
    const result = stmt.run(slug, name, description || null);
    return { id: result.lastInsertRowid, slug, name, description };
  },

  getAll() {
    return db.prepare('SELECT * FROM Worlds ORDER BY name').all();
  },

  getById(id: number) {
    const world = db.prepare('SELECT * FROM Worlds WHERE id = ?').get(id);
    if (!world) return null;
    // Include assigned lorebooks
    const lorebookUuids = db.prepare('SELECT lorebookUuid FROM World_Lorebooks WHERE worldId = ?').all(id).map((r: any) => r.lorebookUuid);
    return { ...world, lorebookUuids };
  },

  update(id: number, { name, description }: { name: string; description?: string }) {
    const stmt = db.prepare('UPDATE Worlds SET name = ?, description = ? WHERE id = ?');
    const result = stmt.run(name, description || null, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM Worlds WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  },

  addLorebook(worldId: number, lorebookUuid: string) {
    const stmt = db.prepare('INSERT OR IGNORE INTO World_Lorebooks (worldId, lorebookUuid) VALUES (?, ?)');
    const result = stmt.run(worldId, lorebookUuid);
    return { changes: result.changes };
  },

  removeLorebook(worldId: number, lorebookUuid: string) {
    const stmt = db.prepare('DELETE FROM World_Lorebooks WHERE worldId = ? AND lorebookUuid = ?');
    const result = stmt.run(worldId, lorebookUuid);
    return { changes: result.changes };
  },

  getLorebooks(worldId: number) {
    return db.prepare('SELECT lorebookUuid FROM World_Lorebooks WHERE worldId = ?').all(worldId).map((r: any) => r.lorebookUuid);
  }
};

export default WorldService;
