/**
 * VectraVectorStore - Implementation of VectorStoreInterface using Vectra
 * Vectra provides local file system storage (indexes as folders)
 */

import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import { VectorStoreInterface, MemoryEntry } from '../interfaces/VectorStoreInterface.js';
import EmbeddingManager from '../utils/embeddingManager.js';

interface StoredMemory {
  id: string;
  text: string;
  metadata?: Record<string, any>;
  vector: number[];
}

export class VectraVectorStore implements VectorStoreInterface {
  private indexes: Map<string, LocalIndex> = new Map();
  private embeddingManager: EmbeddingManager;
  private basePath: string;

  constructor(basePath: string = './vector_data') {
    this.basePath = basePath;
    this.embeddingManager = EmbeddingManager.getInstance();
  }

  /**
   * Initialize a scope (lazy creation on first use)
   * Creates the directory structure if it doesn't exist
   */
  async init(scope: string): Promise<void> {
    if (this.indexes.has(scope)) {
      return; // Already initialized
    }

    try {
      const indexPath = path.join(this.basePath, scope);

      // Ensure base directory AND scope directory exist
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(indexPath, { recursive: true });

      // Initialize Vectra index (it will save to the directory we just created)
      const index = new LocalIndex(indexPath);
      
      // Try to load existing index, or create new one
      try {
        // Vectra's createIndex will create index.json in the path
        await index.createIndex();
      } catch (createError) {
        // If it fails due to existing file, that's OK
        console.log(`[VECTOR_STORE] Index creation note (may already exist):`, createError instanceof Error ? createError.message : String(createError));
      }

      this.indexes.set(scope, index);
      console.log(`[VECTOR_STORE] Initialized scope: ${scope}`);
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to initialize scope ${scope}:`, error);
      throw new Error(`Failed to initialize vector store scope ${scope}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Helper: Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Add a memory item with embedding
   * Lazily initializes scope if needed
   */
  async addMemory(
    id: string,
    text: string,
    metadata?: Record<string, any>,
    scope?: string
  ): Promise<void> {
    if (!scope) {
      throw new Error('Scope is required for adding memory');
    }

    try {
      // Ensure scope is initialized
      if (!this.indexes.has(scope)) {
        await this.init(scope);
      }

      const index = this.indexes.get(scope);
      if (!index) {
        throw new Error(`Scope ${scope} not found after initialization`);
      }

      // Generate embedding
      const vector = await this.embeddingManager.embedText(text);

      // Before inserting, make sure directory exists (defensive)
      const indexPath = path.join(this.basePath, scope);
      await fs.mkdir(indexPath, { recursive: true });

      // Try to insert item
      try {
        await index.insertItem({
          id,
          vector,
          metadata: {
            text,
            ...metadata,
            stored_at: new Date().toISOString()
          }
        });
      } catch (insertError) {
        // If insertItem fails due to "Index does not exist", try creating the index
        const errMsg = insertError instanceof Error ? insertError.message : String(insertError);
        if (errMsg.includes('does not exist') || errMsg.includes('Index')) {
          console.log(`[VECTOR_STORE] Index creation needed, attempting to create for scope: ${scope}`);
          try {
            await index.createIndex();
            // Retry the insertion
            await index.insertItem({
              id,
              vector,
              metadata: {
                text,
                ...metadata,
                stored_at: new Date().toISOString()
              }
            });
          } catch (retryError) {
            throw new Error(`Failed after retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
          }
        } else {
          throw insertError;
        }
      }

      console.log(`[VECTOR_STORE] Added memory ${id} to scope ${scope}`);
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to add memory ${id}:`, error);
      throw new Error(`Failed to add memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Query for relevant memories in a scope
   * Returns results ranked by similarity (highest first)
   */
  async query(
    queryText: string,
    scope: string,
    topK: number = 5,
    minSimilarity: number = 0.7
  ): Promise<MemoryEntry[]> {
    try {
      // Check if scope exists
      if (!this.indexes.has(scope)) {
        const exists = await this.scopeExists(scope);
        if (!exists) {
          return []; // Scope doesn't exist, no memories
        }
        await this.init(scope);
      }

      // Generate query embedding
      const queryVector = await this.embeddingManager.embedText(queryText);

      // Manual query: Read index.json directly and compute similarity
      const indexPath = path.join(this.basePath, scope, 'index.json');
      
      try {
        const indexContent = await fs.readFile(indexPath, 'utf-8');
        const indexData = JSON.parse(indexContent);
        
        if (!indexData.items || !Array.isArray(indexData.items)) {
          console.log(`[VECTOR_STORE] No items in index for scope ${scope}`);
          return [];
        }

        // Compute similarity for each item and filter
        const results: { item: any; score: number }[] = [];
        
        for (const item of indexData.items) {
          // Check if item has a vector (should be array)
          const storedVector = item.vector;
          
          // Handle case where vector is stored as single number (corruption case)
          let similarity = 0;
          if (Array.isArray(storedVector) && storedVector.length === queryVector.length) {
            // Valid vector array - compute cosine similarity
            similarity = EmbeddingManager.cosineSimilarity(queryVector, storedVector);
          } else if (typeof storedVector === 'number') {
            // Vector is corrupted (single number instead of array)
            // This is a fallback - try text-based matching
            const text = item.metadata?.text || '';
            const queryLower = queryText.toLowerCase();
            const textLower = text.toLowerCase();
            similarity = textLower.includes(queryLower) ? 0.5 : 0.1;
            console.warn(`[VECTOR_STORE] Item ${item.id} has corrupted vector (scalar instead of array), using text-based fallback`);
          } else {
            console.warn(`[VECTOR_STORE] Item ${item.id} has invalid vector format:`, typeof storedVector);
            similarity = 0;
          }
          
          if (similarity >= minSimilarity) {
            results.push({
              item,
              score: similarity
            });
          }
        }

        // Sort by similarity descending
        results.sort((a, b) => b.score - a.score);

        // Transform to MemoryEntry format
        const entries: MemoryEntry[] = results
          .slice(0, topK)
          .map((result: any) => ({
            id: result.item.id,
            text: result.item.metadata?.text || '',
            metadata: result.item.metadata,
            similarity: result.score
          }));

        console.log(
          `[VECTOR_STORE] Query found ${entries.length} memories in scope ${scope}`
        );

        return entries;
      } catch (readError) {
        // If manual read fails, try Vectra's query as fallback
        console.warn(`[VECTOR_STORE] Manual query failed for scope ${scope}, trying Vectra queryItems:`, readError);
        
        const index = this.indexes.get(scope);
        if (!index) {
          return [];
        }

        try {
          const results = await index.queryItems(
            queryVector,
            '',  // text query (empty for semantic-only search)
            topK
          );

          const entries: MemoryEntry[] = results
            .filter((result: any) => (result.score || 0) >= minSimilarity)
            .map((result: any) => ({
              id: result.item.id,
              text: result.item.metadata?.text || '',
              metadata: result.item.metadata,
              similarity: result.score
            }));

          return entries;
        } catch (vectraError) {
          console.error(`[VECTOR_STORE] Vectra queryItems also failed:`, vectraError);
          return [];
        }
      }
    } catch (error) {
      console.error(`[VECTOR_STORE] Query failed for scope ${scope}:`, error);
      return []; // Return empty instead of throwing - graceful degradation
    }
  }

  /**
   * Delete a specific memory by ID
   */
  async deleteMemory(id: string, scope: string): Promise<void> {
    try {
      if (!this.indexes.has(scope)) {
        throw new Error(`Scope ${scope} not found`);
      }

      const index = this.indexes.get(scope);
      if (!index) {
        throw new Error(`Scope ${scope} not found`);
      }

      // Use removeItem method
      await index.deleteItem(id);
      console.log(`[VECTOR_STORE] Deleted memory ${id} from scope ${scope}`);
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to delete memory ${id}:`, error);
      throw new Error(`Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Clear all memories in a scope
   */
  async clear(scope: string): Promise<void> {
    try {
      if (!this.indexes.has(scope)) {
        throw new Error(`Scope ${scope} not found`);
      }

      const index = this.indexes.get(scope);
      if (!index) {
        throw new Error(`Scope ${scope} not found`);
      }

      // Get all items and delete them
      // Use a zero vector and high topK to get all items
      const allItems = await index.queryItems(
        new Array(768).fill(0),
        '',
        100000
      );

      for (const item of allItems) {
        await index.deleteItem(item.item.id);
      }

      console.log(`[VECTOR_STORE] Cleared all memories from scope ${scope}`);
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to clear scope ${scope}:`, error);
      throw new Error(`Failed to clear scope: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if a scope exists
   */
  async scopeExists(scope: string): Promise<boolean> {
    try {
      const indexPath = path.join(this.basePath, scope);
      const stat = await fs.stat(indexPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get count of memories in a scope
   */
  async getMemoryCount(scope: string): Promise<number> {
    try {
      if (!this.indexes.has(scope)) {
        const exists = await this.scopeExists(scope);
        if (!exists) {
          return 0;
        }
        await this.init(scope);
      }

      const index = this.indexes.get(scope);
      if (!index) {
        return 0;
      }

      // Get all items as a rough count
      const allItems = await index.queryItems(
        new Array(768).fill(0),
        '',
        100000
      );

      return allItems.length;
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to get memory count for scope ${scope}:`, error);
      return 0;
    }
  }

  /**
   * Delete an entire scope
   */
  async deleteScope(scope: string): Promise<void> {
    try {
      const indexPath = path.join(this.basePath, scope);

      // Remove from cache
      this.indexes.delete(scope);

      // Delete directory
      await fs.rm(indexPath, { recursive: true, force: true });
      console.log(`[VECTOR_STORE] Deleted scope: ${scope}`);
    } catch (error) {
      console.error(`[VECTOR_STORE] Failed to delete scope ${scope}:`, error);
      throw new Error(`Failed to delete scope: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get statistics about the store
   */
  async getStats(): Promise<{
    totalScopes: number;
    scopes: Array<{ scope: string; count: number }>;
  }> {
    try {
      const scopes: Array<{ scope: string; count: number }> = [];

      // List all directories in base path
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const count = await this.getMemoryCount(entry.name);
          scopes.push({ scope: entry.name, count });
        }
      }

      return {
        totalScopes: scopes.length,
        scopes
      };
    } catch (error) {
      console.error('[VECTOR_STORE] Failed to get stats:', error);
      return { totalScopes: 0, scopes: [] };
    }
  }
}

/**
 * Factory function to create a VectraVectorStore
 */
export function createVectraVectorStore(basePath?: string): VectraVectorStore {
  return new VectraVectorStore(basePath);
}

export default VectraVectorStore;
