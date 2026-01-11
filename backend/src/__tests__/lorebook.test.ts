import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import LorebookService from '../services/LorebookService';

let createdUuid: string | null = null;
let createdEntryId: number | null = null;

describe('LorebookService', () => {
  it('creates a lorebook', () => {
    const lb = (LorebookService as any).createLorebook({ name: 'Test LB', description: 'desc' });
    expect(lb).toBeDefined();
    expect(lb.uuid).toBeDefined();
    createdUuid = lb.uuid;
  });

  it('adds an entry and assigns sequential uid', () => {
    if (!createdUuid) throw new Error('missing lorebook uuid');
    const entry = (LorebookService as any).addEntry(createdUuid, { key: ['test'], content: 'Some lore content' });
    expect(entry).toBeDefined();
    expect(entry.uid).toBeGreaterThan(0);
    createdEntryId = entry.id;
  });

  it('retrieves entries for lorebook', () => {
    if (!createdUuid) throw new Error('missing lorebook uuid');
    const entries = (LorebookService as any).getEntries(createdUuid);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('updates an entry', () => {
    if (!createdUuid || !createdEntryId) throw new Error('missing ids');
    const updated = (LorebookService as any).updateEntry(createdUuid, createdEntryId, { content: 'Updated content' });
    expect(updated).toBeDefined();
    expect(updated.content).toBe('Updated content');
  });

  it('deletes the entry', () => {
    if (!createdUuid || !createdEntryId) throw new Error('missing ids');
    const res = (LorebookService as any).deleteEntry(createdUuid, createdEntryId);
    expect(res.changes).toBeGreaterThanOrEqual(1);
  });

  it('deletes the lorebook and cleans references', () => {
    if (!createdUuid) throw new Error('missing lorebook uuid');
    const res = (LorebookService as any).deleteLorebook(createdUuid);
    expect(res.deleted).toBe(true);
  });
});
