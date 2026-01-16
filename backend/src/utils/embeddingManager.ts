/**
 * Embedding Manager - Handles local embedding generation via @xenova/transformers
 * Uses ONNX-exported sentence transformers for offline embeddings
 */

import { pipeline, env } from '@xenova/transformers';
import { ConfigManager } from '../configManager';
import OpenAI from 'openai';
import axios from 'axios';

// Configure transformers to cache models locally
env.localModelPath = './vector_models';
env.allowRemoteModels = true;
env.allowLocalModels = true;

interface EmbeddingPipeline {
  (text: string | string[]): Promise<{ data: number[][] }>;
}

class EmbeddingManager {
  private static instances: Map<string, EmbeddingManager> = new Map();
  private embeddingPipeline: EmbeddingPipeline | null = null;
  private isInitializing = false;
  private modelName: string;
  private provider: string;
  private openaiClient: OpenAI | null = null;
  private ollamaBaseUrl: string | null = null;

  private constructor(provider: string = 'transformers', modelName: string = 'Xenova/all-mpnet-base-v2') {
    this.provider = provider;
    this.modelName = modelName;
  }

  /**
   * Read default chunk size from vector config if present
   */
  static getDefaultChunkSize(): number {
    try {
      const cfg = new ConfigManager();
      const vectorCfg = cfg.getVectorConfig();
      if (vectorCfg && typeof vectorCfg.chunkSize === 'number') return vectorCfg.chunkSize;
    } catch (e) {
      // ignore and fall back to default
    }
    return 1000;
  }

  static getInstance(provider?: string, modelName?: string): EmbeddingManager {
    // Prefer explicit args; fall back to vector config if present, then to defaults
    let cfg: any = {};
    try {
      const cm = new ConfigManager();
      if (cm && typeof cm.getVectorConfig === 'function') cfg = cm.getVectorConfig() || {};
    } catch (e) {
      try {
        // Support cases where tests mock ConfigManager as a factory or object
        if (typeof (ConfigManager as any).getVectorConfig === 'function') {
          cfg = (ConfigManager as any).getVectorConfig() || {};
        } else if (typeof (ConfigManager as any) === 'function') {
          const maybe = (ConfigManager as any)();
          if (maybe && typeof maybe.getVectorConfig === 'function') cfg = maybe.getVectorConfig() || {};
        }
      } catch (_err) {
        // ignore and fall back to defaults
      }
    }

    const p = provider || cfg.embeddingProvider || 'transformers';
    const m = modelName || cfg.embeddingModel || 'Xenova/all-mpnet-base-v2';
    const key = `${p}:${m}`;
    if (!EmbeddingManager.instances.has(key)) {
      EmbeddingManager.instances.set(key, new EmbeddingManager(p, m));
    }
    return EmbeddingManager.instances.get(key)!;
  }

  /**
   * Reset in-memory instances (useful for tests to avoid cross-test singleton leakage)
   */
  static resetInstances(): void {
    EmbeddingManager.instances.forEach((inst) => {
      try {
        // If a provider-specific client needs shutdown in future, do it here.
      } catch (_) {
        // ignore
      }
    });
    EmbeddingManager.instances.clear();
  }

