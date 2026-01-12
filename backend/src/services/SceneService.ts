import db from '../database';
import MessageService from './MessageService';
import CampaignService from './CampaignService';
import * as fs from 'fs';
import * as path from 'path';

export const SceneService = {
  create(arcId: number, title: string, description?: string, location?: string, timeOfDay?: string, orderIndex?: number) {
    // determine next orderIndex if not provided
    if (orderIndex === undefined || orderIndex === null) {
      const row = db.prepare('SELECT MAX(orderIndex) as maxIdx FROM Scenes WHERE arcId = ?').get(arcId) as any;
      const maxIdx = row?.maxIdx || 0;
      orderIndex = Number(maxIdx) + 1;
    }
    const stmt = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title, description, location, timeOfDay, worldState, lastWorldStateMessageNumber, characterStates) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(arcId, orderIndex, title, description || null, location || null, timeOfDay || null, '{}', 0, '{}');
    return { id: result.lastInsertRowid, arcId, orderIndex, title, description, location, timeOfDay, worldState: {}, lastWorldStateMessageNumber: 0, characterStates: {} };
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
    const worldState = fields.worldState !== undefined ? JSON.stringify(fields.worldState) : existing.worldState;
    const lastWorldStateMessageNumber = fields.lastWorldStateMessageNumber ?? existing.lastWorldStateMessageNumber;
    const characterStates = fields.characterStates !== undefined ? JSON.stringify(fields.characterStates) : existing.characterStates;
    const stmt = db.prepare('UPDATE Scenes SET title = ?, description = ?, location = ?, timeOfDay = ?, orderIndex = ?, worldState = ?, lastWorldStateMessageNumber = ?, characterStates = ? WHERE id = ?');
    const result = stmt.run(title, description, location, timeOfDay, orderIndex, worldState, lastWorldStateMessageNumber, characterStates, id);
    return { changes: result.changes };
  },

  delete(id: number) {
    // First, clear any references to this scene in CampaignState
    const clearStmt = db.prepare('UPDATE CampaignState SET currentSceneId = NULL WHERE currentSceneId = ?');
    clearStmt.run(id);
    
    const stmt = db.prepare('DELETE FROM Scenes WHERE id = ?');
    const result = stmt.run(id);
    return { changes: result.changes };
  },

  // Helper function to remove directory and clean up empty parent directories
  _cleanupGeneratedImages(worldId: number, campaignId: number, arcId: number, sceneId: number) {
    try {
      const basePath = path.join(process.cwd(), 'backend', 'public', 'generated');
      const scenePath = path.join(basePath, String(worldId), String(campaignId), String(arcId), String(sceneId));
      
      // Remove scene directory if it exists
      if (fs.existsSync(scenePath)) {
        fs.rmSync(scenePath, { recursive: true, force: true });
        console.log(`Removed generated images directory: ${scenePath}`);
      }
      
      // Check and remove empty parent directories
      const arcPath = path.dirname(scenePath);
      if (fs.existsSync(arcPath) && fs.readdirSync(arcPath).length === 0) {
        fs.rmdirSync(arcPath);
        console.log(`Removed empty arc directory: ${arcPath}`);
        
        const campaignPath = path.dirname(arcPath);
        if (fs.existsSync(campaignPath) && fs.readdirSync(campaignPath).length === 0) {
          fs.rmdirSync(campaignPath);
          console.log(`Removed empty campaign directory: ${campaignPath}`);
          
          const worldPath = path.dirname(campaignPath);
          if (fs.existsSync(worldPath) && fs.readdirSync(worldPath).length === 0) {
            fs.rmdirSync(worldPath);
            console.log(`Removed empty world directory: ${worldPath}`);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up generated images:', error);
    }
  },

  reset(id: number) {
    const existing = this.getById(id);
    if (!existing) return { error: 'Scene not found' };

    // Get hierarchy IDs for image cleanup
    const arcRow = db.prepare('SELECT * FROM Arcs WHERE id = ?').get(existing.arcId) as any;
    if (!arcRow) return { error: 'Arc not found' };
    
    const campaignRow = db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
    if (!campaignRow) return { error: 'Campaign not found' };
    
    const worldRow = db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;
    if (!worldRow) return { error: 'World not found' };

    // Clear all messages for this scene
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(id);

    // Clean up generated images
    this._cleanupGeneratedImages(worldRow.id, campaignRow.id, arcRow.id, id);

    // Reset scene details except description and location
    const stmt = db.prepare('UPDATE Scenes SET title = ?, timeOfDay = ?, worldState = ?, lastWorldStateMessageNumber = ?, characterStates = ?, summary = ?, lastSummarizedMessageId = ?, summaryTokenCount = ?, activeCharacters = ?, notes = ?, backgroundImage = ?, locationRelationships = ? WHERE id = ?');
    const result = stmt.run(
      existing.title, // keep title
      existing.timeOfDay, // keep timeOfDay
      '{}', // reset worldState
      0, // reset lastWorldStateMessageNumber
      '{}', // reset characterStates
      null, // reset summary
      null, // reset lastSummarizedMessageId
      null, // reset summaryTokenCount
      null, // reset activeCharacters
      null, // reset notes
      null, // reset backgroundImage
      null, // reset locationRelationships
      id
    );

    // Also reset campaign trackers and dynamicFacts
    CampaignService.updateState(campaignRow.id, { trackers: {}, dynamicFacts: {} });

    return { changes: result.changes };
  },

  getLoreContext(sceneId: number, scanDepth: number = 4) {
    const scene = this.getById(sceneId);
    if (!scene) return null;

    // Scene description/location/time
    const sceneText = [
      scene.description || '',
      scene.location || '',
      scene.timeOfDay || ''
    ].filter(Boolean).join(' ');

    // Recent messages
    const messages: any[] = MessageService.getMessages(sceneId, scanDepth, 0);
    const messageText = messages.map((m: any) => m.message).join(' ');

    // Active characters
    const activeCharacters = scene.activeCharacters ? JSON.parse(scene.activeCharacters) : [];

    // Selected persona
    const personaRow = db.prepare('SELECT value FROM Settings WHERE key = ?').get('selectedPersona') as any;
    const selectedPersona = personaRow ? personaRow.value : null;

    const contextText = [sceneText, messageText].filter(Boolean).join(' ');

    return {
      text: contextText,
      activeCharacters,
      selectedPersona
    };
  }
};

export default SceneService;
