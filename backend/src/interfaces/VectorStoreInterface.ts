/**
 * VectorStoreInterface - Abstraction layer for vector storage providers
 * Enables swapping providers (Vectra, Qdrant, Milvus, etc.) without core code changes
 */

export interface MemoryEntry {
  id: string;
  text: string;
  metadata?: Record<string, any>;
  similarity?: number;
}

export interface VectorStoreInterface {
  /**
   * Initializes the store for a specific scope (e.g., worldId_characterId).
   * Creates the scope if it doesn't exist (lazy initialization).
   * 
   * @param scope - Unique identifier for the memory scope (e.g., "world_1_char_42")
   * @throws Error if initialization fails
   */
  init(scope: string): Promise<void>;

  /**
   * Adds a memory item with embedding to the store.
   * If scope doesn't exist, initializes it first.
   * 
   * @param id - Unique ID for the memory
   * @param text - Text content to embed and store
   * @param metadata - Optional metadata (timestamp, event type, round number, etc.)
   * @param scope - The memory scope for isolation
   * @throws Error if storage fails
   */
  addMemory(id: string, text: string, metadata?: Record<string, any>, scope?: string): Promise<void>;

  /**
   * Queries the store for relevant memories in a given scope.
   * Returns results ranked by similarity score (highest first).
   * 
   * @param queryText - Text to embed and query against
   * @param scope - The memory scope to query within
   * @param topK - Number of top results to return (default: 5)
   * @param minSimilarity - Minimum similarity threshold (default: 0.7)
   * @returns Array of memories with similarity scores, sorted by relevance (highest first)
   * @throws Error if query fails
   */
  query(
    queryText: string,
    scope: string,
    topK?: number,
    minSimilarity?: number
  ): Promise<MemoryEntry[]>;

  /**
   * Deletes a memory by ID from a specific scope.
   * 
   * @param id - Memory ID to delete
   * @param scope - The memory scope containing the memory
   * @throws Error if scope doesn't exist or memory not found
   */
  deleteMemory(id: string, scope: string): Promise<void>;

  /**
   * Clears all memories for a specific scope.
   * After clearing, the scope is effectively empty but may still exist.
   * 
   * @param scope - The memory scope to clear
   * @throws Error if scope doesn't exist
   */
  clear(scope: string): Promise<void>;

  /**
   * Checks if a scope exists in the store.
   * Useful for determining whether a character has any memories.
   * 
   * @param scope - The memory scope to check
   * @returns true if scope exists, false otherwise
   */
  scopeExists(scope: string): Promise<boolean>;

  /**
   * Gets the total count of memories in a scope.
   * 
   * @param scope - The memory scope to count
   * @returns Number of memories in the scope
   */
  getMemoryCount(scope: string): Promise<number>;

  /**
   * Deletes an entire scope, removing all associated memories.
   * Use with caution.
   * 
   * @param scope - The memory scope to delete
   * @throws Error if scope doesn't exist
   */
  deleteScope(scope: string): Promise<void>;
}

/**
 * Factory function to create a VectorStore instance
 * Supports swapping providers by type name
 */
export type VectorStoreProvider = 'vectra' | 'qdrant' | 'milvus' | string;

export function isVectorStoreInterface(obj: any): obj is VectorStoreInterface {
  return (
    obj &&
    typeof obj.init === 'function' &&
    typeof obj.addMemory === 'function' &&
    typeof obj.query === 'function' &&
    typeof obj.deleteMemory === 'function' &&
    typeof obj.clear === 'function' &&
    typeof obj.scopeExists === 'function' &&
    typeof obj.getMemoryCount === 'function' &&
    typeof obj.deleteScope === 'function'
  );
}
