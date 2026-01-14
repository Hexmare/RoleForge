import db from '../database';
import MessageService from './MessageService';
import CampaignService from './CampaignService';
import { VectorStoreFactory } from '../utils/vectorStoreFactory.js';
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
    const stmt = db.prepare('UPDATE Scenes SET title = ?, description = ?, location = ?, timeOfDay = ?, orderIndex = ?, worldState = ?, lastWorldStateMessageNumber = ?, characterStates = ?, userPersonaState = ? WHERE id = ?');
    const result = stmt.run(title, description, location, timeOfDay, orderIndex, worldState, lastWorldStateMessageNumber, characterStates, userPersonaState, id);
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
        // Parse active characters from the scene
        let activeCharacters: string[] = [];
        try {
          const sceneData = this.getById(id);
          if (sceneData?.activeCharacters) {
            const parsed = typeof sceneData.activeCharacters === 'string' 
              ? JSON.parse(sceneData.activeCharacters) 
              : sceneData.activeCharacters;
            activeCharacters = Array.isArray(parsed) 
              ? parsed.map((c: any) => typeof c === 'string' ? c : c.name || c.id)
              : [];
          }
        } catch (e) {
          console.warn('[SCENE_RESET] Failed to parse active characters:', e);
        }

        // Query and delete memories that belong to THIS scene only
        const deletePromises = [];
        for (const characterName of activeCharacters) {
          const scope = `world_${worldRow.id}_char_${characterName}`;
          
          // Query all memories in this character's scope
          try {
            const allMemories = await vectorStore.query('*', scope, 1000, 0.0);
            
            // Filter to only memories from this scene
            const memoriesToDelete = allMemories.filter((memory: any) => {
              return memory.metadata?.sceneId === id;
            });

            // Delete only the memories from this scene
            for (const memory of memoriesToDelete) {
              deletePromises.push(
                vectorStore.deleteMemory(memory.id, scope).catch((err: any) => {
                  console.warn(`[SCENE_RESET] Failed to delete memory ${memory.id}:`, err);
                })
              );
            }

            console.log(`[SCENE_RESET] Found ${memoriesToDelete.length} memories for ${characterName} in scene ${id}`);
          } catch (err) {
            console.warn(`[SCENE_RESET] Failed to query memories for character ${characterName}:`, err);
          }
        }

        // Also query and delete from multi-character shared scope
        const multiScope = `world_${worldRow.id}_multi`;
        try {
          const allMemories = await vectorStore.query('*', multiScope, 1000, 0.0);
          const memoriesToDelete = allMemories.filter((memory: any) => {
            return memory.metadata?.sceneId === id;
          });

          for (const memory of memoriesToDelete) {
            deletePromises.push(
              vectorStore.deleteMemory(memory.id, multiScope).catch((err: any) => {
                console.warn(`[SCENE_RESET] Failed to delete shared memory ${memory.id}:`, err);
              })
            );
          }

          console.log(`[SCENE_RESET] Found ${memoriesToDelete.length} shared memories in scene ${id}`);
        } catch (err) {
          console.warn(`[SCENE_RESET] Failed to query shared memories:`, err);
        }

        // Wait for all deletions
        Promise.all(deletePromises).then(() => {
          console.log(`[SCENE_RESET] Deleted vectors for scene ${id} only (not entire character vectors)`);
        }).catch((err: any) => {
          console.warn(`[SCENE_RESET] Error during vector cleanup:`, err);
        });
      }
    } catch (error) {
      console.warn('[SCENE_RESET] Failed to clean up vector store:', error);
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
      console.log(`[SCENE_SERVICE] Started round ${roundNumber} for scene ${sceneId}`);
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
    
    console.log(`[SCENE_SERVICE] Completing round ${completedRoundNumber} and starting round ${nextRoundNumber} for scene ${sceneId}`);

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
      console.log(`[SCENE_SERVICE] ✓ Marked round ${completedRoundNumber} as completed (changes=${result.changes})`);
    } else {
      const result = db.prepare(`
        INSERT INTO SceneRounds (
          sceneId, roundNumber, status, activeCharacters, roundCompletedAt
        ) VALUES (?, ?, 'completed', ?, CURRENT_TIMESTAMP)
      `).run(sceneId, completedRoundNumber, JSON.stringify(activeCharacters));
      console.log(`[SCENE_SERVICE] ✓ Created completed round record for round ${completedRoundNumber}`);
    }
    
    // 2. Increment currentRoundNumber in Scenes table (THIS IS THE AUTHORITY)
    const updateResult = db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?')
      .run(nextRoundNumber, sceneId);
    console.log(`[SCENE_SERVICE] ✓ Incremented Scenes.currentRoundNumber to ${nextRoundNumber} (changes=${updateResult.changes})`);

    // 3. Create a NEW round record for the next round (in-progress status)
    const newRoundResult = db.prepare(`
      INSERT INTO SceneRounds (
        sceneId, roundNumber, status, activeCharacters
      ) VALUES (?, ?, 'in-progress', '[]')
    `).run(sceneId, nextRoundNumber);
    console.log(`[SCENE_SERVICE] ✓ Created new round record for round ${nextRoundNumber}`);

    // Verify the state
    const verified = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    console.log(`[SCENE_SERVICE] ✓ VERIFICATION: Scene ${sceneId} currentRoundNumber=${verified?.currentRoundNumber} (expected ${nextRoundNumber})`);

    return nextRoundNumber;
  },

  // Task 3.4: Get round metadata
  getRoundData(sceneId: number, roundNumber: number): any {
    return db.prepare(
      'SELECT * FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneId, roundNumber) || null;
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
