/**
 * Embedding Manager - Handles local embedding generation via @xenova/transformers
 * Uses ONNX-exported sentence transformers for offline embeddings
 */

import { pipeline, env } from '@xenova/transformers';

// Configure transformers to cache models locally
env.localModelPath = './vector_models';
env.allowRemoteModels = true;
env.allowLocalModels = true;

interface EmbeddingPipeline {
  (text: string | string[]): Promise<{ data: number[][] }>;
}

class EmbeddingManager {
  private static instance: EmbeddingManager;
  private embeddingPipeline: EmbeddingPipeline | null = null;
  private isInitializing = false;
  private modelName: string;

  private constructor(modelName: string = 'Xenova/all-mpnet-base-v2') {
    this.modelName = modelName;
  }

  static getInstance(modelName?: string): EmbeddingManager {
    if (!EmbeddingManager.instance) {
      EmbeddingManager.instance = new EmbeddingManager(modelName);
    }
    return EmbeddingManager.instance;
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
      console.log(`[EMBEDDING] Initializing ${this.modelName}...`);
      this.embeddingPipeline = await pipeline(
        'feature-extraction',
        this.modelName
      ) as unknown as EmbeddingPipeline;
      console.log(`[EMBEDDING] Initialized ${this.modelName}`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Generate embeddings for text(s)
   * Returns normalized vectors (L2 normalized)
   * 
   * @param text - Single text or array of texts to embed
   * @returns Array of vectors (768-1024 dimensions depending on model)
   */
  async embed(text: string | string[]): Promise<number[][]> {
    if (!this.embeddingPipeline) {
      await this.initialize();
    }

    if (!this.embeddingPipeline) {
      throw new Error('Failed to initialize embedding pipeline');
    }

    try {
      const result = await this.embeddingPipeline(text);
      const vectors: number[][] = result.data;

      // Vectors are already L2 normalized by the model
      // Return as array of arrays
      if (Array.isArray(text)) {
        return vectors;
      } else {
        return [vectors[0]];
      }
    } catch (error) {
      console.error('[EMBEDDING] Error generating embeddings:', error);
      throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a single embedding vector for text
   * Convenience method for single text
   */
  async embedText(text: string): Promise<number[]> {
    const vectors = await this.embed(text);
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
  static chunkText(text: string, chunkSize: number = 1000): string[] {
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
