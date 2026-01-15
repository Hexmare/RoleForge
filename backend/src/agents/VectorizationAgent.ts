/**
 * VectorizationAgent - Captures and stores memories from completed rounds
 * Triggered after each round completes via Orchestrator.completeRound()
 * 
 * Responsibilities:
 * 1. Extract messages from completed round
 * 2. Store memories for each active character
 * 3. Use vector store interface for provider flexibility
 * 4. Silent error fallback (don't interrupt roleplay)
 */

import { BaseAgent, AgentContext } from './BaseAgent.js';
import VectorStoreFactory from '../utils/vectorStoreFactory.js';
import { VectorStoreInterface } from '../interfaces/VectorStoreInterface.js';
import EmbeddingManager from '../utils/embeddingManager.js';

export interface VectorizationContext extends AgentContext {
  roundNumber?: number;
  sceneId?: number;
  messages?: any[];
  activeCharacters?: string[];
}

export class VectorizationAgent extends BaseAgent {
  private vectorStore: VectorStoreInterface;
  private embeddingManager: EmbeddingManager;

  constructor(configManager: any, env: any) {
    super('vectorization', configManager, env);
    
    // Initialize vector store (uses default provider 'vectra')
    this.vectorStore = VectorStoreFactory.createVectorStore('vectra');
    this.embeddingManager = EmbeddingManager.getInstance();
  }

  /**
   * Hook to personalize memory text per-character before storage.
   * Default implementation is pass-through; override for custom behavior.
   */
  protected async personalizeMemory(text: string, characterId: string, context?: any): Promise<string> {
    // Placeholder for per-character personalization (e.g., pronouns, perspective)
    return text;
  }

  /**
   * Main entry point for vectorization
   * Called by Orchestrator.completeRound() after each round completes
   * 
   * Does NOT throw - silently logs errors and continues
   * This ensures memory capture doesn't block roleplay
   */
  async run(context: VectorizationContext): Promise<string> {
    try {
      const { sceneId, roundNumber, messages, activeCharacters, worldState } = context;

      if (!sceneId || !roundNumber) {
        console.warn('[VECTORIZATION] Missing sceneId or roundNumber, skipping vectorization');
        return 'skipped';
      }

      if (!messages || messages.length === 0) {
        console.log(`[VECTORIZATION] No messages in round ${roundNumber}, skipping`);
        return 'skipped';
      }

      if (!activeCharacters || activeCharacters.length === 0) {
        console.log(`[VECTORIZATION] No active characters in round ${roundNumber}, skipping`);
        return 'skipped';
      }

      console.log(
        `[VECTORIZATION] Vectorizing round ${roundNumber} for scene ${sceneId} with characters: ${activeCharacters.join(', ')}`
      );

      // Ensure embedding manager is initialized
      await this.embeddingManager.initialize();

      // Summarize round into a memory snippet
      const memorySnippet = this.summarizeRoundMessages(messages, activeCharacters, roundNumber);

      if (!memorySnippet || memorySnippet.trim().length === 0) {
        console.log(`[VECTORIZATION] Empty memory snippet for round ${roundNumber}, skipping storage`);
        return 'skipped';
      }

      // Store memory for each active character
      let successCount = 0;
      
      // Get scene/world and higher-level metadata
      let worldId = 0;
      let campaignId: string | undefined;
      let arcId: string | undefined;
      let sceneName: string | undefined;
      try {
        const SceneService = (await import('../services/SceneService.js')).default;
        const scene = SceneService.getById(sceneId);
        worldId = SceneService.getWorldIdFromSceneId(sceneId);
        if (scene) {
          campaignId = scene.campaignId !== undefined ? String(scene.campaignId) : undefined;
          arcId = scene.arcId !== undefined ? String(scene.arcId) : undefined;
          sceneName = scene.name;
        }
      } catch (error) {
        console.error(`[VECTORIZATION] Failed to get scene/world metadata for sceneId ${sceneId}:`, error);
        return 'error';
      }

      for (const char of activeCharacters) {
        try {
          const world = worldState?.name || 'unknown';

          // Character may be a string (name) or an object { id, name }
          let characterId: string;
          let characterName: string;
          if (typeof char === 'string') {
            characterId = String(char);
            characterName = String(char);
          } else if (char && typeof char === 'object') {
            characterId = char.id ? String(char.id) : (char.name ? String(char.name) : `unknown_${Date.now()}`);
            characterName = char.name ? String(char.name) : characterId;
          } else {
            characterId = `unknown_${Date.now()}`;
            characterName = 'unknown';
          }

          // Create memory scope: world_{worldId}_char_{characterId}
          const scope = `world_${worldId}_char_${characterId}`;

          // Create unique memory ID
          const memoryId = `round_${roundNumber}_${characterId}_${Date.now()}`;

          // Metadata for the memory (canonicalized to strings where applicable)
          const metadata: Record<string, any> = {
            roundId: String(roundNumber),
            roundNumber,
            sceneId: String(sceneId),
            sceneName,
            characterId,
            characterName,
            worldName: world,
            actors: activeCharacters,
            timestamp: new Date().toISOString(),
            type: 'round_memory'
          };
          if (campaignId) metadata.campaignId = campaignId;
          if (arcId) metadata.arcId = arcId;

          // Store FULL round memory for this character (all speakers, all messages)
          // Character needs context of what OTHERS said too, not just their own lines
          await this.vectorStore.addMemory(memoryId, memorySnippet, metadata, scope);
          successCount++;

          console.log(
            `[VECTORIZATION] Stored memory ${memoryId} for character ${characterName} in scope ${scope}`
          );
        } catch (error) {
          console.error(
            `[VECTORIZATION] Failed to store memory for character ${characterName}:`,
            error
          );
          // Continue with next character - don't fail entire round
        }
      }

      console.log(
        `[VECTORIZATION] Round ${roundNumber} vectorization complete: stored ${successCount}/${activeCharacters.length} character memories`
      );

      return 'complete';
    } catch (error) {
      // Silent fallback - log but don't throw
      console.warn('[VECTORIZATION] Vectorization error (non-blocking):', error);
      return 'error';
    }
  }

