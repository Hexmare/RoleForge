import { describe, it, expect, beforeEach, vi } from 'vitest';

// We'll import the runtime module inside tests so dynamic imports used by MemoryRetriever
// (for CharacterService/WorldService) are intercepted by vitest mocks.

vi.mock('../services/CharacterService.js', () => {
  return {
    CharacterService: {
      getAllCharacters: vi.fn(() => [
        { id: 'charA', name: 'Alice' },
        { id: 'charB', name: 'Bob' }
      ])
    }
  };
});

vi.mock('../services/WorldService.js', () => {
  return {
    WorldService: {
      getAll: vi.fn(() => [ { id: 1 }, { id: 2 } ])
    }
  };
});

describe('MemoryRetriever multi-scope queries', () => {
  let retriever: any;

  beforeEach(async () => {
    const mod = await import('../utils/memoryRetriever.js');
    const MemoryRetrieverClass = mod.MemoryRetriever;
    retriever = new MemoryRetrieverClass();

    const now = Date.now();

    const fakeResultsForScope: Record<string, any[]> = {
      'world_1_char_charA': [{ text: 'm1', similarity: 0.9, metadata: { timestamp: now } }],
      'world_1_char_charB': [],
      'world_2_char_charA': [],
      'world_2_char_charB': [{ text: 'm2', similarity: 0.8, metadata: { timestamp: now } }],
      'world_1_multi': [{ text: 'shared1', similarity: 0.7, metadata: { timestamp: now } }],
      'world_2_multi': [{ text: 'shared2', similarity: 0.6, metadata: { timestamp: now } }]
    };

    const fakeVectorStore = {
      query: async (_query: string, scope: string, _topK: number, _minSimilarity: number) => {
        return fakeResultsForScope[scope] || [];
      }
    };

    // Inject the fake vector store into the retriever instance
    (retriever as any).vectorStore = fakeVectorStore;
  });

  it('queries all characters in a world when no character provided', async () => {
    const results = await retriever.queryMemories('hello', { worldId: 1, topK: 10, temporalDecay: { enabled: false } });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const scopes = results.map((r: any) => r.scope);
    expect(scopes).toContain('world_1_char_charA');
    const mem = results.find((r: any) => r.scope === 'world_1_char_charA');
    expect(mem).toBeDefined();
    expect(mem.characterName).toBe('Alice');
  });

  it('queries all worlds and characters and multi-character scopes when no worldId provided', async () => {
    const results = await retriever.queryMemories('hello', { topK: 10, temporalDecay: { enabled: false }, includeMultiCharacter: true });
    const scopes = results.map((r: any) => r.scope);
    expect(scopes).toContain('world_1_char_charA');
    expect(scopes).toContain('world_2_char_charB');
    expect(scopes).toContain('world_1_multi');
    expect(scopes).toContain('world_2_multi');
  });

  it('queries multi-character scope for a provided worldId when includeMultiCharacter is true', async () => {
    const results = await retriever.queryMemories('hello', { worldId: 1, includeMultiCharacter: true, topK: 10, temporalDecay: { enabled: false } });
    const scopes = results.map((r: any) => r.scope);
    expect(scopes).toContain('world_1_multi');
    const shared = results.find((r: any) => r.scope === 'world_1_multi');
    expect(shared).toBeDefined();
    expect(shared.characterName).toBe('shared');
  });
});
