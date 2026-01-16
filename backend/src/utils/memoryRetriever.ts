/**
 * Memory Retriever - Query vector memories for agent context injection
 * Phase 3 utility: Retrieves relevant memories before agent execution
 */

import { VectorStoreFactory } from './vectorStoreFactory.js';
import { VectorStoreInterface, MemoryEntry } from '../interfaces/VectorStoreInterface.js';
import { ConfigManager } from '../configManager.js';

export interface RetrievedMemory {
  text: string;
  similarity: number;
  characterName: string;
  scope: string;
  metadata?: Record<string, any>;
}

export interface MemoryRetrievalOptions {
  worldId: number;
  characterName?: string;
  characterId?: string;
  topK?: number;
  minSimilarity?: number;
  includeMultiCharacter?: boolean;
  // Optional per-query overrides
  temporalDecay?: any;
  conditionalRules?: any[];
}

export class MemoryRetriever {
  private vectorStore: VectorStoreInterface | null = null;

  /**
   * Initialize the memory retriever with a vector store instance
   */
  async initialize(): Promise<void> {
    try {
      this.vectorStore = VectorStoreFactory.getVectorStore();
      if (!this.vectorStore) {
        this.vectorStore = VectorStoreFactory.createVectorStore('vectra');
      }
      console.log('[MEMORY_RETRIEVER] Initialized with vector store');
    } catch (error) {
      console.warn('[MEMORY_RETRIEVER] Failed to initialize vector store:', error);
      this.vectorStore = null;
    }
  }

