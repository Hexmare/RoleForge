/**
 * Memory Retriever - Query vector memories for agent context injection
 * Phase 3 utility: Retrieves relevant memories before agent execution
 */

import { VectorStoreFactory } from './vectorStoreFactory.js';
import { VectorStoreInterface, MemoryEntry } from '../interfaces/VectorStoreInterface.js';

export interface RetrievedMemory {
  text: string;
  similarity: number;
  characterName: string;
  scope: string;
}

export interface MemoryRetrievalOptions {
  worldId: number;
  characterName?: string;
  topK?: number;
  minSimilarity?: number;
  includeMultiCharacter?: boolean;
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
        await this.initialize();
      }

      if (!this.vectorStore) {
        console.warn('[MEMORY_RETRIEVER] Vector store unavailable, returning empty memories');
        return [];
      }

      const topK = options.topK || 5;
      const minSimilarity = options.minSimilarity ?? 0.3;
      const memories: RetrievedMemory[] = [];

      // Query character-specific memories if characterName provided
      if (options.characterName) {
        const scope = `world_${options.worldId}_char_${options.characterName}`;
        try {
          const results = await this.vectorStore.query(query, scope, topK, minSimilarity);
          
          for (const entry of results) {
            memories.push({
              text: entry.text,
              similarity: entry.similarity || 0,
              characterName: options.characterName,
              scope,
            });
          }

          console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} memories for ${options.characterName} in world ${options.worldId}`);
        } catch (error) {
          console.warn(`[MEMORY_RETRIEVER] Query failed for character ${options.characterName}:`, error);
        }
      }

      // Optionally query multi-character scope for context
      if (options.includeMultiCharacter) {
        const multiScope = `world_${options.worldId}_multi`;
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

          console.log(`[MEMORY_RETRIEVER] Retrieved ${results.length} shared memories for world ${options.worldId}`);
        } catch (error) {
          console.warn(`[MEMORY_RETRIEVER] Query failed for shared memories:`, error);
        }
      }

      // Sort by similarity descending
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
      formatted += `- [${confidence}%] ${memory.text}\n`;
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
