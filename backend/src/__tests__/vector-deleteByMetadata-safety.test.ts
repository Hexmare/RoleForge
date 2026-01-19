import { describe, it, expect } from 'vitest';
import { createVectraVectorStore } from '../stores/VectraVectorStore';
import fs from 'fs/promises';
import path from 'path';

describe('deleteByMetadata safety flags', () => {
  const basePath = path.join(process.cwd(), `vector_test_tmp_delete_safety_${process.pid}_${Date.now()}`);
  const scope = 'safety_scope';

  it('dryRun does not delete items', async () => {
    const store = createVectraVectorStore(basePath);
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
    try {
      await store.addMemory('d1', 'to delete', { sceneId: 's1' }, scope);
      await store.addMemory('d2', 'keep', { sceneId: 's2' }, scope);

      const before = await store.getMemoryCount(scope);
      expect(before).toBeGreaterThanOrEqual(2);

      await store.deleteByMetadata({ sceneId: 's1' }, scope, { dryRun: true });

      const after = await store.getMemoryCount(scope);
      expect(after).toBe(before);
    } finally {
      await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('requires confirm for large deletes', async () => {
    const store = createVectraVectorStore(basePath);
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
    try {
      // create many items to exceed default threshold (50)
      for (let i = 0; i < 55; i++) {
        await store.addMemory(`x${i}`, `bulk ${i}`, { tag: 'bulk' }, scope);
      }

      await expect(store.deleteByMetadata({ tag: 'bulk' }, undefined, { confirm: false })).rejects.toThrow();

      // Now confirm
      await store.deleteByMetadata({ tag: 'bulk' }, undefined, { confirm: true });
      const left = await store.getMemoryCount(scope);
      expect(left).toBeLessThan(55);
    } finally {
      await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
    }
  });
});
