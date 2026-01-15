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
    const p = provider || 'transformers';
    const m = modelName || 'Xenova/all-mpnet-base-v2';
    const key = `${p}:${m}`;
    if (!EmbeddingManager.instances.has(key)) {
      EmbeddingManager.instances.set(key, new EmbeddingManager(p, m));
    }
    return EmbeddingManager.instances.get(key)!;
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
        this.openaiClient = new OpenAI({ apiKey });
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
        const resp = await this.openaiClient.embeddings.create({ model: this.modelName, input: inputs });
        const data = (resp as any).data || [];
        const vectors: number[][] = data.map((d: any) => d.embedding.map((n: any) => Number(n)));
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
        // Attempt to call Ollama embeddings endpoint
        const resp = await axios.post(`${base}/embeddings`, { model: this.modelName, input: inputs }, { timeout: 10000 });
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
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }

    // Vectors from @xenova are already L2 normalized, so magnitudes are 1
    return dotProduct;
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
