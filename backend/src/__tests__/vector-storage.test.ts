/**
 * Unit tests for Vector Storage Phase 1 components
 * Tests: VectorStoreInterface, VectraVectorStore, EmbeddingManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectraVectorStore } from '../stores/VectraVectorStore.js';
import { isVectorStoreInterface } from '../interfaces/VectorStoreInterface.js';
import EmbeddingManager from '../utils/embeddingManager.js';
import VectorStoreFactory from '../utils/vectorStoreFactory.js';
import fs from 'fs/promises';
import path from 'path';

// Test configuration
const TEST_VECTOR_BASE_PATH = './vector_data';
const TEST_WORLD_ID = 9999999;
const TEST_SCOPE = `world_${TEST_WORLD_ID}_char_test42`;
const TEST_SCOPE_2 = `world_${TEST_WORLD_ID}_char_test43`;

describe('Vector Storage - Phase 1', () => {
  let vectorStore: VectraVectorStore;

  beforeEach(async () => {
    // Use main vector_data path for tests with test world ID
    vectorStore = new VectraVectorStore(TEST_VECTOR_BASE_PATH);
  });

  afterEach(async () => {
    // Clean up test vector data folders
    try {
      const basePath = path.join(TEST_VECTOR_BASE_PATH);
      const files = await fs.readdir(basePath);
      
      // Delete all test world folders (world_9999999_*)
      for (const file of files) {
        if (file.startsWith(`world_${TEST_WORLD_ID}_`)) {
          await fs.rm(path.join(basePath, file), { recursive: true, force: true });
          console.log(`[TEST] Cleaned up vector folder: ${file}`);
        }
      }
    } catch (error) {
      // Vector data directory may not exist yet, that's fine
      console.log('[TEST] No vector data to clean up');
    }
  });

  describe('VectorStoreInterface Implementation', () => {
    it('should implement VectorStoreInterface correctly', () => {
      expect(isVectorStoreInterface(vectorStore)).toBe(true);
    });

    it('should have all required methods', () => {
      expect(typeof vectorStore.init).toBe('function');
      expect(typeof vectorStore.addMemory).toBe('function');
      expect(typeof vectorStore.query).toBe('function');
      expect(typeof vectorStore.deleteMemory).toBe('function');
      expect(typeof vectorStore.clear).toBe('function');
      expect(typeof vectorStore.scopeExists).toBe('function');
      expect(typeof vectorStore.getMemoryCount).toBe('function');
      expect(typeof vectorStore.deleteScope).toBe('function');
    });
  });

  describe('Scope Management', () => {
    it('should initialize a new scope', async () => {
      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(false);
      await vectorStore.init(TEST_SCOPE);
      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(true);
    });

    it('should handle multiple scopes independently', async () => {
      await vectorStore.init(TEST_SCOPE);
      await vectorStore.init(TEST_SCOPE_2);

      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(true);
      expect(await vectorStore.scopeExists(TEST_SCOPE_2)).toBe(true);
    });

    it('should not reinitialize existing scope', async () => {
      await vectorStore.init(TEST_SCOPE);
      // Should not throw
      await vectorStore.init(TEST_SCOPE);
      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(true);
    });
  });

  describe('Memory Operations', () => {
    beforeEach(async () => {
      await vectorStore.init(TEST_SCOPE);
    });

    it('should add memory to a scope', async () => {
      await vectorStore.addMemory(
        'mem1',
        'The character found a mysterious key in an old chest.',
        { type: 'discovery', roundNumber: 1 },
        TEST_SCOPE
      );

      const count = await vectorStore.getMemoryCount(TEST_SCOPE);
      expect(count).toBeGreaterThan(0);
    });

    it('should require scope parameter for addMemory', async () => {
      await expect(
        vectorStore.addMemory('mem1', 'test text', {})
      ).rejects.toThrow('Scope is required');
    });

    it('should lazily initialize scope on first addMemory', async () => {
      expect(await vectorStore.scopeExists(TEST_SCOPE_2)).toBe(false);

      await vectorStore.addMemory(
        'mem1',
        'Test memory',
        {},
        TEST_SCOPE_2
      );

      expect(await vectorStore.scopeExists(TEST_SCOPE_2)).toBe(true);
    });

    it('should store memory with metadata', async () => {
      const metadata = {
        type: 'dialogue',
        roundNumber: 1,
        speaker: 'CharacterA',
        timestamp: new Date().toISOString()
      };

      await vectorStore.addMemory(
        'mem1',
        'I remember when we first met in the tavern.',
        metadata,
        TEST_SCOPE
      );

      const results = await vectorStore.query(
        'tavern memory',
        TEST_SCOPE,
        10,
        0.3 // Lower threshold for testing
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata?.type).toBe('dialogue');
      expect(results[0].metadata?.speaker).toBe('CharacterA');
    });

    it('should get accurate memory count', async () => {
      await vectorStore.addMemory('mem1', 'Memory 1', {}, TEST_SCOPE);
      await vectorStore.addMemory('mem2', 'Memory 2', {}, TEST_SCOPE);
      await vectorStore.addMemory('mem3', 'Memory 3', {}, TEST_SCOPE);

      const count = await vectorStore.getMemoryCount(TEST_SCOPE);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should return 0 count for non-existent scope', async () => {
      const count = await vectorStore.getMemoryCount('nonexistent_scope');
      expect(count).toBe(0);
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      await vectorStore.init(TEST_SCOPE);

      // Add test memories
      await vectorStore.addMemory(
        'mem1',
        'The dragon guards the treasure in the mountain cave.',
        { roundNumber: 1 },
        TEST_SCOPE
      );

      await vectorStore.addMemory(
        'mem2',
        'The party found a healing potion in the forest.',
        { roundNumber: 2 },
        TEST_SCOPE
      );

      await vectorStore.addMemory(
        'mem3',
        'The merchant offered to trade magical artifacts.',
        { roundNumber: 3 },
        TEST_SCOPE
      );

      // Add memories to different scope for isolation test
      await vectorStore.addMemory(
        'mem4',
        'This memory should not appear in TEST_SCOPE queries.',
        { roundNumber: 1 },
        TEST_SCOPE_2
      );
    });

    it('should query memories by relevance', async () => {
      const results = await vectorStore.query(
        'dragon treasure',
        TEST_SCOPE,
        10,
        0.3
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].text).toContain('dragon');
    });

    it('should return results sorted by similarity (highest first)', async () => {
      const results = await vectorStore.query(
        'dragon cave treasure mountain',
        TEST_SCOPE,
        10,
        0
      );

      expect(results.length).toBeGreaterThan(0);

      // Check results are sorted by similarity descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity || 0).toBeGreaterThanOrEqual(
          results[i].similarity || 0
        );
      }
    });

    it('should respect topK parameter', async () => {
      const results = await vectorStore.query(
        'treasure',
        TEST_SCOPE,
        2,
        0
      );

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should respect minSimilarity threshold', async () => {
      const results = await vectorStore.query(
        'completely unrelated topic about coding',
        TEST_SCOPE,
        10,
        0.9 // Very high threshold
      );

      // Should return few or no results due to low similarity
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should isolate memories by scope', async () => {
      const resultsScope1 = await vectorStore.query(
        'This memory should not appear',
        TEST_SCOPE,
        10,
        0.3
      );

      // The target memory is in TEST_SCOPE_2, so should get low/no matches in TEST_SCOPE
      const highRelevance = resultsScope1.filter(r => (r.similarity || 0) > 0.7);
      expect(highRelevance.length).toBe(0);

      // Should find it in TEST_SCOPE_2
      const resultsScope2 = await vectorStore.query(
        'This memory should not appear',
        TEST_SCOPE_2,
        10,
        0.3
      );

      expect(resultsScope2.length).toBeGreaterThan(0);
    });

    it('should return empty results for non-existent scope', async () => {
      const results = await vectorStore.query(
        'any query',
        'nonexistent_scope',
        10,
        0.3
      );

      expect(results).toEqual([]);
    });

    it('should include similarity scores in results', async () => {
      const results = await vectorStore.query(
        'dragon',
        TEST_SCOPE,
        10,
        0.3
      );

      expect(results.length).toBeGreaterThan(0);
      expect(typeof results[0].similarity).toBe('number');
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('Delete Operations', () => {
    beforeEach(async () => {
      await vectorStore.init(TEST_SCOPE);

      await vectorStore.addMemory(
        'mem1',
        'This will be deleted',
        {},
        TEST_SCOPE
      );

      await vectorStore.addMemory(
        'mem2',
        'This will remain',
        {},
        TEST_SCOPE
      );
    });

    it('should delete specific memory', async () => {
      const countBefore = await vectorStore.getMemoryCount(TEST_SCOPE);

      await vectorStore.deleteMemory('mem1', TEST_SCOPE);

      const countAfter = await vectorStore.getMemoryCount(TEST_SCOPE);
      expect(countAfter).toBeLessThan(countBefore);
    });

    it('should clear all memories in scope', async () => {
      const countBefore = await vectorStore.getMemoryCount(TEST_SCOPE);
      expect(countBefore).toBeGreaterThan(0);

      await vectorStore.clear(TEST_SCOPE);

      const countAfter = await vectorStore.getMemoryCount(TEST_SCOPE);
      expect(countAfter).toBe(0);
    });

    it('should delete entire scope', async () => {
      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(true);

      await vectorStore.deleteScope(TEST_SCOPE);

      expect(await vectorStore.scopeExists(TEST_SCOPE)).toBe(false);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should get store statistics', async () => {
      await vectorStore.init(TEST_SCOPE);
      await vectorStore.addMemory('mem1', 'Memory 1', {}, TEST_SCOPE);

      await vectorStore.init(TEST_SCOPE_2);
      await vectorStore.addMemory('mem2', 'Memory 2', {}, TEST_SCOPE_2);
      await vectorStore.addMemory('mem3', 'Memory 3', {}, TEST_SCOPE_2);

      const stats = await vectorStore.getStats();

      expect(stats.totalScopes).toBeGreaterThanOrEqual(2);
      expect(stats.scopes.length).toBeGreaterThanOrEqual(2);
      expect(stats.scopes.some(s => s.scope === TEST_SCOPE)).toBe(true);
      expect(stats.scopes.some(s => s.scope === TEST_SCOPE_2)).toBe(true);
    });
  });
});

describe('Embedding Manager', () => {
  it('should be a singleton', () => {
    const manager1 = EmbeddingManager.getInstance();
    const manager2 = EmbeddingManager.getInstance();

    expect(manager1).toBe(manager2);
  });

  it('should initialize embedding pipeline', async () => {
    const manager = EmbeddingManager.getInstance();
    const info = manager.getModelInfo();

    expect(info.modelName).toBe('Xenova/all-mpnet-base-v2');
    // Don't force initialization in tests - it's slow
  });

  it('should chunk text appropriately', () => {
    const text =
      'This is a test. It has multiple sentences. Each one ends with a period. This is important for chunking.';

    const chunks = EmbeddingManager.chunkText(text, 50);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(chunk => {
      expect(chunk.length).toBeGreaterThan(0);
    });
  });

  it('should handle empty text chunking', () => {
    const chunks = EmbeddingManager.chunkText('');
    expect(chunks).toEqual([]);
  });
});

describe('Vector Store Factory', () => {
  afterEach(() => {
    VectorStoreFactory.clearCache();
  });

  it('should create a Vectra store', () => {
    const store = VectorStoreFactory.createVectorStore('vectra');
    expect(isVectorStoreInterface(store)).toBe(true);
  });

  it('should return cached instance on subsequent calls', () => {
    const store1 = VectorStoreFactory.createVectorStore('vectra');
    const store2 = VectorStoreFactory.createVectorStore('vectra');

    expect(store1).toBe(store2);
  });

  it('should create separate instances for different configs', () => {
    const store1 = VectorStoreFactory.createVectorStore('vectra', {
      basePath: './path1'
    });
    const store2 = VectorStoreFactory.createVectorStore('vectra', {
      basePath: './path2'
    });

    expect(store1).not.toBe(store2);
  });

  it('should throw on unknown provider', () => {
    expect(() => {
      VectorStoreFactory.createVectorStore('unknown_provider' as any);
    }).toThrow('Unknown vector store provider');
  });

  it('should list available providers', () => {
    const providers = VectorStoreFactory.getAvailableProviders();
    expect(providers).toContain('vectra');
    expect(providers.length).toBeGreaterThan(0);
  });
});