  /**
   * Query memories for a character based on input context
   * @param query - The query text (user input, action, etc)
   * @param options - Retrieval options (worldId, characterName, etc)
   * @returns Array of retrieved memories sorted by similarity
   */
  async queryMemories(query: string, options: MemoryRetrievalOptions): Promise<RetrievedMemory[]> {
    try {
      // Validate vector store availability
      if (!this.vectorStore) {
        console.log('[MEMORY_RETRIEVER] Vector store not initialized, initializing now...');
        await this.initialize();
      }

      if (!this.vectorStore) {
        console.warn('[MEMORY_RETRIEVER] Vector store unavailable after init, returning empty memories');
        return [];
      }

      const topK = options.topK || 5;
      const minSimilarity = options.minSimilarity ?? 0.3;
      const memories: RetrievedMemory[] = [];

      // If specific worldId and character (ID or name) provided, query just that scope
      const charId = options.characterId || options.characterName;
      console.log(`[MEMORY_RETRIEVER] queryMemories called with:`, { 
        charId, 
        worldId: options.worldId, 
        characterId: options.characterId,
        characterName: options.characterName,
        conditionCheck: options.worldId && charId
      });
      
      if (options.worldId && charId) {
        const scope = `world_${options.worldId}_char_${charId}`;
        console.log(`[MEMORY_RETRIEVER] Querying specific scope: ${scope}, query length: ${query.length}, topK: ${topK}, minSimilarity: ${minSimilarity}`);
        try {
          const results = await this.vectorStore.query(query, scope, topK, minSimilarity);
          console.log(`[MEMORY_RETRIEVER] Query returned ${results.length} results for scope ${scope}`);
          
          for (const entry of results) {
            memories.push({
              text: entry.text,
              similarity: entry.similarity || 0,
              characterName: options.characterName || options.characterId || 'unknown',
              scope,
              metadata: entry.metadata || {}
            });
          }

          console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} memories for character ${charId} in world ${options.worldId}`);
        } catch (error) {
          console.warn(`[MEMORY_RETRIEVER] Query failed for scope ${scope}:`, error);
        }
      } else if (options.worldId && !charId) {
        
        // Get all characters from database
        try {
          const { CharacterService } = await import('../services/CharacterService.js');
          const allCharacters = CharacterService.getAllCharacters();
          
          for (const char of allCharacters) {
            const scope = `world_${options.worldId}_char_${char.id || char.name}`;
            try {
              const results = await this.vectorStore.query(query, scope, topK, minSimilarity);
              
              for (const entry of results) {
                memories.push({
                  text: entry.text,
                  similarity: entry.similarity || 0,
                  characterName: char.name || 'unknown',
                  scope,
                  metadata: entry.metadata || {}
                });
              }
              
              if (results.length > 0) {
                console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} memories for ${char.name} in world ${options.worldId}`);
              }
            } catch (error) {
              // Scope might not exist yet, skip it
              console.debug(`[MEMORY_RETRIEVER] No memories for ${char.name} in world ${options.worldId}`);
            }
          }
        } catch (error) {
          console.warn(`[MEMORY_RETRIEVER] Failed to query characters in world ${options.worldId}:`, error);
        }
      } else if (!options.worldId && !options.characterName) {
        // Query all worlds and all characters
        console.log('[MEMORY_RETRIEVER] Querying all worlds and characters');
        
        try {
          const { WorldService } = await import('../services/WorldService.js');
          const { CharacterService } = await import('../services/CharacterService.js');
          const allWorlds = WorldService.getAll();
          const allCharacters = CharacterService.getAllCharacters();
          
          for (const world of allWorlds) {
            for (const char of allCharacters) {
              const scope = `world_${world.id}_char_${char.id || char.name}`;
              try {
                const results = await this.vectorStore.query(query, scope, topK, minSimilarity);
                
                for (const entry of results) {
                  memories.push({
                    text: entry.text,
                    similarity: entry.similarity || 0,
                    characterName: char.name || 'unknown',
                    scope,
                    metadata: entry.metadata || {}
                  });
                }
                
                if (results.length > 0) {
                  console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} memories for ${char.name} in world ${world.id}`);
                }
              } catch (error) {
                // Scope might not exist yet, skip it
              }
            }
          }
        } catch (error) {
          console.warn('[MEMORY_RETRIEVER] Failed to query all worlds/characters:', error);
        }
      }

      // Optionally query multi-character scope for context
      if (options.includeMultiCharacter) {
        if (options.worldId) {
          const multiScope = `world_${options.worldId}_multi`;
          try {
            const results = await this.vectorStore.query(query, multiScope, 3, minSimilarity);
            
            for (const entry of results) {
              memories.push({
                text: entry.text,
                similarity: entry.similarity || 0,
                characterName: 'shared',
                scope: multiScope,
                metadata: entry.metadata || {}
              });
            }

            console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} shared memories for world ${options.worldId}`);
          } catch (error) {
            console.warn(`[MEMORY_RETRIEVER] Query failed for shared memories:`, error);
          }
        } else {
          // Query all multi-character scopes
          try {
            const { WorldService } = await import('../services/WorldService.js');
            const allWorlds = WorldService.getAll();
            
            for (const world of allWorlds) {
              const multiScope = `world_${world.id}_multi`;
              try {
                const results = await this.vectorStore.query(query, multiScope, 3, minSimilarity);
                
                for (const entry of results) {
                  memories.push({
                    text: entry.text,
                    similarity: entry.similarity || 0,
                    characterName: 'shared',
                    scope: multiScope,
                  });
                }
              } catch (error) {
                // Scope might not exist yet, skip it
              }
            }

            console.log('[MEMORY_RETRIEVER] Queried shared memories across all worlds');
          } catch (error) {
            console.warn('[MEMORY_RETRIEVER] Query failed for all shared memories:', error);
          }
        }
      }

      // Apply temporal decay and conditional rule boosts before final sorting
      try {
        const cfgMgr = new ConfigManager();
        const vectorCfg = cfgMgr.getVectorConfig() || {};
        const decayCfg = options.temporalDecay ?? vectorCfg.temporalDecay ?? { enabled: false };
        const rules = options.conditionalRules ?? vectorCfg.conditionalRules ?? [];

        for (const mem of memories) {
          let score = mem.similarity || 0;

          // Temporal decay
          try {
            if (decayCfg && decayCfg.enabled && !(mem.metadata && mem.metadata.temporalBlind)) {
              const ts = mem.metadata && (mem.metadata.timestamp || mem.metadata.stored_at);
              if (ts) {
                const created = Date.parse(ts);
                if (!isNaN(created)) {
                  const ageMs = Date.now() - created;
                  // Interpret halfLife as days for time mode
                  const halfLifeDays = (decayCfg.halfLife && Number(decayCfg.halfLife)) || 7;
                  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
                  const rawFactor = Math.pow(0.5, ageMs / Math.max(1, halfLifeMs));
                  const floor = (decayCfg.floor !== undefined) ? Number(decayCfg.floor) : 0.3;
                  const decayFactor = Math.max(rawFactor, floor);
                  score = score * decayFactor;
                }
              }
            }
          } catch (e) {
            // ignore decay errors
          }

          // Conditional rules boosting
          try {
            let boostMultiplier = 1;
            for (const rule of rules) {
              try {
                const field = rule.field;
                const matchVal = rule.match;
                const boost = Number(rule.boost) || 1;
                const matchType = rule.matchType || 'substring';
                // Resolve nested field from metadata (e.g., 'metadata.keywords' or 'keywords')
                const parts = field.split('.');
                let target: any = mem.metadata || {};
                for (const p of parts) {
                  if (target == null) break;
                  target = target[p];
                }
                if (target == null) continue;
                const targetStr = String(target).toLowerCase();
                const mStr = String(matchVal).toLowerCase();
                let matched = false;
                if (matchType === 'exact') {
                  matched = targetStr === mStr;
                } else {
                  matched = targetStr.includes(mStr);
                }
                if (matched) boostMultiplier *= boost;
              } catch (_) {
                // ignore rule errors
              }
            }
            score = score * boostMultiplier;
          } catch (e) {
            // ignore boosting errors
          }

          // Overwrite similarity with adjusted score for downstream consumers
          mem.similarity = score;
        }
      } catch (e) {
        console.warn('[MEMORY_RETRIEVER] Failed to apply decay/rules:', e);
      }

      // Sort by adjusted similarity descending
      memories.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

      return memories.slice(0, topK);
    } catch (error) {
      console.error('[MEMORY_RETRIEVER] Unexpected error in queryMemories:', error);
      return [];
    }
  }

  /**
   * Format retrieved memories into a readable string for prompt injection
   * @param memories - Retrieved memory entries
   * @returns Formatted memory context string for templates
   */
  formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
    if (memories.length === 0) {
      return '';
    }

    let formatted = '## Relevant Memories\n';

    for (const memory of memories) {
      const confidence = Math.round((memory.similarity || 0) * 100);
      // Extract just the message content, stripping metadata prefix like "Round N (chars): "
      let messageContent = memory.text;
      const colonIndex = messageContent.indexOf(': ');
      if (colonIndex !== -1) {
        // Find the last ": " to get past all the prefixes, then extract the actual message
        const parts = messageContent.split(': ');
        if (parts.length > 1) {
          messageContent = parts.slice(1).join(': ');
        }
      }
      formatted += `- [${confidence}%] ${messageContent}\n`;
    }

    return formatted;
  }

  /**
   * Get vector store statistics
   */
  async getStats(): Promise<Record<string, any>> {
    try {
      if (!this.vectorStore) {
        await this.initialize();
      }

      if (!this.vectorStore) {
        return { status: 'unavailable' };
      }

      // For now, return a simple status
      // In the future, this could query scopes and provide detailed stats
      return { 
        status: 'available',
        note: 'Detailed stats available via VectraVectorStore implementation'
      };
    } catch (error) {
      console.warn('[MEMORY_RETRIEVER] Failed to get stats:', error);
      return { status: 'error', error: String(error) };
    }
  }
}

// Export singleton instance
let retrieverInstance: MemoryRetriever | null = null;

/**
 * Get or create singleton MemoryRetriever instance
 */
export function getMemoryRetriever(): MemoryRetriever {
  if (!retrieverInstance) {
    retrieverInstance = new MemoryRetriever();
  }
  return retrieverInstance;
}

/**
 * Initialize the singleton instance
 */
export async function initializeMemoryRetriever(): Promise<void> {
  const retriever = getMemoryRetriever();
  await retriever.initialize();
}
