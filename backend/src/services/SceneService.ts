import db from '../database';
import MessageService from './MessageService';
import CampaignService from './CampaignService';
import { VectorStoreFactory } from '../utils/vectorStoreFactory.js';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, NAMESPACES } from '../logging';

const sceneLog = createLogger(NAMESPACES.services.scene);

export const SceneService = {
  create(arcId: number, title: string, description?: string, location?: string, timeOfDay?: string, orderIndex?: number) {
    // determine next orderIndex if not provided
    if (orderIndex === undefined || orderIndex === null) {
      const row = db.prepare('SELECT MAX(orderIndex) as maxIdx FROM Scenes WHERE arcId = ?').get(arcId) as any;
      const maxIdx = row?.maxIdx || 0;
      orderIndex = Number(maxIdx) + 1;
    }
    const stmt = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title, description, location, timeOfDay, worldState, lastWorldStateMessageNumber, characterStates, userPersonaState) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(arcId, orderIndex, title, description || null, location || null, timeOfDay || null, '{}', 0, '{}', '{}');
    return { id: result.lastInsertRowid, arcId, orderIndex, title, description, location, timeOfDay, worldState: {}, lastWorldStateMessageNumber: 0, characterStates: {}, userPersonaState: {} };
  },

  listByArc(arcId: number) {
    return db.prepare('SELECT * FROM Scenes WHERE arcId = ? ORDER BY orderIndex').all(arcId);
  },

  // Task 3.1: Updated to include currentRoundNumber
  getById(id: number) {
    const scene = db.prepare('SELECT * FROM Scenes WHERE id = ?').get(id);
    if (scene && typeof scene.currentRoundNumber === 'undefined') {
      scene.currentRoundNumber = 1;
    }
    return scene;
  },

  // Helper: Get worldId from sceneId by traversing relationships
  // sceneId -> arcId -> campaignId -> worldId
  getWorldIdFromSceneId(sceneId: number): number {
    const result = db.prepare(`
      SELECT c.worldId 
      FROM Scenes s 
      LEFT JOIN Arcs a ON a.id = s.arcId
      LEFT JOIN Campaigns c ON c.id = a.campaignId
      WHERE s.id = ?
    `).get(sceneId) as any;
    
    if (!result || !result.worldId) {
      throw new Error(`Could not find worldId for sceneId ${sceneId}`);
    }
    
    return result.worldId;
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
    const userPersonaState = fields.userPersonaState !== undefined ? JSON.stringify(fields.userPersonaState) : existing.userPersonaState;
    const activeCharacters = fields.activeCharacters !== undefined ? JSON.stringify(fields.activeCharacters) : existing.activeCharacters;
    const stmt = db.prepare('UPDATE Scenes SET title = ?, description = ?, location = ?, timeOfDay = ?, orderIndex = ?, worldState = ?, lastWorldStateMessageNumber = ?, characterStates = ?, userPersonaState = ?, activeCharacters = ? WHERE id = ?');
    const result = stmt.run(title, description, location, timeOfDay, orderIndex, worldState, lastWorldStateMessageNumber, characterStates, userPersonaState, activeCharacters, id);
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
        sceneLog('Removed generated images directory: %s', scenePath);
      }
      
      // Check and remove empty parent directories
      const arcPath = path.dirname(scenePath);
        if (fs.existsSync(arcPath) && fs.readdirSync(arcPath).length === 0) {
          fs.rmdirSync(arcPath);
          sceneLog('Removed empty arc directory: %s', arcPath);
        
        const campaignPath = path.dirname(arcPath);
          if (fs.existsSync(campaignPath) && fs.readdirSync(campaignPath).length === 0) {
            fs.rmdirSync(campaignPath);
            sceneLog('Removed empty campaign directory: %s', campaignPath);
          
          const worldPath = path.dirname(campaignPath);
            if (fs.existsSync(worldPath) && fs.readdirSync(worldPath).length === 0) {
              fs.rmdirSync(worldPath);
              sceneLog('Removed empty world directory: %s', worldPath);
          }
        }
      }
    } catch (error) {
      sceneLog('Error cleaning up generated images: %o', error);
    }
  },

  async reset(id: number) {
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

    // Clear all round metadata for this scene
    db.prepare('DELETE FROM SceneRounds WHERE sceneId = ?').run(id);

    // Clean up generated images
    this._cleanupGeneratedImages(worldRow.id, campaignRow.id, arcRow.id, id);

    // Reset scene details except description and location
    // Also reset currentRoundNumber to 1
    // NOTE: Keep worldState as it's shared across the world, not scene-specific
    const stmt = db.prepare('UPDATE Scenes SET title = ?, timeOfDay = ?, worldState = ?, lastWorldStateMessageNumber = ?, characterStates = ?, summary = ?, lastSummarizedMessageId = ?, summaryTokenCount = ?, activeCharacters = ?, notes = ?, backgroundImage = ?, locationRelationships = ?, currentRoundNumber = ? WHERE id = ?');
    const result = stmt.run(
      existing.title, // keep title
      existing.timeOfDay, // keep timeOfDay
      existing.worldState, // KEEP worldState - it's shared across the world
      0, // reset lastWorldStateMessageNumber
      '{}', // reset characterStates
      null, // reset summary
      null, // reset lastSummarizedMessageId
      null, // reset summaryTokenCount
      null, // reset activeCharacters
      null, // reset notes
      null, // reset backgroundImage
      null, // reset locationRelationships
      1, // reset currentRoundNumber to 1
      id
    );

    // Delete vectorized data for this specific scene only (not all character vectors)
    try {
      const vectorStore = VectorStoreFactory.getVectorStore();
      if (vectorStore) {
        // Get all characters in the world
        try {
          const { CharacterService } = await import('../services/CharacterService.js');
          const allCharacters = CharacterService.getAllCharacters();
          
          const deletePromises = [];

          // Delete from each character's scope
          for (const character of allCharacters) {
            const characterId = character.id;
            const scope = `world_${worldRow.id}_char_${characterId}`;
            
            // Get all vector entries for this character
            try {
              const fs = await import('fs');
              const path = await import('path');
              const vectorDir = path.join(
                process.cwd(),
                'vector_data',
                scope
              );

              // Check if directory exists
              if (fs.existsSync(vectorDir)) {
                const indexPath = path.join(vectorDir, 'index.json');
                if (fs.existsSync(indexPath)) {
                  // Read the index file
                  const indexContent = fs.readFileSync(indexPath, 'utf-8');
                  const indexData = JSON.parse(indexContent);

                  // Filter out items with matching sceneId
                  const originalCount = indexData.items?.length || 0;
                  indexData.items = (indexData.items || []).filter((item: any) => {
                    return item.metadata?.sceneId !== id;
                  });
                  const newCount = indexData.items?.length || 0;
                  const removedCount = originalCount - newCount;

                    if (removedCount > 0) {
                      // Write back the filtered index
                      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
                      sceneLog('[SCENE_RESET] Removed %d vector entries for character %d in scene %d', removedCount, characterId, id);
                  }
                }
              }
            } catch (err) {
                sceneLog('[SCENE_RESET] Failed to clean vectors for character %d: %o', characterId, err);
            }
          }

          // Also clean multi-character scope if it exists
          try {
            const fs = await import('fs');
            const path = await import('path');
            const multiScope = `world_${worldRow.id}_multi`;
            const vectorDir = path.join(
              process.cwd(),
              'vector_data',
              multiScope
            );

            if (fs.existsSync(vectorDir)) {
              const indexPath = path.join(vectorDir, 'index.json');
              if (fs.existsSync(indexPath)) {
                const indexContent = fs.readFileSync(indexPath, 'utf-8');
                const indexData = JSON.parse(indexContent);

                const originalCount = indexData.items?.length || 0;
                indexData.items = (indexData.items || []).filter((item: any) => {
                  return item.metadata?.sceneId !== id;
                });
                const newCount = indexData.items?.length || 0;
                const removedCount = originalCount - newCount;

                  if (removedCount > 0) {
                    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
                    sceneLog('[SCENE_RESET] Removed %d shared vector entries in scene %d', removedCount, id);
                }
              }
            }
          } catch (err) {
              sceneLog('[SCENE_RESET] Failed to clean shared vectors: %o', err);
          }

            sceneLog('[SCENE_RESET] Completed vector cleanup for scene %d', id);
        } catch (error) {
            sceneLog('[SCENE_RESET] Failed to clean up vector files: %o', error);
        }
      }
    } catch (error) {
        sceneLog('[SCENE_RESET] Failed to initialize vector cleanup: %o', error);
      // Non-blocking - don't fail the reset if vector cleanup fails
    }

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
  },

  // Task 3.2: Initialize a new round in the scene
  initializeRound(sceneId: number): number {
    const latest = MessageService.getLatestRound(sceneId);
    const newRound = latest + 1;
    
    db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?')
      .run(newRound, sceneId);
    
    return newRound;
  },

  // Task 3.3: Start a new round (create record when round begins)
  startRound(sceneId: number, activeCharacters: string[] = []): number {
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    const roundNumber = scene.currentRoundNumber;
    
    // Check if this round already exists
    const existing = db.prepare(
      'SELECT id FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneId, roundNumber) as any;

    if (!existing) {
      // Create new round record with 'in-progress' status
      db.prepare(`
        INSERT INTO SceneRounds (
          sceneId, roundNumber, status, activeCharacters
        ) VALUES (?, ?, 'in-progress', ?)
      `).run(sceneId, roundNumber, JSON.stringify(activeCharacters));
      sceneLog('[SCENE_SERVICE] Started round %d for scene %d', roundNumber, sceneId);
    }

    return roundNumber;
  },

  // Task 3.4: Mark the current round as complete with metadata AND start the next round
  // This is atomic - completes previous round, advances round number, creates new round record
  completeRound(sceneId: number, activeCharacters: string[]): number {
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    if (!scene) throw new Error(`Scene ${sceneId} not found`);
    
    const completedRoundNumber = scene.currentRoundNumber;
    const nextRoundNumber = completedRoundNumber + 1;
    
    sceneLog('[SCENE_SERVICE] Completing round %d and starting round %d for scene %d', completedRoundNumber, nextRoundNumber, sceneId);

    // 1. Mark the PREVIOUS round as completed in SceneRounds
    const existing = db.prepare(
      'SELECT id FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneId, completedRoundNumber) as any;

    if (existing) {
      const result = db.prepare(`
        UPDATE SceneRounds 
        SET status = 'completed', activeCharacters = ?, roundCompletedAt = CURRENT_TIMESTAMP
        WHERE sceneId = ? AND roundNumber = ?
      `).run(JSON.stringify(activeCharacters), sceneId, completedRoundNumber);
      sceneLog('[SCENE_SERVICE] ✓ Marked round %d as completed (changes=%d)', completedRoundNumber, result.changes);
    } else {
      const result = db.prepare(`
        INSERT INTO SceneRounds (
          sceneId, roundNumber, status, activeCharacters, roundCompletedAt
        ) VALUES (?, ?, 'completed', ?, CURRENT_TIMESTAMP)
      `).run(sceneId, completedRoundNumber, JSON.stringify(activeCharacters));
      sceneLog('[SCENE_SERVICE] ✓ Created completed round record for round %d', completedRoundNumber);
    }
    
    // 2. Increment currentRoundNumber in Scenes table (THIS IS THE AUTHORITY)
    const updateResult = db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?')
      .run(nextRoundNumber, sceneId);
    sceneLog('[SCENE_SERVICE] ✓ Incremented Scenes.currentRoundNumber to %d (changes=%d)', nextRoundNumber, updateResult.changes);

    // 3. Create a NEW round record for the next round (in-progress status)
    const newRoundResult = db.prepare(`
      INSERT INTO SceneRounds (
        sceneId, roundNumber, status, activeCharacters
      ) VALUES (?, ?, 'in-progress', '[]')
    `).run(sceneId, nextRoundNumber);
    sceneLog('[SCENE_SERVICE] ✓ Created new round record for round %d', nextRoundNumber);

    // Verify the state
    const verified = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    sceneLog('[SCENE_SERVICE] ✓ VERIFICATION: Scene %d currentRoundNumber=%d (expected %d)', sceneId, verified?.currentRoundNumber, nextRoundNumber);

    return nextRoundNumber;
  },

  // Task 3.4: Get round metadata
  getRoundData(sceneId: number, roundNumber: number): any {
    return db.prepare(
      'SELECT * FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneId, roundNumber) || null;
  },

  updateRoundTimeline(sceneId: number, roundNumber: number, timeline: any): void {
    const payload = timeline === undefined ? null : JSON.stringify(timeline);
    const existing = db.prepare(
      'SELECT id FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneId, roundNumber) as any;

    if (existing?.id) {
      db.prepare('UPDATE SceneRounds SET timeline = ? WHERE sceneId = ? AND roundNumber = ?')
        .run(payload, sceneId, roundNumber);
      return;
    }

    db.prepare(
      'INSERT INTO SceneRounds (sceneId, roundNumber, status, activeCharacters, timeline) VALUES (?, ?, "in-progress", ?, ?)'
    ).run(sceneId, roundNumber, '[]', payload);
  },

  // Task 3.5: Mark a round as processed by VectorizationAgent
  markRoundVectorized(sceneId: number, roundNumber: number): void {
    db.prepare(`
      UPDATE SceneRounds 
      SET vectorized = 1, vectorizedAt = CURRENT_TIMESTAMP 
      WHERE sceneId = ? AND roundNumber = ?
    `).run(sceneId, roundNumber);
  },

  // Task 3.6: Get all unvectorized rounds (for VectorizationAgent queue)
  getUnvectorizedRounds(sceneId: number): any[] {
    return db.prepare(`
      SELECT * FROM SceneRounds 
      WHERE sceneId = ? AND status = 'completed' AND vectorized = 0
      ORDER BY roundNumber ASC
    `).all(sceneId);
  }
};

export default SceneService;
