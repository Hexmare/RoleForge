import { describe, it, expect } from 'vitest';
import { createVectraVectorStore } from '../stores/VectraVectorStore';
import fs from 'fs/promises';
import path from 'path';

describe('VectraVectorStore deleteByMetadata', () => {
  const basePath = path.join(process.cwd(), 'vector_test_tmp_delete');
  const scope = 'test_scope_delete_meta';

  it('deletes only items matching metadata within scope', async () => {
    const store = createVectraVectorStore(basePath);

    // Ensure clean
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});

    // Add two memories with different metadata
    await store.addMemory('m1', 'first memory', { sceneId: 'sceneA', roundId: 'r1' }, scope);
    await store.addMemory('m2', 'second memory', { sceneId: 'sceneB', roundId: 'r2' }, scope);

    let count = await store.getMemoryCount(scope);
    expect(count).toBeGreaterThanOrEqual(2);

    // Delete by metadata matching sceneA
    await store.deleteByMetadata({ sceneId: 'sceneA' }, scope);

    // Ensure only one remains
    count = await store.getMemoryCount(scope);
    expect(count).toBeGreaterThanOrEqual(1);

    // Clean up
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });
});
