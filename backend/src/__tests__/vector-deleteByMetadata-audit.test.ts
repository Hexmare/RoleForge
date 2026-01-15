import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectraVectorStore } from '../stores/VectraVectorStore.js';
import fs from 'fs/promises';
import path from 'path';
import { listAudits, clearAudits } from '../jobs/auditLog.js';

const BASE = './vector_data';
const SCOPE = 'audit_test_scope';

describe('deleteByMetadata audit', () => {
  let store: VectraVectorStore;

  beforeEach(async () => {
    store = new VectraVectorStore(BASE);
    await clearAudits();
    // clean scope
    try {
      await fs.rm(path.join(BASE, SCOPE), { recursive: true, force: true });
    } catch {}
    await store.init(SCOPE);
  });

  afterEach(async () => {
    try {
      await fs.rm(path.join(BASE, SCOPE), { recursive: true, force: true });
    } catch {}
    await clearAudits();
  });

  it('records audit entries for confirmed deletes', async () => {
    // Add matching memories
    await store.addMemory('a1', 'hello', { tag: 'remove' }, SCOPE);
    await store.addMemory('a2', 'world', { tag: 'remove' }, SCOPE);
    await store.addMemory('b1', 'keep', { tag: 'keep' }, SCOPE);

    // Confirmed delete
    await store.deleteByMetadata({ tag: 'remove' }, SCOPE, { confirm: true });

    const audits = listAudits();
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const entry = audits[audits.length - 1];
    expect(entry.filter.tag).toBe('remove');
    expect(entry.deletedCount).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(entry.deletedIds)).toBe(true);
  });
});
