import db from '../database';

export const SceneService = {
  create(arcId: number, title: string, description?: string, location?: string, timeOfDay?: string, orderIndex?: number) {
    // determine next orderIndex if not provided
    if (orderIndex === undefined || orderIndex === null) {
      const row = db.prepare('SELECT MAX(orderIndex) as maxIdx FROM Scenes WHERE arcId = ?').get(arcId) as any;
      const maxIdx = row?.maxIdx || 0;
      orderIndex = Number(maxIdx) + 1;
    }
    const stmt = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title, description, location, timeOfDay) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(arcId, orderIndex, title, description || null, location || null, timeOfDay || null);
    return { id: result.lastInsertRowid, arcId, orderIndex, title, description, location, timeOfDay };
  },

  listByArc(arcId: number) {
    return db.prepare('SELECT * FROM Scenes WHERE arcId = ? ORDER BY orderIndex').all(arcId);
  },

  getById(id: number) {
    return db.prepare('SELECT * FROM Scenes WHERE id = ?').get(id);
  },

  update(id: number, fields: any) {
    const existing = this.getById(id);
    const title = fields.title ?? existing.title;
    const description = fields.description ?? existing.description;
    const location = fields.location ?? existing.location;
    const timeOfDay = fields.timeOfDay ?? existing.timeOfDay;
    const orderIndex = fields.orderIndex ?? existing.orderIndex;
    const stmt = db.prepare('UPDATE Scenes SET title = ?, description = ?, location = ?, timeOfDay = ?, orderIndex = ? WHERE id = ?');
    const result = stmt.run(title, description, location, timeOfDay, orderIndex, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM Scenes WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  }
};

export default SceneService;
