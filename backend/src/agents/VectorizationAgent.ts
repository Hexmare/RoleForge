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
    
    // Load vector config (if available) and wire into store/embedding initialization
    const vcfg = (this.configManager && typeof this.configManager.getVectorConfig === 'function')
      ? this.configManager.getVectorConfig() || {}
      : {};

    const storeProvider: string = vcfg.provider || 'vectra';
    const storeBasePath: string = vcfg.basePath || './vector_data';

    // Initialize vector store with optional provider-specific config
    this.vectorStore = VectorStoreFactory.createVectorStore(storeProvider as any, { basePath: storeBasePath });

    // Initialize embedding manager with configured provider/model
    const embedProvider = vcfg.embeddingProvider || undefined;
    const embedModel = vcfg.embeddingModel || undefined;
    this.embeddingManager = EmbeddingManager.getInstance(embedProvider, embedModel);
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

      // Determine chunking strategy from vector config
      const vcfg = (this.configManager && typeof this.configManager.getVectorConfig === 'function')
        ? this.configManager.getVectorConfig() || {}
        : {};
      const chunkStrategy: string = vcfg.chunkStrategy || 'perRound';
      const chunkSize: number = typeof vcfg.chunkSize === 'number' ? vcfg.chunkSize : 512;
      const slidingWindowOverlap: number = typeof vcfg.slidingWindowOverlap === 'number' ? vcfg.slidingWindowOverlap : 0.2;

      // Build base chunks for this round (may be reused per-character)
      let baseChunks: string[] = [];
      if (chunkStrategy === 'perMessage') {
        baseChunks = (messages || []).map((m: any) => (m && (m.content || m.message || ''))).filter((t: string) => t && t.trim().length > 0);
      } else {
        // perRound and perScene default to summarization + chunking
        baseChunks = EmbeddingManager.chunkText(memorySnippet, chunkSize);
      }
      // Apply simple sliding overlap if requested
      if (slidingWindowOverlap > 0 && baseChunks.length > 1) {
        const overlapChars = Math.max(1, Math.floor(chunkSize * slidingWindowOverlap));
        const overlapped: string[] = [];
        for (let i = 0; i < baseChunks.length; i++) {
          let c = baseChunks[i];
          if (i > 0) {
            const prev = baseChunks[i - 1];
            const add = prev.slice(Math.max(0, prev.length - overlapChars));
            c = add + ' ' + c;
          }
          overlapped.push(c);
        }
        baseChunks = overlapped;
      }
      
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

      for (const char of activeCharacters as any[]) {
        let characterId: string = '';
        let characterName: string = 'unknown';
        try {
          const world = worldState?.name || 'unknown';

          // Character may be a string (name) or an object { id, name }
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

          // Collect message-level IDs when available for traceability
          const messageIds: string[] = [];
          const speakerIds: string[] = [];
          try {
            if (Array.isArray(messages)) {
              for (const m of messages) {
                if (m && (m.id || m.messageId)) messageIds.push(String(m.id || m.messageId));
                const speaker = m && (m.speakerId || m.speaker || m.senderId || m.sender);
                if (speaker) speakerIds.push(String(speaker));
              }
            }
          } catch (_) {
            // swallow errors - optional fields only
          }

          const metadataBase: Record<string, any> = {
            roundId: String(roundNumber),
            roundNumber,
            sceneId: String(sceneId),
            sceneName,
            characterId,
            characterName,
            worldName: world,
            actors: activeCharacters,
            timestamp: new Date().toISOString(),
            type: 'round_memory',
            messageIds: messageIds.length > 0 ? messageIds : undefined,
            speakerIds: speakerIds.length > 0 ? speakerIds : undefined
          } as Record<string, any>;
          if (campaignId) metadataBase.campaignId = campaignId;
          if (arcId) metadataBase.arcId = arcId;

          // Store each chunk for this character
          for (let ci = 0; ci < baseChunks.length; ci++) {
            try {
              const chunkText = String(baseChunks[ci] || '').trim();
              if (!chunkText) continue;

              const memoryIdChunk = `round_${roundNumber}_${characterId}_${ci}_${Date.now()}`;
              const metadata = { ...metadataBase };
              metadata.chunkIndex = ci;
              metadata.chunkCount = baseChunks.length;

              // Personalize per-character if needed
              const toStore = await this.personalizeMemory(chunkText, characterId, { context });

              await this.vectorStore.addMemory(memoryIdChunk, toStore, metadata, scope);
              successCount++;

              console.log(`[VECTORIZATION] Stored memory ${memoryIdChunk} (chunk ${ci + 1}/${baseChunks.length}) for ${characterName} in scope ${scope}`);
            } catch (err) {
              console.error(`[VECTORIZATION] Failed to store chunk ${ci} for ${characterName}:`, err);
            }
          }
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
            // Prefer scoped deletion by metadata (safer than full clear)
            const filter = { sceneId: String(sceneId) };
            await (this.vectorStore as any).deleteByMetadata(filter, scope, { dryRun: false, confirm: true });
            console.log(`[VECTORIZATION] deleteByMetadata invoked for scope ${scope} (sceneId=${sceneId})`);
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

          // Step 5: Store vectorized memory for each active character (chunk-aware)
          const vcfg = (this.configManager && typeof this.configManager.getVectorConfig === 'function')
            ? this.configManager.getVectorConfig() || {}
            : {};
          const chunkStrategy: string = vcfg.chunkStrategy || 'perRound';
          const chunkSize: number = typeof vcfg.chunkSize === 'number' ? vcfg.chunkSize : 512;
          const slidingWindowOverlap: number = typeof vcfg.slidingWindowOverlap === 'number' ? vcfg.slidingWindowOverlap : 0.2;

          let baseChunks: string[] = [];
          if (chunkStrategy === 'perMessage') {
            baseChunks = (roundMessages || []).map((m: any) => (m && (m.content || m.message || ''))).filter((t: string) => t && t.trim().length > 0);
          } else {
            baseChunks = EmbeddingManager.chunkText(memorySnippet, chunkSize);
          }
          if (slidingWindowOverlap > 0 && baseChunks.length > 1) {
            const overlapChars = Math.max(1, Math.floor(chunkSize * slidingWindowOverlap));
            const overlapped: string[] = [];
            for (let i = 0; i < baseChunks.length; i++) {
              let c = baseChunks[i];
              if (i > 0) {
                const prev = baseChunks[i - 1];
                const add = prev.slice(Math.max(0, prev.length - overlapChars));
                c = add + ' ' + c;
              }
              overlapped.push(c);
            }
            baseChunks = overlapped;
          }

          for (const characterName of activeCharacters) {
            try {
              const scope = `world_${worldId}_char_${characterName}`;
              for (let ci = 0; ci < baseChunks.length; ci++) {
                const chunkText = String(baseChunks[ci] || '').trim();
                if (!chunkText) continue;
                const memoryId = `revectorize_round_${roundNumber}_${characterName}_${ci}_${Date.now()}`;
                const metadata = {
                  roundNumber: String(roundNumber),
                  sceneId: String(sceneId),
                  characterName,
                  worldName: scene.name || 'unknown',
                  actors: activeCharacters,
                  timestamp: new Date().toISOString(),
                  type: 'round_memory',
                  chunkIndex: ci,
                  chunkCount: baseChunks.length
                } as Record<string, any>;

                try {
                  const toStore = await this.personalizeMemory(chunkText, characterName, { scene, sceneId, roundNumber, worldId });
                  await this.vectorStore.addMemory(memoryId, toStore, metadata, scope);
                  totalMemoriesStored++;
                  console.log(`[VECTORIZATION] Stored revectorized memory ${memoryId} (chunk ${ci + 1}/${baseChunks.length}) for character ${characterName} in round ${roundNumber}`);
                } catch (err) {
                  console.error(`[VECTORIZATION] Failed to store revectorized chunk ${ci} for ${characterName}:`, err);
                }
              }
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
