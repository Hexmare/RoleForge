import db from '../database';
import { randomUUID } from 'crypto';

function slugify(text: string) {
  return text.toString().toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const CampaignService = {
  create(worldId: number, name: string, description?: string) {
    const slug = slugify(name);
    const stmt = db.prepare('INSERT INTO Campaigns (worldId, slug, name, description) VALUES (?, ?, ?, ?)');
    const result = stmt.run(worldId, slug, name, description || null);
    return { id: result.lastInsertRowid, worldId, slug, name, description };
  },

  listByWorld(worldId: number) {
    return db.prepare('SELECT * FROM Campaigns WHERE worldId = ? ORDER BY createdAt').all(worldId);
  },

  getById(id: number) {
    return db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(id);
  },

  update(id: number, { name, description }: { name: string; description?: string }) {
    const stmt = db.prepare('UPDATE Campaigns SET name = ?, description = ? WHERE id = ?');
    const result = stmt.run(name, description || null, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    const stmt = db.prepare('DELETE FROM Campaigns WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  },

  getState(campaignId: number) {
    return db.prepare('SELECT * FROM CampaignState WHERE campaignId = ?').get(campaignId);
  },

  updateState(campaignId: number, updates: { currentSceneId?: number; elapsedMinutes?: number; dynamicFacts?: any; trackers?: any }) {
    const existing = this.getState(campaignId);
    if (!existing) {
      // Insert new state
      const stmt = db.prepare(`
        INSERT INTO CampaignState (campaignId, currentSceneId, elapsedMinutes, dynamicFacts, trackers)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(
        campaignId,
        updates.currentSceneId || null,
        updates.elapsedMinutes || 0,
        JSON.stringify(updates.dynamicFacts || {}),
        JSON.stringify(updates.trackers || {})
      );
    } else {
      // Update existing state
      const stmt = db.prepare(`
        UPDATE CampaignState
        SET currentSceneId = ?, elapsedMinutes = ?, dynamicFacts = ?, trackers = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE campaignId = ?
      `);
      stmt.run(
        updates.currentSceneId !== undefined ? updates.currentSceneId : existing.currentSceneId,
        updates.elapsedMinutes !== undefined ? updates.elapsedMinutes : existing.elapsedMinutes,
        updates.dynamicFacts !== undefined ? JSON.stringify(updates.dynamicFacts) : existing.dynamicFacts,
        updates.trackers !== undefined ? JSON.stringify(updates.trackers) : existing.trackers,
        campaignId
      );
    }
    return this.getState(campaignId);
  }
};

export default CampaignService;
