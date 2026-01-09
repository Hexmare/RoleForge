import db from '../database';

export const ArcService = {
  create(campaignId: number, name: string, description?: string, orderIndex?: number) {
    // determine next orderIndex if not provided
    if (orderIndex === undefined || orderIndex === null) {
      const row = db.prepare('SELECT MAX(orderIndex) as maxIdx FROM Arcs WHERE campaignId = ?').get(campaignId) as any;
      const maxIdx = row?.maxIdx || 0;
      orderIndex = Number(maxIdx) + 1;
    }
    const stmt = db.prepare('INSERT INTO Arcs (campaignId, orderIndex, name, description) VALUES (?, ?, ?, ?)');
    const result = stmt.run(campaignId, orderIndex, name, description || null);
    return { id: result.lastInsertRowid, campaignId, orderIndex, name, description };
  },

  listByCampaign(campaignId: number) {
    return db.prepare('SELECT * FROM Arcs WHERE campaignId = ? ORDER BY orderIndex').all(campaignId);
  },

  getById(id: number) {
    return db.prepare('SELECT * FROM Arcs WHERE id = ?').get(id);
  },

  update(id: number, { name, description, orderIndex }: { name?: string; description?: string; orderIndex?: number }) {
    const existing = this.getById(id);
    const newName = name ?? existing.name;
    const newDescription = description ?? existing.description;
    const newOrder = orderIndex ?? existing.orderIndex;
    const stmt = db.prepare('UPDATE Arcs SET name = ?, description = ?, orderIndex = ? WHERE id = ?');
    const result = stmt.run(newName, newDescription, newOrder, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM Arcs WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  }
};

export default ArcService;
