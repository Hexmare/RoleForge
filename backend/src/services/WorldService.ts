import db from '../database';

function slugify(text: string) {
  return text.toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const WorldService = {
  create(name: string, description?: string, authorNote?: string, settingDetails?: string, storyDetails?: string) {
    const slug = slugify(name);
    const stmt = db.prepare('INSERT INTO Worlds (slug, name, description, authorNote, settingDetails, storyDetails) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(slug, name, description || null, authorNote || null, settingDetails || null, storyDetails || null);
    return { id: result.lastInsertRowid, slug, name, description, authorNote, settingDetails, storyDetails };
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

  update(id: number, {
    name,
    description,
    authorNote,
    settingDetails,
    storyDetails
  }: { name?: string; description?: string; authorNote?: string; settingDetails?: string; storyDetails?: string }) {
    const existing = this.getById(id);
    if (!existing) return { changes: 0 };

    const nextName = name ?? existing.name;
    const nextDescription = description ?? existing.description;
    const nextAuthorNote = authorNote ?? existing.authorNote;
    const nextSettingDetails = settingDetails ?? existing.settingDetails;
    const nextStoryDetails = storyDetails ?? existing.storyDetails;

    const stmt = db.prepare('UPDATE Worlds SET name = ?, description = ?, authorNote = ?, settingDetails = ?, storyDetails = ? WHERE id = ?');
    const result = stmt.run(nextName, nextDescription || null, nextAuthorNote || null, nextSettingDetails || null, nextStoryDetails || null, id);
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
