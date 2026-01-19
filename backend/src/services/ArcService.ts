import db from '../database';

export const ArcService = {
  create(campaignId: number, name: string, description?: string, orderIndex?: number, authorNote?: string, plot?: string, goals?: string, storyDetails?: string) {
    // determine next orderIndex if not provided
    if (orderIndex === undefined || orderIndex === null) {
      const row = db.prepare('SELECT MAX(orderIndex) as maxIdx FROM Arcs WHERE campaignId = ?').get(campaignId) as any;
      const maxIdx = row?.maxIdx || 0;
      orderIndex = Number(maxIdx) + 1;
    }
    const stmt = db.prepare('INSERT INTO Arcs (campaignId, orderIndex, name, description, authorNote, plot, goals, storyDetails) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(campaignId, orderIndex, name, description || null, authorNote || null, plot || null, goals || null, storyDetails || null);
    return { id: result.lastInsertRowid, campaignId, orderIndex, name, description, authorNote, plot, goals, storyDetails };
  },

  listByCampaign(campaignId: number) {
    return db.prepare('SELECT * FROM Arcs WHERE campaignId = ? ORDER BY orderIndex').all(campaignId);
  },

  getById(id: number) {
    return db.prepare('SELECT * FROM Arcs WHERE id = ?').get(id);
  },

  update(id: number, { name, description, orderIndex, authorNote, plot, goals, storyDetails }: { name?: string; description?: string; orderIndex?: number; authorNote?: string; plot?: string; goals?: string; storyDetails?: string }) {
    const existing = this.getById(id);
    const newName = name ?? existing.name;
    const newDescription = description ?? existing.description;
    const newOrder = orderIndex ?? existing.orderIndex;
    const newAuthorNote = authorNote ?? existing.authorNote;
    const newPlot = plot ?? existing.plot;
    const newGoals = goals ?? existing.goals;
    const newStoryDetails = storyDetails ?? existing.storyDetails;
    const stmt = db.prepare('UPDATE Arcs SET name = ?, description = ?, orderIndex = ?, authorNote = ?, plot = ?, goals = ?, storyDetails = ? WHERE id = ?');
    const result = stmt.run(newName, newDescription, newOrder, newAuthorNote || null, newPlot || null, newGoals || null, newStoryDetails || null, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM Arcs WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  }
};

export default ArcService;
