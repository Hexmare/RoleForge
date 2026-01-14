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
      for (const characterName of activeCharacters) {
        try {
          const world = worldState?.name || 'unknown';
          const worldId = worldState?.id || 0;
          
          // Create memory scope: world_{worldId}_char_{characterName}
          const scope = `world_${worldId}_char_${characterName}`;
          
          // Create unique memory ID
          const memoryId = `round_${roundNumber}_${characterName}_${Date.now()}`;

          // Metadata for the memory
          const metadata = {
            roundNumber,
            sceneId,
            characterName,
            worldName: world,
            actors: activeCharacters,
            timestamp: new Date().toISOString(),
            type: 'round_memory'
          };

          // Store memory in vector database
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

        // Extract speaker name (could be character name or role like "narrator")
        const speaker = msg.characterName || msg.speaker || msg.role || 'narrator';
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
}

export default VectorizationAgent;