  /**
   * Summarize round messages into a concise memory snippet
   * Extracts key events, dialogue, and state changes
   * 
   * @param messages - Array of message objects from the round
   * @param activeCharacters - Characters that participated
   * @param roundNumber - Round number for context
   * @returns Concise summary suitable for embedding
   */
  private summarizeRoundMessages(
    messages: any[],
    activeCharacters: string[],
    roundNumber: number
  ): string {
    try {
      // Extract speaker and content from messages
      const events: string[] = [];

      for (const msg of messages) {
        if (!msg) continue;

        // Extract speaker name - try multiple fields to get actual character name/sender
        // Priority: characterName > sender > speaker > role (fallback to 'narrator' only if truly unknown)
        let speaker = msg.characterName || msg.sender || msg.speaker || msg.role || '';
        
        // If still empty, try other possible field names
        if (!speaker) {
          speaker = msg.senderName || msg.character || msg.from || 'narrator';
        }
        
        const content = msg.content || msg.message || '';

        if (!content || content.trim().length === 0) continue;

        // Format as "Speaker: content"
        const truncated = content.length > 150 ? content.substring(0, 150) + '...' : content;
        events.push(`${speaker}: ${truncated}`);
      }

      if (events.length === 0) {
        return '';
      }

      // Combine into a memory snippet
      // Keep it concise - embeddings work better with focused context
      const snippet = events.join(' | ');
      const characters = activeCharacters.join(', ');

      // Format: "Round N: Character1, Character2: [events]"
      // This provides context for both semantic search and readability
      const memory = `Round ${roundNumber} (${characters}): ${snippet}`;

      return memory;
    } catch (error) {
      console.error('[VECTORIZATION] Error summarizing round messages:', error);
      return '';
    }
  }

  /**
   * Get vectorization statistics
   * Useful for monitoring memory storage health
   */
  async getStats(): Promise<any> {
    try {
      return await (this.vectorStore as any).getStats();
    } catch (error) {
      console.error('[VECTORIZATION] Failed to get stats:', error);
      return { error: 'Failed to get stats' };
    }
  }