  /**
   * Initialize the embedding pipeline (lazy loading)
   * First call: ~2-5 seconds and downloads model (~500MB)
   * Subsequent calls: ~100-200ms for embeddings
   */
  async initialize(): Promise<void> {
    if (this.embeddingPipeline) {
      return; // Already initialized
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.isInitializing = true;
    try {
      const cfg = new ConfigManager().getVectorConfig() || {};
      if (this.provider === 'transformers') {
        console.log(`[EMBEDDING] Initializing transformers model ${this.modelName}...`);
        this.embeddingPipeline = await pipeline('feature-extraction', this.modelName) as unknown as EmbeddingPipeline;
        console.log(`[EMBEDDING] Initialized transformers ${this.modelName}`);
      } else if (this.provider === 'openai') {
        const apiKey = cfg?.apiKeys?.openai || process.env.OPENAI_API_KEY;
        // Allow specifying baseURL in vector config for enterprise or proxy setups
        const baseURL = cfg?.apiKeys?.openaiBaseUrl || cfg?.openaiBaseUrl || undefined;
        this.openaiClient = new OpenAI({ apiKey, baseURL });
        console.log('[EMBEDDING] OpenAI client initialized');
      } else if (this.provider === 'ollama') {
        this.ollamaBaseUrl = cfg?.ollamaBaseUrl || 'http://localhost:11434';
        console.log('[EMBEDDING] Ollama base URL set to', this.ollamaBaseUrl);
      } else {
        // Unknown provider - fallback to transformers
        console.log(`[EMBEDDING] Unknown provider ${this.provider}, falling back to transformers`);
        this.embeddingPipeline = await pipeline('feature-extraction', this.modelName) as unknown as EmbeddingPipeline;
      }
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generate embeddings for text(s)
   * Returns normalized vectors (L2 normalized)
   * 
   * IMPORTANT: The pipeline returns a Tensor object with:
   * - result.dims: array dimensions (e.g., [batch_size, num_tokens, embedding_dim])
   * - result.data: Float32Array containing all values flattened
   * 
   * For single text: dims = [1, num_tokens, 768]
   * We need to extract and pool token embeddings to get one 768-dim vector
   * 
   * @param text - Single text or array of texts to embed
   * @returns Array of vectors (768 dimensions for Xenova/all-mpnet-base-v2)
   */
  async embed(text: string | string[]): Promise<number[][]> {
    // Ensure initialization for selected provider
    await this.initialize();

    try {
      if (this.provider === 'transformers') {
        if (!this.embeddingPipeline) throw new Error('Transformers pipeline not initialized');
        const result = await this.embeddingPipeline(text) as any;
        if (!result.dims || !result.data) throw new Error('Invalid tensor output from embedding pipeline');

        const dims = result.dims as number[];
        const flatData = result.data as Float32Array;
        const batchSize = dims[0];
        const numTokens = dims[1];
        const embeddingDim = dims[2];
        const vectors: number[][] = [];
        for (let b = 0; b < batchSize; b++) {
          const pooledVector: number[] = new Array(embeddingDim).fill(0);
          for (let t = 0; t < numTokens; t++) {
            for (let d = 0; d < embeddingDim; d++) {
              const flatIndex = b * (numTokens * embeddingDim) + t * embeddingDim + d;
              pooledVector[d] += flatData[flatIndex];
            }
          }
          for (let d = 0; d < embeddingDim; d++) pooledVector[d] /= numTokens;
          let norm = 0;
          for (let d = 0; d < embeddingDim; d++) norm += pooledVector[d] * pooledVector[d];
          norm = Math.sqrt(norm) || 1;
          for (let d = 0; d < embeddingDim; d++) pooledVector[d] = pooledVector[d] / norm;
          vectors.push(pooledVector);
        }
        return vectors;
      }

      if (this.provider === 'openai') {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');
        const inputs = Array.isArray(text) ? text : [text];
        // Use retry wrapper for transient network errors / rate limits
        const resp: any = await this.requestWithRetry(async () => {
          return await this.openaiClient!.embeddings.create({ model: this.modelName, input: inputs });
        });
        // Support multiple possible shapes returned by SDKs/mocks:
        // - resp.data -> array of { embedding }
        // - resp.data.data -> array of { embedding }
        // - resp -> array of { embedding } (mocked server returned array)
        let data: any = resp?.data;
        if (!Array.isArray(data) && data && Array.isArray(data.data)) data = data.data;
        if (!Array.isArray(data) && Array.isArray(resp)) data = resp;
        if (!Array.isArray(data)) data = [];
        const vectors: number[][] = data.map((d: any) => {
          const emb = d?.embedding || d?.vector || d;
          return Array.isArray(emb) ? emb.map((n: any) => Number(n)) : [];
        });
        // normalize
        for (const v of vectors) {
          let norm = 0;
          for (const x of v) norm += x * x;
          norm = Math.sqrt(norm) || 1;
          for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
        }
        return vectors;
      }

      if (this.provider === 'ollama') {
        const cfg = new ConfigManager().getVectorConfig() || {};
        const base = this.ollamaBaseUrl || cfg?.ollamaBaseUrl || 'http://localhost:11434';
        const inputs = Array.isArray(text) ? text : [text];
        // Attempt to call Ollama embeddings endpoint with retries
        const resp = await this.requestWithRetry(async () => {
          return await axios.post(`${base}/embeddings`, { model: this.modelName, input: inputs }, { timeout: 10000 });
        });
        const data = resp.data?.data || resp.data?.embedding || [];
        const vectors: number[][] = Array.isArray(data[0]) ? data : [data];
        // normalize
        for (const v of vectors) {
          let norm = 0;
          for (const x of v) norm += x * x;
          norm = Math.sqrt(norm) || 1;
          for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
        }
        return vectors;
      }

      throw new Error(`Unsupported provider: ${this.provider}`);
    } catch (error) {
      console.error('[EMBEDDING] Error generating embeddings:', error);
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Simple retry wrapper with exponential backoff for transient errors */
  private async requestWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4, baseDelay = 200): Promise<T> {
    let attempt = 0;
    let lastErr: any = null;
    while (attempt < maxAttempts) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const isRetryable = !e || (e.code && ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(e.code))
          || (e.response && [429, 500, 502, 503, 504].includes(e.response.status));
        attempt++;
        if (!isRetryable || attempt >= maxAttempts) break;
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr || new Error('requestWithRetry failed');
  }

  /**
   * Generate a single embedding vector for text
   * Convenience method for single text - returns a proper 768-dim array
   */
  async embedText(text: string): Promise<number[]> {
    const vectors = await this.embed(text);
    if (vectors.length === 0) {
      throw new Error('No vectors generated from embedding');
    }
    return vectors[0];
  }

  /**
   * Chunk text into smaller pieces for embedding
   * Ensures chunks are approximately the right size for the model
   * 
   * @param text - Text to chunk
   * @param chunkSize - Approximate number of characters per chunk (default: 1000)
   * @returns Array of text chunks
   */
  static chunkText(text: string, chunkSize: number = EmbeddingManager.getDefaultChunkSize()): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Calculate cosine similarity between two vectors
   * Used for post-processing query results
   */
  static cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vec1.length; i++) {
      const a = vec1[i] || 0;
      const b = vec2[i] || 0;
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    normA = Math.sqrt(normA) || 1;
    normB = Math.sqrt(normB) || 1;

    const sim = dotProduct / (normA * normB);
    // Diagnostic: warn if raw value is noticeably out of [-1,1]
    if (sim > 1.000001 || sim < -1.000001) {
      console.warn('[EMBEDDING] cosine similarity out of bounds', { dotProduct, normA, normB, raw: sim });
    }
    // Clamp to valid cosine range to avoid small floating point overshoot
    if (sim > 1) return 1;
    if (sim < -1) return -1;
    return sim;
  }

  /**
   * Get info about the current model
   */
  getModelInfo(): { modelName: string; initialized: boolean } {
    return {
      modelName: this.modelName,
      initialized: this.embeddingPipeline !== null
    };
  }
}

export default EmbeddingManager;
