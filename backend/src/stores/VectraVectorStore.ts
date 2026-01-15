/**
 * VectraVectorStore - Implementation of VectorStoreInterface using Vectra
 * Vectra provides local file system storage (indexes as folders)
 */

import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import { VectorStoreInterface, MemoryEntry } from '../interfaces/VectorStoreInterface.js';
import EmbeddingManager from '../utils/embeddingManager.js';
import { createJob, setJobStatus } from '../jobs/jobStore.js';
import { recordAudit } from '../jobs/auditLog.js';

interface StoredMemory {
  id: string;
  text: string;
  metadata?: Record<string, any>;
  vector: number[];
}

export class VectraVectorStore implements VectorStoreInterface {
  private indexes: Map<string, LocalIndex> = new Map();
  private initPromises: Map<string, Promise<void>> = new Map();
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

    // If another init is in progress for this scope, wait for it
    if (this.initPromises.has(scope)) {
      await this.initPromises.get(scope);
      return;
    }

    const initPromise = (async () => {

      try {
        const indexPath = path.join(this.basePath, scope);

        // Ensure base directory AND scope directory exist
        await fs.mkdir(this.basePath, { recursive: true });
        await fs.mkdir(indexPath, { recursive: true });

        // Initialize Vectra index (it will save to the directory we just created)
        const index = new LocalIndex(indexPath);

        // Try to load existing index, or create new one. Retry on transient failures.
        let created = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // Vectra's createIndex will create index.json in the path
            await index.createIndex();
            created = true;
            break;
          } catch (createError: any) {
            const msg = createError instanceof Error ? createError.message : String(createError);
            console.log(`[VECTOR_STORE] Index creation attempt ${attempt + 1} failed:`, msg);
            // Ensure directory exists and retry after short delay
            try {
              await fs.mkdir(indexPath, { recursive: true });
            } catch (mkErr) {
              // ignore - we'll retry
            }
            await new Promise((res) => setTimeout(res, 100));
          }
        }

        if (!created) {
          // Final check: if index.json exists, consider it OK, otherwise throw
          const indexJsonPath = path.join(indexPath, 'index.json');
          try {
            const stat = await fs.stat(indexJsonPath);
            if (!stat.isFile()) {
              throw new Error('index.json not created');
            }
          } catch (e) {
            throw new Error(`Failed to create Vectra index at ${indexPath}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        this.indexes.set(scope, index);
        console.log(`[VECTOR_STORE] Initialized scope: ${scope}`);
      } catch (error) {
        console.error(`[VECTOR_STORE] Failed to initialize scope ${scope}:`, error);
        throw new Error(`Failed to initialize vector store scope ${scope}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    this.initPromises.set(scope, initPromise);
    try {
      await initPromise;
    } finally {
      this.initPromises.delete(scope);
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
      try {
        await fs.mkdir(indexPath, { recursive: true });
      } catch (mkdirErr: any) {
        // On some Windows setups or race conditions, mkdir can fail with ENOENT
        // Attempt to ensure basePath exists, then retry
        console.warn(`[VECTOR_STORE] mkdir failed for ${indexPath}, retrying after ensuring base path. Error:`, mkdirErr?.message || mkdirErr);
        try {
          await fs.mkdir(this.basePath, { recursive: true });
          await fs.mkdir(indexPath, { recursive: true });
        } catch (retryErr) {
          console.error(`[VECTOR_STORE] Failed to create directory ${indexPath} after retry:`, retryErr);
          throw retryErr;
        }
      }
      // Ensure index.json exists; if not, attempt to create index before inserting
      const indexJsonPath = path.join(indexPath, 'index.json');
      try {
        await fs.stat(indexJsonPath);
      } catch {
        try {
          console.log(`[VECTOR_STORE] index.json missing for scope ${scope}, attempting createIndex()`);
          await index.createIndex();
        } catch (ciErr) {
          console.warn(`[VECTOR_STORE] createIndex failed for scope ${scope}: ${ciErr instanceof Error ? ciErr.message : String(ciErr)}`);
        }
      }

      // Try to insert item, with retry on ENOENT or index-not-found errors
      const doInsert = async () => {
        await index.insertItem({
          id,
          vector,
          metadata: {
            text,
            ...metadata,
            stored_at: new Date().toISOString()
          }
        });
      };

      try {
        await doInsert();
        // Ensure index.json persisted: retry-read until item appears (small window)
        const indexJsonPath2 = path.join(indexPath, 'index.json');
        const maxAttempts = 5;
        let foundOnDisk = false;
        for (let a = 0; a < maxAttempts; a++) {
          try {
            const content = await fs.readFile(indexJsonPath2, 'utf-8');
            const parsed = JSON.parse(content);
            const items = Array.isArray(parsed.items) ? parsed.items : [];
            if (items.find((it: any) => it.id === id)) {
              foundOnDisk = true;
              break;
            }
          } catch {
            // ignore and retry
          }
          // small delay
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 40));
        }
        if (!foundOnDisk) {
          console.warn(`[VECTOR_STORE] Warning: inserted item ${id} may not be persisted to index.json yet for scope ${scope}`);
        }
      } catch (insertError) {
        const errMsg = insertError instanceof Error ? insertError.message : String(insertError);
        // If the item already exists, treat as idempotent success
        if (errMsg.includes('already exists') || errMsg.includes('already added') || errMsg.includes('duplicate')) {
          console.warn(`[VECTOR_STORE] Insert attempted for existing item ${id} in scope ${scope}; treating as success.`);
        } else {
          const isEnoent = (insertError as any)?.code === 'ENOENT' || errMsg.includes('no such file') || errMsg.includes('ENOENT');
          const needsCreate = errMsg.includes('does not exist') || errMsg.includes('Index');
          if (isEnoent || needsCreate) {
            console.log(`[VECTOR_STORE] Insert failed for scope ${scope} (${errMsg}), attempting createIndex and retry`);
            try {
              try {
                await index.createIndex();
              } catch (ciErr) {
                console.warn(`[VECTOR_STORE] createIndex retry failed for scope ${scope}: ${ciErr instanceof Error ? ciErr.message : String(ciErr)}`);
              }
              await doInsert();
            } catch (retryError) {
              const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
              if (retryMsg.includes('already exists') || retryMsg.includes('duplicate')) {
                console.warn(`[VECTOR_STORE] Retry insert found existing item ${id} in scope ${scope}; treating as success.`);
              } else {
                throw new Error(`Failed after retry: ${retryMsg}`);
              }
            }
          } else {
            throw insertError;
          }
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
        console.log(`[VECTOR_STORE] Scope ${scope} not in memory, checking if it exists on disk...`);
        const exists = await this.scopeExists(scope);
        if (!exists) {
          console.log(`[VECTOR_STORE] Scope ${scope} does not exist on disk, returning empty results`);
          return []; // Scope doesn't exist, no memories
        }
        console.log(`[VECTOR_STORE] Scope ${scope} found on disk, initializing...`);
        await this.init(scope);
      }

      // Generate query embedding
      console.log(`[VECTOR_STORE] Generating embedding for query text (length: ${queryText.length})`);
      const queryVector = await this.embeddingManager.embedText(queryText);
      console.log(`[VECTOR_STORE] Generated query vector with ${queryVector.length} dimensions`);

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
          } else {
            // Log items that didn't make the threshold
            if (Array.isArray(storedVector)) {
              console.log(`[VECTOR_STORE] Item ${item.id} scored ${similarity.toFixed(4)} (below threshold of ${minSimilarity})`);
            }
          }
        }
        
        console.log(`[VECTOR_STORE] Found ${results.length}/${indexData.items.length} memories above threshold`);

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
      // If we've initialized the scope in-memory, consider it existing
      if (this.indexes.has(scope)) return true;

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
      let allItems: any[] = [];
      try {
        allItems = await index.queryItems(new Array(768).fill(0), '', 100000);
      } catch (qe) {
        console.warn(`[VECTOR_STORE] queryItems failed for getMemoryCount on scope ${scope}: ${qe instanceof Error ? qe.message : String(qe)}`);
      }

      // Also try to read index.json directly as a fallback and use the larger of the two counts
      const indexJsonPath = path.join(this.basePath, scope, 'index.json');
      let diskCount = 0;
      try {
        const content = await fs.readFile(indexJsonPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.items)) diskCount = parsed.items.length;
      } catch {
        // ignore - file may not exist yet
      }

      return Math.max(allItems.length, diskCount);
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
   * Delete items matching metadata filter. If `scope` provided, only that scope is checked;
   * otherwise all scopes under `basePath` are scanned.
   * Matching is shallow exact equality on provided keys.
   */
  async deleteByMetadata(
    filter: Record<string, any>,
    scope?: string,
    options?: { dryRun?: boolean; confirm?: boolean; background?: boolean; confirmThreshold?: number }
  ): Promise<void> {
    const opts = {
      dryRun: false,
      confirm: false,
      background: false,
      confirmThreshold: 50,
      ...(options || {})
    };

    let backgroundJobId: string | undefined;

    const performDelete = async () => {
      try {
        const scopesToCheck: string[] = [];

        if (scope) {
          scopesToCheck.push(scope);
        } else {
          // list directories under basePath
          try {
            const entries = await fs.readdir(this.basePath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) scopesToCheck.push(entry.name);
            }
          } catch (e) {
            console.warn(`[VECTOR_STORE] Failed to list scopes for deleteByMetadata: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
        }

        // First pass: count matches
        let totalMatches = 0;
        const perScopeMatches: Record<string, string[]> = {};

        for (const s of scopesToCheck) {
          try {
            const indexPath = path.join(this.basePath, s);

            const exists = await this.scopeExists(s);
            if (!exists) continue;

            // Ensure index instance is available
            if (!this.indexes.has(s)) {
              try {
                await this.init(s);
              } catch (e) {
                console.warn(`[VECTOR_STORE] Could not init scope ${s} for deleteByMetadata: ${e instanceof Error ? e.message : String(e)}`);
                continue;
              }
            }

            const index = this.indexes.get(s);
            if (!index) continue;

            // Read index.json to find matching items
            const idxJsonPath = path.join(indexPath, 'index.json');
            let items: any[] = [];
            try {
              const content = await fs.readFile(idxJsonPath, 'utf-8');
              const parsed = JSON.parse(content);
              items = Array.isArray(parsed.items) ? parsed.items : [];
            } catch (readErr) {
              // If reading index.json fails, try using vectra queryItems to list items
              try {
                const listed = await index.queryItems(new Array(768).fill(0), '', 100000);
                items = listed.map((r: any) => r.item);
              } catch (qErr) {
                console.warn(`[VECTOR_STORE] Failed to list items for scope ${s}: ${qErr instanceof Error ? qErr.message : String(qErr)}`);
                continue;
              }
            }

            // Find matching item ids
            const toDeleteIds: string[] = [];
            for (const it of items) {
              const meta = it.metadata || {};
              let match = true;
              for (const k of Object.keys(filter)) {
                if (meta[k] !== filter[k]) {
                  match = false;
                  break;
                }
              }
              if (match) toDeleteIds.push(it.id);
            }

            if (toDeleteIds.length > 0) {
              perScopeMatches[s] = toDeleteIds;
              totalMatches += toDeleteIds.length;
            }
          } catch (scopeErr) {
            console.warn(`[VECTOR_STORE] Error processing scope ${s} in deleteByMetadata: ${scopeErr instanceof Error ? scopeErr.message : String(scopeErr)}`);
          }
        }

        // Safety: if matches exceed threshold and not confirmed, throw
        if (totalMatches >= (opts.confirmThreshold || 50) && !opts.confirm) {
          throw new Error(`deleteByMetadata would remove ${totalMatches} items; set options.confirm=true to proceed`);
        }

        // If dryRun, just log and return
        if (opts.dryRun) {
          console.log(`[VECTOR_STORE] deleteByMetadata dryRun: would delete ${totalMatches} items`, perScopeMatches);
          return;
        }

        // Perform deletions
        for (const [s, ids] of Object.entries(perScopeMatches)) {
          const index = this.indexes.get(s);
          if (!index) continue;
          for (const id of ids) {
            try {
              await index.deleteItem(id);
              console.log(`[VECTOR_STORE] Deleted item ${id} from scope ${s} by metadata`);
            } catch (delErr) {
              console.warn(`[VECTOR_STORE] Failed to delete item ${id} from scope ${s}: ${delErr instanceof Error ? delErr.message : String(delErr)}`);
            }
          }
        }

        // Record audit entry for this deletion
        try {
          const deletedIds = Object.values(perScopeMatches).flat();
          await recordAudit({
            timestamp: new Date().toISOString(),
            filter,
            scopes: Object.keys(perScopeMatches),
            deletedCount: totalMatches,
            deletedIds,
            actor: (opts as any).actor || 'system'
          });
        } catch (ae) {
          console.warn('[VECTOR_STORE] Failed to record audit for deleteByMetadata:', ae instanceof Error ? ae.message : String(ae));
        }

        // If running as background job, mark completion
        if (backgroundJobId) {
          try {
            setJobStatus(backgroundJobId, 'completed', { deleted: totalMatches });
          } catch (e) {
            console.warn('[VECTOR_STORE] Failed to set background job completion status', e);
          }
        }
      } catch (error) {
        console.error(`[VECTOR_STORE] deleteByMetadata failed:`, error);
        if (backgroundJobId) {
          setJobStatus(backgroundJobId, 'failed', undefined, error instanceof Error ? error.message : String(error));
          return;
        }
        throw error;
      }
    };

    if (opts.background) {
      // create background job record and run the delete asynchronously
      const job = createJob('deleteByMetadata', { filter, scope });
      backgroundJobId = job.id;
      setJobStatus(job.id, 'running');
      performDelete()
        .catch(err => console.error('[VECTOR_STORE] background deleteByMetadata error:', err));
      console.log(`[VECTOR_STORE] deleteByMetadata scheduled in background (jobId=${job.id})`);
      return;
    }

    return performDelete();
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