  /**
   * Revectorize an entire scene - regenerates embeddings for all messages
   * Algorithm:
   * 1. Get worldId from sceneId
   * 2. Clear existing vectors for the scene
   * 3. Query SceneRounds filtered by sceneId
   * 4. For each round, get active characters and messages
   * 5. Summarize and vectorize messages for each character
   * 
   * @param sceneId - The scene to revectorize
   * @param clearExisting - Whether to clear existing vectors first (default: true)
   * @returns Statistics about the revectorization
   */
  async revectorizeScene(sceneId: number, clearExisting: boolean = true): Promise<any> {
    try {
      console.log(`[VECTORIZATION] Starting scene revectorization for sceneId ${sceneId}`);

      // Import services
      const SceneService = (await import('../services/SceneService.js')).default;
      const MessageService = (await import('../services/MessageService.js')).default;
      const db = (await import('../database.js')).default;
      
      // Get scene details
      const scene = SceneService.getById(sceneId);
      if (!scene) {
        return { error: 'Scene not found', sceneId };
      }

      // Get worldId
      const worldId = SceneService.getWorldIdFromSceneId(sceneId);

      // Step 1: Query SceneRounds filtered by sceneId to get all rounds and their active characters
      const sceneRoundsStmt = db.prepare('SELECT * FROM SceneRounds WHERE sceneId = ? ORDER BY roundNumber ASC');
      const sceneRounds = sceneRoundsStmt.all(sceneId) as any[];

      if (!sceneRounds || sceneRounds.length === 0) {
        console.log(`[VECTORIZATION] No scene rounds found for scene ${sceneId}`);
        return { 
          sceneId,
          worldId,
          messagesProcessed: 0,
          roundsProcessed: 0,
          memoriesStored: 0,
          status: 'no_rounds'
        };
      }

      // Collect all characters across all rounds for clearing
      const allCharactersSet = new Set<string>();
      for (const round of sceneRounds) {
        try {
          const activeChars = JSON.parse(round.activeCharacters);
          if (Array.isArray(activeChars)) {
            activeChars.forEach((char: string) => allCharactersSet.add(char));
          }
        } catch (e) {
          console.warn(`[VECTORIZATION] Failed to parse activeCharacters for round ${round.roundNumber}:`, e);
        }
      }

      // Step 2: Clear existing vectors if requested
      if (clearExisting) {
        console.log(`[VECTORIZATION] Clearing existing vectors for scene ${sceneId}`);
        for (const character of Array.from(allCharactersSet)) {
          const scope = `world_${worldId}_char_${character}`;
          try {
            // Get count before clearing
            const countBefore = await (this.vectorStore as any).getMemoryCount(scope);
            // Clear the scope
            await this.vectorStore.clear(scope);
            console.log(`[VECTORIZATION] Cleared ${countBefore} memories from scope ${scope}`);
          } catch (error) {
            console.warn(`[VECTORIZATION] Failed to clear scope ${scope}:`, error);
          }
        }
      }

      // Ensure embedding manager is initialized
      await this.embeddingManager.initialize();

      // Step 3: Iterate through each round, get messages and active characters
      let totalMessagesProcessed = 0;
      let totalMemoriesStored = 0;

      for (const sceneRound of sceneRounds) {
        try {
          const roundNumber = sceneRound.roundNumber;
          console.log(`[VECTORIZATION] Processing round ${roundNumber} for scene ${sceneId}`);

          // Parse active characters for this round
          let activeCharacters: string[] = [];
          try {
            const parsed = JSON.parse(sceneRound.activeCharacters);
            activeCharacters = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.warn(`[VECTORIZATION] Failed to parse activeCharacters for round ${roundNumber}`);
            continue;
          }

          if (activeCharacters.length === 0) {
            console.log(`[VECTORIZATION] No active characters for round ${roundNumber}, skipping`);
            continue;
          }

          // Step 4: Retrieve messages for this sceneId and roundNumber
          const roundMessages = MessageService.getRoundMessages(sceneId, roundNumber) || [];
          
          if (roundMessages.length === 0) {
            console.log(`[VECTORIZATION] No messages found for scene ${sceneId} round ${roundNumber}`);
            continue;
          }

          totalMessagesProcessed += roundMessages.length;

          // Summarize the round
          const memorySnippet = this.summarizeRoundMessages(roundMessages, activeCharacters, roundNumber);

          if (!memorySnippet || memorySnippet.trim().length === 0) {
            console.log(`[VECTORIZATION] Empty memory snippet for round ${roundNumber}, skipping storage`);
            continue;
          }

          // Step 5: Store vectorized memory for each active character
          for (const characterName of activeCharacters) {
            try {
              const scope = `world_${worldId}_char_${characterName}`;
              const memoryId = `revectorize_round_${roundNumber}_${characterName}_${Date.now()}`;

              const metadata = {
                roundNumber,
                sceneId,
                characterName,
                worldName: scene.name || 'unknown',
                actors: activeCharacters,
                timestamp: new Date().toISOString(),
                type: 'round_memory'
              };

              await this.vectorStore.addMemory(memoryId, memorySnippet, metadata, scope);
              totalMemoriesStored++;

              console.log(
                `[VECTORIZATION] Stored revectorized memory ${memoryId} for character ${characterName} in round ${roundNumber}`
              );
            } catch (error) {
              console.error(
                `[VECTORIZATION] Failed to store revectorized memory for character ${characterName} in round ${roundNumber}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(`[VECTORIZATION] Failed to process round ${sceneRound.roundNumber}:`, error);
        }
      }

      console.log(
        `[VECTORIZATION] Scene ${sceneId} revectorization complete: ${sceneRounds.length} rounds, ${totalMessagesProcessed} messages, ${totalMemoriesStored} memories stored`
      );

      return {
        sceneId,
        worldId,
        roundsProcessed: sceneRounds.length,
        messagesProcessed: totalMessagesProcessed,
        memoriesStored: totalMemoriesStored,
        status: 'complete'
      };
    } catch (error) {
      console.error('[VECTORIZATION] Scene revectorization failed:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        sceneId,
        status: 'error'
      };
    }
  }
}

export default VectorizationAgent;
