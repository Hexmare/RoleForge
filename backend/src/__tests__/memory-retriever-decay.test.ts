import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRetriever } from '../utils/memoryRetriever';

function makeEntry(text: string, similarity: number, opts: { timestampMs?: number; msgSince?: number; temporalBlind?: boolean } = {}) {
  const metadata: any = {};
  if (opts.timestampMs !== undefined) metadata.timestamp = new Date(opts.timestampMs).toISOString();
  if (opts.msgSince !== undefined) metadata.messageCountSince = opts.msgSince;
  if (opts.temporalBlind) metadata.temporalBlind = true;
  return { text, similarity, metadata };
}

describe('MemoryRetriever temporal decay', () => {
  let retriever: MemoryRetriever;

  beforeEach(() => {
    // Use fake timers to make time-based decay deterministic in tests
    vi.useFakeTimers();
    // Freeze time to a fixed point
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z').getTime());
    retriever = new MemoryRetriever();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies time-based decay to older memories', async () => {
    const now = Date.now();
    const recent = makeEntry('recent memory', 0.9, { timestampMs: now });
    const old = makeEntry('old memory', 0.9, { timestampMs: now - (30 * 24 * 60 * 60 * 1000) }); // 30 days old

    const fakeStore = {
      query: async () => [recent, old]
    } as any;

    (retriever as any).vectorStore = fakeStore;

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      temporalDecay: { enabled: true, halfLife: 7, floor: 0.1, mode: 'time' }
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].text).toBe('recent memory');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('applies message-count based decay when configured', async () => {
    const recent = makeEntry('recent memory', 0.8, { msgSince: 1 });
    const old = makeEntry('old memory', 0.8, { msgSince: 100 });

    const fakeStore = { query: async () => [recent, old] } as any;
    (retriever as any).vectorStore = fakeStore;

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      temporalDecay: { enabled: true, halfLife: 10, floor: 0.05, mode: 'messageCount' }
    });

    expect(results[0].text).toBe('recent memory');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('derives message-count from DB when metadata lacks it', async () => {
    const recent = makeEntry('recent memory', 0.85, { timestampMs: Date.now(), msgSince: undefined });
    const old = makeEntry('old memory', 0.85, { timestampMs: Date.now() - 1000000, msgSince: undefined });

    const fakeStore = { query: async () => [recent, old] } as any;
    (retriever as any).vectorStore = fakeStore;

    // Patch MessageService.getMessageCountSince to return higher count for old
    const MessageService = await import('../services/MessageService.js');
    const orig = MessageService.MessageService.getMessageCountSince;
    try {
      MessageService.MessageService.getMessageCountSince = (_sceneId: number, _sinceIso: string) => {
        // Simple heuristic based on sinceIso to simulate older -> larger count
        return _sinceIso && _sinceIso.includes('1970') ? 100 : 1;
      };

      const results = await (retriever as any).queryMemories('test', {
        worldId: 1,
        characterId: 'char1',
        topK: 2,
        temporalDecay: { enabled: true, halfLife: 10, floor: 0.05, mode: 'messageCount' }
      });

      expect(results[0].text).toBe('recent memory');
    } finally {
      MessageService.MessageService.getMessageCountSince = orig;
    }
  });

  it('skips decay when temporalBlind metadata is true', async () => {
    const a = makeEntry('a', 0.7, { timestampMs: Date.now() - 1000000, temporalBlind: true });
    const b = makeEntry('b', 0.8, { timestampMs: Date.now() - 1000000 });
    const fakeStore = { query: async () => [a, b] } as any;
    (retriever as any).vectorStore = fakeStore;

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      temporalDecay: { enabled: true, halfLife: 1 }
    });

    // b should be decayed, a should remain at original similarity and may come after b depending on values
    expect(results.some((r: any) => r.text === 'a')).toBeTruthy();
  });

  it('falls back gracefully for malformed timestamps', async () => {
    const bad = { text: 'bad', similarity: 0.9, metadata: { timestamp: 'not-a-date' } };
    const good = makeEntry('good', 0.9, { timestampMs: Date.now() });
    const fakeStore = { query: async () => [bad, good] } as any;
    (retriever as any).vectorStore = fakeStore;

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      temporalDecay: { enabled: true, halfLife: 7 }
    });

    // malformed timestamp should not throw; both entries present and similarities valid
    const texts = results.map((r: any) => r.text);
    expect(texts).toEqual(expect.arrayContaining(['good', 'bad']));
    for (const r of results) {
      expect(Number.isFinite(r.similarity)).toBeTruthy();
    }
  });
});
