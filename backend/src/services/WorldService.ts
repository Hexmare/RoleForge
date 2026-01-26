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
    // Manually delete related records to avoid foreign key constraint issues
    // (In case CASCADE wasn't properly enforced when tables were created)
    
    // Delete World_Lorebooks entries
    db.prepare('DELETE FROM World_Lorebooks WHERE worldId = ?').run(id);
    
    // Delete WorldCharacterOverrides
    db.prepare('DELETE FROM WorldCharacterOverrides WHERE worldId = ?').run(id);
    
    // Delete LoreEntries
    db.prepare('DELETE FROM LoreEntries WHERE worldId = ?').run(id);
    
    // Get all campaigns for this world
    const campaigns = db.prepare('SELECT id FROM Campaigns WHERE worldId = ?').all(id);
    
    // Delete each campaign (which should cascade to arcs, scenes, etc.)
    for (const campaign of campaigns as any[]) {
      // Delete Campaign_Lorebooks
      db.prepare('DELETE FROM Campaign_Lorebooks WHERE campaignId = ?').run(campaign.id);
      
      // Delete CampaignCharacterOverrides
      db.prepare('DELETE FROM CampaignCharacterOverrides WHERE campaignId = ?').run(campaign.id);
      
      // Get all arcs for this campaign
      const arcs = db.prepare('SELECT id FROM Arcs WHERE campaignId = ?').all(campaign.id);
      
      for (const arc of arcs as any[]) {
        // Get all scenes for this arc
        const scenes = db.prepare('SELECT id FROM Scenes WHERE arcId = ?').all(arc.id);
        
        for (const scene of scenes as any[]) {
          // Delete Messages for each scene
          db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(scene.id);
          
          // Delete SceneRounds for each scene
          db.prepare('DELETE FROM SceneRounds WHERE sceneId = ?').run(scene.id);
          
          // Delete CampaignState if it references this scene
          db.prepare('DELETE FROM CampaignState WHERE currentSceneId = ?').run(scene.id);
        }
        
        // Delete all scenes for this arc
        db.prepare('DELETE FROM Scenes WHERE arcId = ?').run(arc.id);
      }
      
      // Delete all arcs for this campaign
      db.prepare('DELETE FROM Arcs WHERE campaignId = ?').run(campaign.id);
      
      // Delete CampaignState for this campaign
      db.prepare('DELETE FROM CampaignState WHERE campaignId = ?').run(campaign.id);
    }
    
    // Delete all campaigns for this world
    db.prepare('DELETE FROM Campaigns WHERE worldId = ?').run(id);
    
    // Finally delete the world itself
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
