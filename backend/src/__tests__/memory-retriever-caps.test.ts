import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRetriever } from '../utils/memoryRetriever.js';
import { ConfigManager } from '../configManager.js';

describe('MemoryRetriever retrieval caps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clamps topK and truncates query length', async () => {
    const querySpy = vi.fn(async () => [
      { text: 'one', similarity: 0.9, metadata: {} },
      { text: 'two', similarity: 0.8, metadata: {} },
      { text: 'three', similarity: 0.7, metadata: {} },
      { text: 'four', similarity: 0.6, metadata: {} }
    ]);

    vi.spyOn(ConfigManager.prototype, 'getVectorConfig').mockReturnValue({
      memoryCaps: { maxTopK: 3, maxQueryChars: 5 }
    });

    const retriever = new MemoryRetriever();
    (retriever as any).vectorStore = {
      query: querySpy
    };

    const results = await retriever.queryMemories('123456789', {
      worldId: 1,
      characterId: 'c1',
      topK: 10,
      minSimilarity: 0.1
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
    const [passedQuery, , passedTopK] = querySpy.mock.calls[0];
    expect(passedQuery.length).toBe(5);
    expect(passedTopK).toBe(3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
