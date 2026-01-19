/**
 * Memory Retriever - Query vector memories for agent context injection
 * Phase 3 utility: Retrieves relevant memories before agent execution
 */

import { VectorStoreFactory } from './vectorStoreFactory.js';
import { VectorStoreInterface, MemoryEntry } from '../interfaces/VectorStoreInterface.js';
import { ConfigManager } from '../configManager.js';
import { computeDecayAdjustedScore, applyConditionalBoost, formatMemoriesForPrompt } from './memoryHelpers.js';
import { createLogger, NAMESPACES } from '../logging';

// Helper functions moved to `memoryHelpers.ts` for reusability and testability

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

  private readonly memoryRetrieverLog = createLogger(NAMESPACES.utils.memory);
  private readonly MAX_TOPK_DEFAULT = 12;
  private readonly MAX_QUERY_CHARS_DEFAULT = 2000;

  /**
   * Initialize the memory retriever with a vector store instance
   */
  async initialize(): Promise<void> {
    try {
      this.vectorStore = VectorStoreFactory.getVectorStore();
      if (!this.vectorStore) {
        this.vectorStore = VectorStoreFactory.createVectorStore('vectra');
      }
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] Initialized with vector store');
    } catch (error) {
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] Failed to initialize vector store: %o', error);
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
        this.memoryRetrieverLog('[MEMORY_RETRIEVER] Vector store not initialized, initializing now...');
        await this.initialize();
      }

      if (!this.vectorStore) {
        this.memoryRetrieverLog('[MEMORY_RETRIEVER] Vector store unavailable after init, returning empty memories');
        return [];
      }

      const vectorCfg = new ConfigManager().getVectorConfig() || {};
      const caps = vectorCfg.memoryCaps || {};
      const maxTopK = Math.max(1, caps.maxTopK || this.MAX_TOPK_DEFAULT);
      const maxQueryChars = Math.max(1, caps.maxQueryChars || this.MAX_QUERY_CHARS_DEFAULT);
      const cappedQuery = (query || '').slice(0, maxQueryChars);
      const requestedTopK = options.topK || 5;
      const topK = Math.max(1, Math.min(requestedTopK, maxTopK));
      const minSimilarity = options.minSimilarity ?? 0.3;
      const memories: RetrievedMemory[] = [];

      // If specific worldId and character (ID or name) provided, query just that scope
      const charId = options.characterId || options.characterName;
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] queryMemories called with: %o', { 
        charId, 
        worldId: options.worldId, 
        characterId: options.characterId,
        characterName: options.characterName,
        conditionCheck: options.worldId && charId
      });
      
      if (options.worldId && charId) {
        const scope = `world_${options.worldId}_char_${charId}`;
        this.memoryRetrieverLog('[MEMORY_RETRIEVER] Querying specific scope: %s, query length: %d, topK: %d (requested %d), minSimilarity: %s', scope, cappedQuery.length, topK, requestedTopK, minSimilarity);
        try {
          const results = await this.vectorStore.query(cappedQuery, scope, topK, minSimilarity);
          this.memoryRetrieverLog('[MEMORY_RETRIEVER] Query returned %d results for scope %s', results.length, scope);
          
          for (const entry of results) {
            memories.push({
              text: entry.text,
              similarity: entry.similarity || 0,
              characterName: options.characterName || options.characterId || 'unknown',
              scope,
              metadata: entry.metadata || {}
            });
          }

          this.memoryRetrieverLog('[MEMORY_RETRIEVER] Retrieved %d memories for character %s in world %d', results.length, charId, options.worldId);
        } catch (error) {
          this.memoryRetrieverLog('[MEMORY_RETRIEVER] Query failed for scope %s: %o', scope, error);
        }
      } else if (options.worldId && !charId) {
        
        // Get all characters from database
        try {
          const { CharacterService } = await import('../services/CharacterService.js');
          const allCharacters = CharacterService.getAllCharacters();
          
          for (const char of allCharacters) {
            const charIdVal = (typeof char === 'string') ? String(char) : (char && (char.id ? String(char.id) : (char.name ? String(char.name) : String(char))));
            const scope = `world_${options.worldId}_char_${charIdVal}`;
            try {
              const results = await this.vectorStore.query(cappedQuery, scope, topK, minSimilarity);
              
              for (const entry of results) {
                memories.push({
                  text: entry.text,
                  similarity: entry.similarity || 0,
                  characterName: char.name || charIdVal || 'unknown',
                  scope,
                  metadata: entry.metadata || {}
                });
              }
              
              if (results.length > 0) {
                this.memoryRetrieverLog('[MEMORY_RETRIEVER] Retrieved %d memories for %s in world %d', results.length, char.name || charIdVal, options.worldId);
              }
              } catch (error) {
                // Scope might not exist yet, skip it
                this.memoryRetrieverLog('[MEMORY_RETRIEVER] No memories for %s in world %d', char.name || charIdVal, options.worldId);
              }
          }
        } catch (error) {
          this.memoryRetrieverLog('[MEMORY_RETRIEVER] Failed to query characters in world %d: %o', options.worldId, error);
        }
      } else if (!options.worldId && !options.characterName) {
        // Query all worlds and all characters
        this.memoryRetrieverLog('[MEMORY_RETRIEVER] Querying all worlds and characters');
        
        try {
          const { WorldService } = await import('../services/WorldService.js');
          const { CharacterService } = await import('../services/CharacterService.js');
          const allWorlds = WorldService.getAll();
          const allCharacters = CharacterService.getAllCharacters();
          
          for (const world of allWorlds) {
            for (const char of allCharacters) {
              const charIdVal = (typeof char === 'string') ? String(char) : (char && (char.id ? String(char.id) : (char.name ? String(char.name) : String(char))));
              const scope = `world_${world.id}_char_${charIdVal}`;
              try {
                const results = await this.vectorStore.query(cappedQuery, scope, topK, minSimilarity);
                
                for (const entry of results) {
                  memories.push({
                    text: entry.text,
                    similarity: entry.similarity || 0,
                    characterName: char.name || charIdVal || 'unknown',
                    scope,
                    metadata: entry.metadata || {}
                  });
                }
                
                if (results.length > 0) {
                  this.memoryRetrieverLog('[MEMORY_RETRIEVER] Retrieved %d memories for %s in world %d', results.length, char.name || charIdVal, world.id);
                }
              } catch (error) {
                // Scope might not exist yet, skip it
              }
            }
          }
        } catch (error) {
          this.memoryRetrieverLog('[MEMORY_RETRIEVER] Failed to query all worlds/characters: %o', error);
        }
      }

      // Optionally query multi-character scope for context
      if (options.includeMultiCharacter) {
        if (options.worldId) {
          const multiScope = `world_${options.worldId}_multi`;
          try {
            const results = await this.vectorStore.query(cappedQuery, multiScope, Math.min(topK, 3), minSimilarity);
            
            for (const entry of results) {
              memories.push({
                text: entry.text,
                similarity: entry.similarity || 0,
                characterName: 'shared',
                scope: multiScope,
                metadata: entry.metadata || {}
              });
            }

            this.memoryRetrieverLog('[MEMORY_RETRIEVER] Retrieved %d shared memories for world %d', results.length, options.worldId);
          } catch (error) {
            this.memoryRetrieverLog('[MEMORY_RETRIEVER] Query failed for shared memories: %o', error);
          }
        } else {
          // Query all multi-character scopes
          try {
            const { WorldService } = await import('../services/WorldService.js');
            const allWorlds = WorldService.getAll();
            
            for (const world of allWorlds) {
              const multiScope = `world_${world.id}_multi`;
              try {
                const results = await this.vectorStore.query(cappedQuery, multiScope, Math.min(topK, 3), minSimilarity);
                
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

            this.memoryRetrieverLog('[MEMORY_RETRIEVER] Queried shared memories across all worlds');
          } catch (error) {
            this.memoryRetrieverLog('[MEMORY_RETRIEVER] Query failed for all shared memories: %o', error);
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
          try {
            score = await computeDecayAdjustedScore(score, mem.metadata || {}, decayCfg);
          } catch (e) {
            // ignore decay errors
          }

          try {
            score = applyConditionalBoost(score, mem.metadata || {}, rules, { text: mem.text });
          } catch (e) {
            // ignore boosting errors
          }

          mem.similarity = score;
        }
      } catch (e) {
        this.memoryRetrieverLog('[MEMORY_RETRIEVER] Failed to apply decay/rules: %o', e);
      }

      // Sort by adjusted similarity descending
      memories.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

      return memories.slice(0, topK);
    } catch (error) {
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] Unexpected error in queryMemories: %o', error);
      return [];
    }
  }

  /**
   * New convenience API: retrieve by a scope string or options object.
   * Accepts `{ scope: 'world_<id>_char_<id>' }` or the same options as `queryMemories`.
   * Returns raw RetrievedMemory[] without any further formatting.
   */
  async retrieve(opts: { scope?: string; query?: string } & Partial<MemoryRetrievalOptions>): Promise<RetrievedMemory[]> {
    try {
      // If caller passed a scope like 'world_1_char_abc', derive worldId and characterId
      const mergedOpts: MemoryRetrievalOptions = {
        worldId: (opts as any).worldId || 0,
        characterName: (opts as any).characterName,
        characterId: (opts as any).characterId,
        topK: (opts as any).topK || 5,
        minSimilarity: (opts as any).minSimilarity ?? 0.3,
        includeMultiCharacter: (opts as any).includeMultiCharacter,
        temporalDecay: (opts as any).temporalDecay,
        conditionalRules: (opts as any).conditionalRules,
      } as MemoryRetrievalOptions;

      if (opts.scope) {
        const m = opts.scope.match(/^world_(\d+)_char_(.+)$/);
        if (m) {
          mergedOpts.worldId = Number(m[1]);
          mergedOpts.characterId = m[2];
        }
      }

      const queryText = opts.query || '';
      // Delegate to existing queryMemories implementation
      const results = await this.queryMemories(queryText, mergedOpts);
      return results;
    } catch (e) {
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] retrieve() failed: %o', e);
      return [];
    }
  }

  /**
   * Format retrieved memories into a readable string for prompt injection
   * @param memories - Retrieved memory entries
   * @returns Formatted memory context string for templates
   */
  formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
    // Delegate formatting to helper for reuse and easier testing
    try {
      return formatMemoriesForPrompt(memories.map(m => ({ text: m.text, similarity: m.similarity, metadata: m.metadata })));
    } catch (e) {
      return '';
    }
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
      this.memoryRetrieverLog('[MEMORY_RETRIEVER] Failed to get stats: %o', error);
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
