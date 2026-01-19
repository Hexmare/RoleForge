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
import { matchesFilter, normalizeIndexItems } from '../utils/memoryHelpers.js';
import { createLogger, NAMESPACES } from '../logging';

const vectraStoreLog = createLogger(NAMESPACES.vectorStore.vectra);

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
            vectraStoreLog(`[VECTOR_STORE] Index creation attempt ${attempt + 1} failed:`, msg);
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
        vectraStoreLog(`[VECTOR_STORE] Initialized scope: ${scope}`);
      } catch (error) {
        vectraStoreLog(`[VECTOR_STORE] Failed to initialize scope ${scope}:`, error);
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
        vectraStoreLog(`[VECTOR_STORE] mkdir failed for ${indexPath}, retrying after ensuring base path. Error:`, mkdirErr?.message || mkdirErr);
        try {
          await fs.mkdir(this.basePath, { recursive: true });
          await fs.mkdir(indexPath, { recursive: true });
        } catch (retryErr) {
          vectraStoreLog(`[VECTOR_STORE] Failed to create directory ${indexPath} after retry:`, retryErr);
          throw retryErr;
        }
      }
      // Ensure index.json exists; if not, attempt to create index before inserting
      const indexJsonPath = path.join(indexPath, 'index.json');
      try {
        await fs.stat(indexJsonPath);
      } catch {
        try {
          vectraStoreLog(`[VECTOR_STORE] index.json missing for scope ${scope}, attempting createIndex()`);
          await index.createIndex();
        } catch (ciErr) {
          vectraStoreLog(`[VECTOR_STORE] createIndex failed for scope ${scope}: ${ciErr instanceof Error ? ciErr.message : String(ciErr)}`);
        }
      }

      // Try to insert item, with retry on ENOENT or index-not-found errors
      const doInsert = async () => {
          // Normalize metadata fields to strings for robustness
          const normalizedMeta: Record<string, any> = Object.assign({}, metadata || {});
          const canonicalKeys = ['campaignId', 'arcId', 'sceneId', 'roundId', 'messageId', 'speakerId'];
          for (const k of canonicalKeys) {
            if (normalizedMeta[k] !== undefined && normalizedMeta[k] !== null) {
              try {
                normalizedMeta[k] = String(normalizedMeta[k]);
              } catch {
                // leave as-is if conversion fails
              }
            }
          }
          normalizedMeta.stored_at = new Date().toISOString();

          await index.insertItem({
            id,
            vector,
            metadata: {
              text,
              ...normalizedMeta
            }
          });
      };

        try {
            await doInsert();
            // Verify insertion: poll both Vectra's in-memory query and the
            // on-disk index.json until the item becomes visible. Filesystem
            // writes can lag, especially on Windows, so check both sources.
            const maxAttempts = 50;
            let found = false;
            const checkIndexJson = async () => {
              try {
                const indexJsonPath2 = path.join(indexPath, 'index.json');
                const content = await fs.readFile(indexJsonPath2, 'utf-8');
                const parsed = JSON.parse(content);
                const items = Array.isArray(parsed.items) ? parsed.items : [];
                return items.find((it: any) => it.id === id) !== undefined;
              } catch {
                return false;
              }
            };

            for (let a = 0; a < maxAttempts; a++) {
              try {
                const idx = this.indexes.get(scope);
                if (idx) {
                  // Query a reasonable number of candidates to find the new item
                  const qres = await idx.queryItems(vector, '', 50);
                  if (Array.isArray(qres) && qres.find((r: any) => r.item && r.item.id === id)) {
                    found = true;
                    break;
                  }
                }

                // Also check index.json on disk each iteration
                if (await checkIndexJson()) {
                  found = true;
                  break;
                }
              } catch (qe) {
                // ignore and retry
              }

              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(r, 150));
            }

            if (!found) {
              vectraStoreLog(`[VECTOR_STORE] Warning: inserted item ${id} may not be fully visible yet for scope ${scope}`);
            }
          } catch (insertError) {
        const errMsg = insertError instanceof Error ? insertError.message : String(insertError);
        // If the item already exists, treat as idempotent success
        if (errMsg.includes('already exists') || errMsg.includes('already added') || errMsg.includes('duplicate')) {
          vectraStoreLog(`[VECTOR_STORE] Insert attempted for existing item ${id} in scope ${scope}; treating as success.`);
        } else {
          const isEnoent = (insertError as any)?.code === 'ENOENT' || errMsg.includes('no such file') || errMsg.includes('ENOENT');
          const needsCreate = errMsg.includes('does not exist') || errMsg.includes('Index');
          if (isEnoent || needsCreate) {
            vectraStoreLog(`[VECTOR_STORE] Insert failed for scope ${scope} (${errMsg}), attempting createIndex and retry`);
            // Retry multiple times for transient filesystem races (especially on Windows)
            const maxRetries = 5;
            let succeeded = false;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              try {
                try {
                  await index.createIndex();
                } catch (ciErr) {
                  vectraStoreLog(`[VECTOR_STORE] createIndex retry failed for scope ${scope}: ${ciErr instanceof Error ? ciErr.message : String(ciErr)}`);
                }
                // small delay to allow filesystem to settle
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 120));
                await doInsert();
                succeeded = true;
                break;
              } catch (retryError) {
                const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
                if (retryMsg.includes('already exists') || retryMsg.includes('duplicate')) {
                  vectraStoreLog(`[VECTOR_STORE] Retry insert found existing item ${id} in scope ${scope}; treating as success.`);
                  succeeded = true;
                  break;
                }
                // otherwise wait and retry
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 100));
              }
            }

            if (!succeeded) {
              throw new Error(`Failed after retry: ${errMsg}`);
            }
          } else {
            throw insertError;
          }
        }
      }

      vectraStoreLog(`[VECTOR_STORE] Added memory ${id} to scope ${scope}`);
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Failed to add memory ${id}:`, error);
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
        vectraStoreLog(`[VECTOR_STORE] Scope ${scope} not in memory, checking if it exists on disk...`);
        const exists = await this.scopeExists(scope);
        if (!exists) {
          vectraStoreLog(`[VECTOR_STORE] Scope ${scope} does not exist on disk, returning empty results`);
          return []; // Scope doesn't exist, no memories
        }
        vectraStoreLog(`[VECTOR_STORE] Scope ${scope} found on disk, initializing...`);
        await this.init(scope);
      }

      // Generate query embedding
      vectraStoreLog(`[VECTOR_STORE] Generating embedding for query text (length: ${queryText.length})`);
      const queryVector = await this.embeddingManager.embedText(queryText);
      vectraStoreLog(`[VECTOR_STORE] Generated query vector with ${queryVector.length} dimensions`);

      // Manual query: Read index.json directly and compute similarity
      const indexPath = path.join(this.basePath, scope, 'index.json');
      
      try {
        const indexContent = await fs.readFile(indexPath, 'utf-8');
        const indexData = JSON.parse(indexContent);
        
        if (!indexData.items || !Array.isArray(indexData.items)) {
          vectraStoreLog(`[VECTOR_STORE] No items in index for scope ${scope}`);
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
            // Clamp and diagnose any unexpected out-of-range similarities
            if (similarity > 1 || similarity < -1) {
              vectraStoreLog(`[VECTOR_STORE] Raw similarity out of range for item ${item.id}: ${similarity}`);
              similarity = Math.max(-1, Math.min(1, similarity));
            }
          } else if (typeof storedVector === 'number') {
            // Vector is corrupted (single number instead of array)
            // This is a fallback - try text-based matching
            const text = item.metadata?.text || '';
            const queryLower = queryText.toLowerCase();
            const textLower = text.toLowerCase();
            similarity = textLower.includes(queryLower) ? 0.5 : 0.1;
            vectraStoreLog(`[VECTOR_STORE] Item ${item.id} has corrupted vector (scalar instead of array), using text-based fallback`);
          } else {
            vectraStoreLog(`[VECTOR_STORE] Item ${item.id} has invalid vector format:`, typeof storedVector);
            similarity = 0;
          }
          
          // Light lexical boost so direct text hits rank higher when embeddings are noisy/mocked
          const qTokens = queryText.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
          const text = String(item.metadata?.text || '').toLowerCase();
          let lexicalBoost = 0;
          if (qTokens.length > 0 && text) {
            for (const tok of qTokens) {
              if (tok && text.includes(tok)) lexicalBoost += 0.05;
            }
          }

          const boosted = Math.min(1, similarity + lexicalBoost);

          if (boosted >= minSimilarity) {
            results.push({
              item,
              score: boosted
            });
          } else {
            // Log items that didn't make the threshold
            if (Array.isArray(storedVector)) {
              vectraStoreLog(`[VECTOR_STORE] Item ${item.id} scored ${boosted.toFixed(4)} (below threshold of ${minSimilarity})`);
            }
          }
        }
        
        vectraStoreLog(`[VECTOR_STORE] Found ${results.length}/${indexData.items.length} memories above threshold`);

        // Sort by similarity descending
        results.sort((a, b) => b.score - a.score);

        // Transform to MemoryEntry format
        const entries: MemoryEntry[] = results
          .slice(0, topK)
          .map((result: any) => ({
            id: result.item.id,
            text: result.item.metadata?.text || '',
            metadata: (result.item.metadata || result.item.meta || (result.item.item && result.item.item.metadata) || {}),
            similarity: Math.max(-1, Math.min(1, result.score))
          }));

        vectraStoreLog(
          `[VECTOR_STORE] Query found ${entries.length} memories in scope ${scope}`
        );

        // If manual index parsing found no results (possible small window where
        // index.json isn't yet fully persisted), try Vectra's queryItems as a
        // fallback to avoid false-negative queries.
        if (entries.length === 0) {
          try {
            const index = this.indexes.get(scope);
            if (index) {
              const vectraResults = await index.queryItems(queryVector, '', topK);
              const vectraEntriesAll: MemoryEntry[] = vectraResults.map((r: any) => ({
                id: r.item.id,
                text: r.item.metadata?.text || '',
                metadata: (r.item.metadata || r.item.meta || (r.item.item && r.item.item.metadata) || {}),
                similarity: Math.max(-1, Math.min(1, r.score))
              }));

              // Prefer results that meet the minSimilarity threshold
              const vectraEntries = vectraEntriesAll.filter((r) => (r.similarity || 0) >= minSimilarity);

              if (vectraEntries.length > 0) {
                vectraStoreLog(`[VECTOR_STORE] Fallback Vectra query returned ${vectraEntries.length} results for scope ${scope}`);
                return vectraEntries.slice(0, topK);
              }

              // If no vectra entries meet the threshold but vectra returned candidates,
              // return top candidates (relaxed) to avoid false negatives due to
              // filesystem/index.json lag; caller can still inspect similarity values.
              if (vectraEntriesAll.length > 0) {
                // Only return relaxed (below-threshold) candidates when the
                // original minSimilarity is low (<= 0.3). For high thresholds we
                // should not relax semantics.
                if ((minSimilarity || 0) <= 0.3) {
                  vectraStoreLog(`[VECTOR_STORE] Fallback Vectra query returned ${vectraEntriesAll.length} candidates (below threshold) for scope ${scope}, returning relaxed results`);
                  return vectraEntriesAll.slice(0, topK);
                }
                // Otherwise, don't return below-threshold candidates.
              }
            }
          } catch (fbErr) {
            vectraStoreLog('[VECTOR_STORE] Fallback Vectra query failed:', fbErr instanceof Error ? fbErr.message : String(fbErr));
          }
        }

        return entries;
      } catch (readError) {
        // If manual read fails, try Vectra's query as fallback
        vectraStoreLog(`[VECTOR_STORE] Manual query failed for scope ${scope}, trying Vectra queryItems:`, readError);
        
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
              metadata: (result.item.metadata || result.item.meta || (result.item.item && result.item.item.metadata) || {}),
              similarity: Math.max(-1, Math.min(1, result.score))
            }));

          return entries;
        } catch (vectraError) {
          vectraStoreLog(`[VECTOR_STORE] Vectra queryItems also failed:`, vectraError);
          return [];
        }
      }
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Query failed for scope ${scope}:`, error);
      return []; // Return empty instead of throwing - graceful degradation
    }
  }

  /**
   * Delete a specific memory by ID
   */
  async deleteMemory(id: string, scope: string): Promise<void> {
    try {
      if (!this.indexes.has(scope)) {
        // If not initialized in-memory, check if scope exists on disk and try to init.
        const exists = await this.scopeExists(scope);
        if (!exists) {
          throw new Error(`Scope ${scope} not found`);
        }
        await this.init(scope);
      }

      const index = this.indexes.get(scope);
      if (!index) {
        throw new Error(`Scope ${scope} not found`);
      }

      // Ensure on-disk index.json exists before attempting delete. Vectra
      // can throw ENOENT when saving if the file is missing due to a race.
      const indexPath = path.join(this.basePath, scope);
      const indexJsonPath = path.join(indexPath, 'index.json');
      try {
        await fs.stat(indexJsonPath);
      } catch {
        // Try to create the index (retry a few times)
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await index.createIndex();
            break;
          } catch (ciErr) {
            // small delay and retry
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      // Use removeItem method
      await index.deleteItem(id);
      vectraStoreLog(`[VECTOR_STORE] Deleted memory ${id} from scope ${scope}`);
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Failed to delete memory ${id}:`, error);
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

      // Collect all item ids from both Vectra queryItems and on-disk index.json
      const idsToDelete = new Set<string>();

      try {
        const q = await index.queryItems(new Array(768).fill(0), '', 100000);
        for (const it of Array.isArray(q) ? q : []) {
          const id = ((it as any)?.item?.id) || ((it as any)?.id);
          if (id) idsToDelete.add(id);
        }
      } catch (qe) {
        // ignore
      }

      try {
        const indexJsonPath = path.join(this.basePath, scope, 'index.json');
        const content = await fs.readFile(indexJsonPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.items)) {
          for (const it of parsed.items) {
            const id = ((it as any)?.id) || ((it as any)?.item?.id);
            if (id) idsToDelete.add(id);
          }
        }
      } catch {
        // ignore read errors
      }

      for (const id of idsToDelete) {
        try {
          await index.deleteItem(id);
        } catch (e) {
          // ignore individual delete errors
        }
      }

      vectraStoreLog(`[VECTOR_STORE] Cleared all memories from scope ${scope}`);
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Failed to clear scope ${scope}:`, error);
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
      // Consider a scope existing only if the directory exists AND an index.json
      // file exists (i.e. Vectra index was created). This avoids treating
      // leftover/empty directories as valid scopes which can cause test
      // assumptions about lazy initialization to fail.
      try {
        const stat = await fs.stat(indexPath);
        if (!stat.isDirectory()) return false;
      } catch {
        return false;
      }

      const indexJsonPath = path.join(indexPath, 'index.json');
      try {
        const stat2 = await fs.stat(indexJsonPath);
        return stat2.isFile();
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Lightweight count used for safety checks (no retries/embedding)
  private async fastCount(scope: string): Promise<number> {
    try {
      const indexJsonPath = path.join(this.basePath, scope, 'index.json');
      const content = await fs.readFile(indexJsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.items)) return parsed.items.length;
    } catch {
      // ignore
    }
    return 0;
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

      // Try to obtain a stable count by sampling both vectra's queryItems and
      // the on-disk index.json. Filesystem and vectra internals can lag, so
      // retry a few times until the count stabilizes or we exhaust attempts.
      const indexJsonPath = path.join(this.basePath, scope, 'index.json');
      const maxAttempts = 100;
      let lastCombined = -1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let allItems: any[] = [];
        try {
          const q = await index.queryItems(new Array(768).fill(0), '', 100000);
          allItems = Array.isArray(q) ? q : [];
        } catch (qe) {
          // ignore
        }

        let diskCount = 0;
        try {
          const content = await fs.readFile(indexJsonPath, 'utf-8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed.items)) diskCount = parsed.items.length;
        } catch {
          // ignore
        }

        const combined = Math.max(allItems.length, diskCount);
        // If count stabilized between iterations, return it
        if (combined === lastCombined) {
          return combined;
        }

        lastCombined = combined;
        // Small delay before retrying
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 150));
      }

      return Math.max(lastCombined, 0);
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Failed to get memory count for scope ${scope}:`, error);
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
      vectraStoreLog(`[VECTOR_STORE] Deleted scope: ${scope}`);
    } catch (error) {
      vectraStoreLog(`[VECTOR_STORE] Failed to delete scope ${scope}:`, error);
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
            vectraStoreLog(`[VECTOR_STORE] Failed to list scopes for deleteByMetadata: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
        }

        // First pass: canonical match enumeration using listByMetadata
        const perScopeMatches: Record<string, string[]> = {};
        let totalMatches = 0;
        try {
          const { items, totalMatches: tm } = await this.listByMetadata(filter, scope, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
          totalMatches = tm;
          for (const it of items) {
            const scopeKey = it.scope || scope || '';
            if (!scopeKey) continue;
            if (!perScopeMatches[scopeKey]) perScopeMatches[scopeKey] = [];
            perScopeMatches[scopeKey].push(it.id);
          }
        } catch (e) {
          vectraStoreLog('[VECTOR_STORE] listByMetadata failed during deleteByMetadata:', e instanceof Error ? e.message : String(e));
        }

        const confirmThreshold = opts.confirmThreshold ?? 50;

        // If no matches were counted (or counts seem low), attempt a fallback match count via listByMetadata
        // to guard against under-counting when index.json parsing fails.
        if (totalMatches < confirmThreshold) {
          try {
            let fallbackMatches = 0;
            for (const s of scopesToCheck) {
              try {
                const { totalMatches: m } = await this.listByMetadata(filter, s, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
                fallbackMatches += m;
              } catch {
                // ignore per-scope errors
              }
            }
            if (fallbackMatches > totalMatches) {
              totalMatches = fallbackMatches;
            }
          } catch {
            // ignore fallback errors
          }
        }

        // Safety fallback: if we could not enumerate matches (or enumeration under-counted) but the
        // scope(s) hold many items, require confirm. This covers cases where index.json read fails
        // or vectra query glitches, ensuring bulk deletions remain gated.
        if (!opts.confirm && confirmThreshold > 0 && scopesToCheck.length > 0) {
          let potential = totalMatches;
          if (potential < confirmThreshold) {
            for (const s of scopesToCheck) {
              let count = 0;
              try { count = await this.fastCount(s); } catch { /* ignore */ }
              if (count < confirmThreshold) {
                try { count = Math.max(count, await this.getMemoryCount(s)); } catch { /* ignore */ }
              }
              if (count < confirmThreshold) {
                try {
                  const { totalMatches: allCount } = await this.listByMetadata({}, s, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
                  count = Math.max(count, allCount);
                } catch { /* ignore */ }
              }
              potential += count;
            }
          }
          if (potential >= confirmThreshold) {
            throw new Error(`deleteByMetadata would remove ${potential} items; set options.confirm=true to proceed`);
          }
        }

        // Safety: if matches exceed threshold and not confirmed, throw
        if (totalMatches >= confirmThreshold && !opts.confirm) {
          throw new Error(`deleteByMetadata would remove ${totalMatches} items; set options.confirm=true to proceed`);
        }

        // If dryRun, just log and return
        if (opts.dryRun) {
          vectraStoreLog(`[VECTOR_STORE] deleteByMetadata dryRun: would delete ${totalMatches} items`, perScopeMatches);
          return;
        }

        // Perform deletions
        for (const [s, ids] of Object.entries(perScopeMatches)) {
          const index = this.indexes.get(s);
          if (!index) continue;
          for (const id of ids) {
            try {
              await index.deleteItem(id);
              vectraStoreLog(`[VECTOR_STORE] Deleted item ${id} from scope ${s} by metadata`);
            } catch (delErr) {
              vectraStoreLog(`[VECTOR_STORE] Failed to delete item ${id} from scope ${s}: ${delErr instanceof Error ? delErr.message : String(delErr)}`);
            }
          }
          // Additionally, if vectra's on-disk index.json still lists the items,
          // attempt to remove them by rewriting index.json without the deleted ids
          try {
            const indexPath2 = path.join(this.basePath, s);
            const idxJsonPath2 = path.join(indexPath2, 'index.json');
            const content2 = await fs.readFile(idxJsonPath2, 'utf-8');
            const parsed2 = JSON.parse(content2);
            if (Array.isArray(parsed2.items)) {
              const remaining = parsed2.items.filter((it: any) => !ids.includes(it.id));
              parsed2.items = remaining;
              await fs.writeFile(idxJsonPath2, JSON.stringify(parsed2, null, 2), 'utf-8');
            }
          } catch (rwErr) {
            // ignore rewrite errors; deletion via index.deleteItem should be primary
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
          vectraStoreLog('[VECTOR_STORE] Failed to record audit for deleteByMetadata:', ae instanceof Error ? ae.message : String(ae));
        }

        // If running as background job, mark completion
        if (backgroundJobId) {
          try {
            setJobStatus(backgroundJobId, 'completed', { deleted: totalMatches });
          } catch (e) {
            vectraStoreLog('[VECTOR_STORE] Failed to set background job completion status', e);
          }
        }
      } catch (error) {
        vectraStoreLog(`[VECTOR_STORE] deleteByMetadata failed:`, error);
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
        .catch(err => vectraStoreLog('[VECTOR_STORE] background deleteByMetadata error:', err));
      vectraStoreLog(`[VECTOR_STORE] deleteByMetadata scheduled in background (jobId=${job.id})`);
      return;
    }

    return performDelete();
  }

  /**
   * List items matching metadata filter. Returns items grouped by scope with pagination support.
   */
  async listByMetadata(
    filter: Record<string, any>,
    scope?: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ totalMatches: number; items: Array<{ scope: string; id: string; metadata: Record<string, any>; text?: string }> }> {
    const limit = (options && Number(options.limit)) || 50;
    const offset = (options && Number(options.offset)) || 0;

    const scopesToCheck: string[] = [];
    if (scope) scopesToCheck.push(scope);
    else {
      try {
        const entries = await fs.readdir(this.basePath, { withFileTypes: true });
        for (const entry of entries) if (entry.isDirectory()) scopesToCheck.push(entry.name);
      } catch (e) {
        return { totalMatches: 0, items: [] };
      }
    }

    const matched: Array<{ scope: string; id: string; metadata: Record<string, any>; text?: string }> = [];

    for (const s of scopesToCheck) {
      try {
        const idxPath = path.join(this.basePath, s);
        // ensure scope exists
        const exists = await this.scopeExists(s);
        if (!exists) continue;

        // read index.json
        let rawItems: any[] = [];
        try {
          const content = await fs.readFile(path.join(idxPath, 'index.json'), 'utf-8');
          const parsed = JSON.parse(content);
          rawItems = Array.isArray(parsed.items) ? parsed.items : [];
        } catch (readErr) {
          // fallback to vectra listing
          try {
            if (!this.indexes.has(s)) await this.init(s);
            const idx = this.indexes.get(s);
            if (idx) {
              const listed = await idx.queryItems(new Array(768).fill(0), '', 100000);
              rawItems = Array.isArray(listed) ? listed.map((r: any) => r.item || r) : [];
            }
          } catch (qe) {
            continue;
          }
        }

        const items = normalizeIndexItems(rawItems);
        for (const it of items) {
          try {
            if (matchesFilter(it.metadata || {}, filter || {})) {
              matched.push({ scope: s, id: it.id, metadata: it.metadata || {}, text: (it.metadata && it.metadata.text) || '' });
            }
          } catch (_) {
            // ignore matching errors
          }
        }
      } catch (e) {
        // ignore per-scope errors
        continue;
      }
    }

    const totalMatches = matched.length;
    const paged = matched.slice(offset, offset + limit);
    return { totalMatches, items: paged };
  }

  /**
   * Get statistics about the store
   */
  async getStats(): Promise<{
    totalScopes: number;
    scopes: Array<{ scope: string; count: number; sizeOnDisk: number; lastUpdated?: string }>;
  }> {
    try {
      const scopes: Array<{ scope: string; count: number; sizeOnDisk: number; lastUpdated?: string }> = [];

      // List all directories in base path
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const scopeName = entry.name;
        // Determine count without initializing or loading the vectra index to avoid
        // creating or mutating scopes when merely requesting diagnostics.
        let count = 0;
        try {
          const indexJsonPath = path.join(this.basePath, scopeName, 'index.json');
          const content = await fs.readFile(indexJsonPath, 'utf-8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed.items)) count = parsed.items.length;
        } catch (e) {
          // If index.json doesn't exist or can't be read, fall back to 0 without initializing the scope
          count = 0;
        }

        // Calculate approximate on-disk size and last updated timestamp for the scope
        let sizeOnDisk = 0;
        let lastUpdated: string | undefined;
        try {
          const scopePath = path.join(this.basePath, scopeName);
          const stack: string[] = [scopePath];
          while (stack.length) {
            const p = stack.pop() as string;
            const stat = await fs.stat(p);
            if (stat.isDirectory()) {
              const children = await fs.readdir(p);
              for (const c of children) stack.push(path.join(p, c));
            } else if (stat.isFile()) {
              sizeOnDisk += stat.size || 0;
              const m = stat.mtime?.toISOString();
              if (!lastUpdated || (m && m > lastUpdated)) lastUpdated = m;
            }
          }
        } catch (e) {
          // ignore filesystem errors for stats
        }

        scopes.push({ scope: scopeName, count, sizeOnDisk, lastUpdated });
      }

      return {
        totalScopes: scopes.length,
        scopes
      };
    } catch (error) {
      vectraStoreLog('[VECTOR_STORE] Failed to get stats:', error);
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
