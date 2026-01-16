import { describe, it, expect } from 'vitest';
import { createVectraVectorStore } from '../stores/VectraVectorStore';
import fs from 'fs/promises';
import path from 'path';

describe('VectraVectorStore deleteByMetadata (global)', () => {
  const basePath = path.join(process.cwd(), `vector_test_tmp_delete_global_${process.pid}_${Date.now()}`);
  const scopeA = 'scope_A_global_delete';
  const scopeB = 'scope_B_global_delete';

  it('deletes matching metadata across multiple scopes when no scope provided', async () => {
    const store = createVectraVectorStore(basePath);

    // Clean up any previous runs
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});

    // Add memories into two scopes; both share sceneId 'sharedScene' for one item each
    await store.addMemory('a1', 'alpha one', { sceneId: 'sharedScene', roundId: 'r1' }, scopeA);
    await store.addMemory('a2', 'alpha two', { sceneId: 'uniqueA', roundId: 'r2' }, scopeA);

    await store.addMemory('b1', 'beta one', { sceneId: 'sharedScene', roundId: 'r1' }, scopeB);
    await store.addMemory('b2', 'beta two', { sceneId: 'uniqueB', roundId: 'r2' }, scopeB);

    // Ensure items exist
    const countA_before = await store.getMemoryCount(scopeA);
    const countB_before = await store.getMemoryCount(scopeB);
    expect(countA_before).toBeGreaterThanOrEqual(2);
    expect(countB_before).toBeGreaterThanOrEqual(2);

    // Delete all items with sceneId === 'sharedScene' across all scopes
    await store.deleteByMetadata({ sceneId: 'sharedScene' });

    // Verify counts have decreased appropriately
    const countA_after = await store.getMemoryCount(scopeA);
    const countB_after = await store.getMemoryCount(scopeB);

    expect(countA_after).toBeLessThan(countA_before);
    expect(countB_after).toBeLessThan(countB_before);

    // Ensure non-matching items still exist
    expect(countA_after).toBeGreaterThanOrEqual(1);
    expect(countB_after).toBeGreaterThanOrEqual(1);

    // Clean up
    await fs.rm(basePath, { recursive: true, force: true }).catch(() => {});
  });
});
