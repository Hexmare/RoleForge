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
    const campaignId = result.lastInsertRowid as number;
    
    // Create initial campaign state
    const stateStmt = db.prepare(`
      INSERT INTO CampaignState (campaignId, currentSceneId, elapsedMinutes, dynamicFacts, trackers)
      VALUES (?, ?, ?, ?, ?)
    `);
    stateStmt.run(campaignId, null, 0, '{}', JSON.stringify({ stats: {}, objectives: [], relationships: {} }));
    
    return { id: campaignId, worldId, slug, name, description };
  },

  listByWorld(worldId: number) {
    return db.prepare('SELECT * FROM Campaigns WHERE worldId = ? ORDER BY createdAt').all(worldId);
  },

  getById(id: number) {
    const campaign = db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(id);
    if (!campaign) return null;
    // Include assigned lorebooks
    const lorebookUuids = db.prepare('SELECT lorebookUuid FROM Campaign_Lorebooks WHERE campaignId = ?').all(id).map((r: any) => r.lorebookUuid);
    return { ...campaign, lorebookUuids };
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
    const state = db.prepare('SELECT * FROM CampaignState WHERE campaignId = ?').get(campaignId);
    if (!state) {
      // Return default state structure if no state exists yet
      return {
        campaignId,
        currentSceneId: null,
        elapsedMinutes: 0,
        dynamicFacts: {},
        trackers: { stats: {}, objectives: [], relationships: {} },
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      ...state,
      dynamicFacts: typeof state.dynamicFacts === 'string' ? JSON.parse(state.dynamicFacts) : state.dynamicFacts,
      trackers: typeof state.trackers === 'string' ? JSON.parse(state.trackers) : state.trackers,
    };
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
      const dynamicFacts = updates.dynamicFacts !== undefined 
        ? JSON.stringify(updates.dynamicFacts) 
        : JSON.stringify(existing.dynamicFacts);
      const trackers = updates.trackers !== undefined 
        ? JSON.stringify(updates.trackers) 
        : JSON.stringify(existing.trackers);
        
      const stmt = db.prepare(`
        UPDATE CampaignState
        SET currentSceneId = ?, elapsedMinutes = ?, dynamicFacts = ?, trackers = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE campaignId = ?
      `);
      stmt.run(
        updates.currentSceneId !== undefined ? updates.currentSceneId : existing.currentSceneId,
        updates.elapsedMinutes !== undefined ? updates.elapsedMinutes : existing.elapsedMinutes,
        dynamicFacts,
        trackers,
        campaignId
      );
    }
    return this.getState(campaignId);
  },

  addLorebook(campaignId: number, lorebookUuid: string) {
    const stmt = db.prepare('INSERT OR IGNORE INTO Campaign_Lorebooks (campaignId, lorebookUuid) VALUES (?, ?)');
    const result = stmt.run(campaignId, lorebookUuid);
    return { changes: result.changes };
  },

  removeLorebook(campaignId: number, lorebookUuid: string) {
    const stmt = db.prepare('DELETE FROM Campaign_Lorebooks WHERE campaignId = ? AND lorebookUuid = ?');
    const result = stmt.run(campaignId, lorebookUuid);
    return { changes: result.changes };
  },

  getLorebooks(campaignId: number) {
    return db.prepare('SELECT lorebookUuid FROM Campaign_Lorebooks WHERE campaignId = ?').all(campaignId).map((r: any) => r.lorebookUuid);
  }
};

export default CampaignService;
