import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectraVectorStore } from '../stores/VectraVectorStore.js';
import EmbeddingManager from '../utils/embeddingManager.js';
import fs from 'fs/promises';
import path from 'path';

// This test verifies deleteByMetadata removes only items matching metadata in the given scope
describe('Vector Store - deleteByMetadata (metadata-specific) v2', () => {
  const TEST_VECTOR_BASE_PATH = `./vector_data_test_metadata_${process.pid}`;
  let store: VectraVectorStore;

  beforeEach(async () => {
    EmbeddingManager.resetInstances();
    store = new VectraVectorStore(TEST_VECTOR_BASE_PATH);
  });

  afterEach(async () => {
    try {
      const basePath = path.join(TEST_VECTOR_BASE_PATH);
      const files = await fs.readdir(basePath);
      for (const file of files) {
        if (file.startsWith('test_scope_metadata_') || file.startsWith('test_scope_')) {
          await fs.rm(path.join(basePath, file), { recursive: true, force: true });
        }
      }
    } catch (e) {
      // ignore
    }
  });

  it('deletes only matching items in a scope when confirm=true', async () => {
    const scope = 'test_scope_metadata_1';

    // Add items with different metadata
    await store.addMemory('m1', 'keep me', { tag: 'keep', owner: 'alice' }, scope);
    await store.addMemory('m2', 'delete me', { tag: 'remove', owner: 'bob' }, scope);
    await store.addMemory('m3', 'also keep', { tag: 'keep', owner: 'charlie' }, scope);

    // Sanity: ensure items added (use listByMetadata to enumerate all items in scope)
    const { items: allBefore } = await store.listByMetadata({}, scope, { limit: 100 });
    expect(allBefore.length).toBeGreaterThanOrEqual(3);

    // Delete items where metadata.owner == 'bob'
    await store.deleteByMetadata({ owner: 'bob' }, scope, { confirm: true });

    const { items: allAfter } = await store.listByMetadata({}, scope, { limit: 100 });
    const ids = allAfter.map((i: any) => i.id || i.metadata?.id || i.text);

    // m2 should be gone; others should remain
    expect(ids).not.toContain('m2');
    expect(ids).toContain('m1');
    expect(ids).toContain('m3');
  });

  it('does not delete when confirm not passed for large deletes', async () => {
    const scope = 'test_scope_metadata_2';

    // Add 55 items to trigger safety threshold
    for (let i = 0; i < 55; i++) {
      await store.addMemory(`x${i}`, `item ${i}`, { group: 'bulk', index: i }, scope);
    }

    // Attempt delete without confirm should throw
    let threw = false;
    try {
      await store.deleteByMetadata({ group: 'bulk' }, scope);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBeTruthy();

    // Now delete with confirm should succeed
    await store.deleteByMetadata({ group: 'bulk' }, scope, { confirm: true });
    const { items: remaining } = await store.listByMetadata({}, scope, { limit: 100 });
    expect(remaining.length).toBe(0);
  });
});
