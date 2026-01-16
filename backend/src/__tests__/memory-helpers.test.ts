import { describe, it, expect } from 'vitest';
import { computeDecayAdjustedScore, applyConditionalBoost, formatMemoriesForPrompt } from '../utils/memoryHelpers.js';

describe('memoryHelpers', () => {
  it('returns same score for malformed timestamp when time decay enabled', async () => {
    const original = 1.0;
    const metadata = { timestamp: 'not-a-date' };
    const cfg = { enabled: true, mode: 'time', halfLife: 7, floor: 0.1 };

    const adjusted = await computeDecayAdjustedScore(original, metadata, cfg);
    expect(adjusted).toBe(original);
  });

  it('applies time-based decay for old timestamp', async () => {
    const original = 1.0;
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const metadata = { timestamp: oldDate };
    const cfg = { enabled: true, mode: 'time', halfLife: 7, floor: 0.01 };

    const adjusted = await computeDecayAdjustedScore(original, metadata, cfg);
    expect(adjusted).toBeLessThan(original);
  });

  it('applies messageCount decay when messageCountSince provided', async () => {
    const original = 1.0;
    const metadata = { messageCountSince: 100 };
    const cfg = { enabled: true, mode: 'messageCount', halfLife: 50, floor: 0.01 };

    const adjusted = await computeDecayAdjustedScore(original, metadata, cfg);
    expect(adjusted).toBeLessThan(original);
  });

  it('uses messageServiceOverride for DB fallback when provided', async () => {
    const original = 1.0;
    const metadata = { sceneId: 123, timestamp: new Date().toISOString() };
    const cfg = { enabled: true, mode: 'messageCount', halfLife: 10, floor: 0.01 };

    const fakeMsgSvc = {
      getMessageCountSince: async (sceneId: number, ts: any) => {
        expect(sceneId).toBe(123);
        return 5; // small number of messages
      }
    };

    const adjusted = await computeDecayAdjustedScore(original, metadata, cfg, fakeMsgSvc);
    expect(adjusted).toBeLessThan(original);
  });

  it('applyConditionalBoost does substring and exact matching correctly', () => {
    const original = 1.0;
    const metadata = { keywords: 'silver sword', nested: { tag: 'Hero' } };
    const rules = [
      { field: 'keywords', match: 'silver', boost: 1.5 },
      { field: 'nested.tag', match: 'hero', boost: 2, matchType: 'exact' }
    ];

    const boosted = applyConditionalBoost(original, metadata, rules);
    // First rule matches (substring) -> x1.5. Second rule exact match (case-insensitive) also matches -> x2
    expect(boosted).toBeCloseTo(3);

    const rules2 = [ { field: 'nested.tag', match: 'Hero', boost: 2, matchType: 'exact' } ];
    const boosted2 = applyConditionalBoost(original, metadata, rules2);
    expect(boosted2).toBeCloseTo(2);
  });

  it('formats memories for prompt correctly', () => {
    const mems = [
      { text: 'Round 1: Hello there', similarity: 0.75 },
      { text: 'Round 2: Another memory', similarity: 0.5 }
    ];

    const out = formatMemoriesForPrompt(mems as any);
    expect(out).toContain('Relevant Memories');
    expect(out).toContain('Hello there');
    expect(out).toContain('[75%]');
  });
});
