import { describe, it, expect } from 'vitest';
import { getNestedField, matchesFilter, computeDecayAdjustedScore } from '../utils/memoryHelpers.js';

describe('memoryHelpers edge cases', () => {
  it('getNestedField returns nested values and undefined when missing', () => {
    const obj = { a: { b: { c: 5 } }, x: 0 };
    expect(getNestedField(obj, 'a.b.c')).toBe(5);
    expect(getNestedField(obj, 'a.b')).toEqual({ c: 5 });
    expect(getNestedField(obj, 'a.b.z')).toBeUndefined();
    expect(getNestedField(null as any, 'a.b')).toBeUndefined();
  });

  it('matchesFilter exact matching (default) and type-sensitive', () => {
    const meta = { sceneId: '42', tag: 'Alpha', nested: { key: 'Value' }, num: 10 };
    expect(matchesFilter(meta, { sceneId: '42' })).toBe(true);
    expect(matchesFilter(meta, { sceneId: 42 as any })).toBe(false);
    // nested field
    expect(matchesFilter(meta, { 'nested.key': 'Value' })).toBe(true);
    expect(matchesFilter(meta, { tag: 'alpha' })).toBe(false);
  });

  it('matchesFilter substring and case-insensitive options', () => {
    const meta = { title: 'The Quick Brown Fox', nested: { keywords: 'silver sword' } };
    expect(matchesFilter(meta, { title: 'Quick' }, { matchType: 'substring' })).toBe(true);
    expect(matchesFilter(meta, { title: 'quick' }, { matchType: 'substring' })).toBe(false);
    expect(matchesFilter(meta, { title: 'quick' }, { matchType: 'substring', caseInsensitive: true })).toBe(true);
    expect(matchesFilter(meta, { 'nested.keywords': 'silver' }, { matchType: 'substring' })).toBe(true);
  });

  it('computeDecayAdjustedScore handles messageCount mode with injected messageServiceOverride and large counts', async () => {
    const original = 1.0;
    const metadata = { sceneId: '1', timestamp: new Date().toISOString() };
    const decayCfg = { enabled: true, mode: 'messageCount', halfLife: 10, floor: 1e-6 };

    // Very large message count should apply floor
    const svc = { getMessageCountSince: async () => 1e9 };
    const out = await computeDecayAdjustedScore(original, metadata, decayCfg, svc as any);
    expect(typeof out).toBe('number');
    expect(out).toBeGreaterThanOrEqual(0);
  });

  it('computeDecayAdjustedScore handles zero/negative halfLife and missing metadata gracefully', async () => {
    const original = 0.8;
    // missing timestamp and msgSince: should return original (no decay applied)
    const out1 = await computeDecayAdjustedScore(original, {}, { enabled: true, mode: 'time', halfLife: 0, floor: 0.1 });
    expect(out1).toBe(original);

    // negative halfLife treated like fallback; should not throw
    const metaOld = { timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString() }; // 1 year old
    const out2 = await computeDecayAdjustedScore(original, metaOld, { enabled: true, mode: 'time', halfLife: -5, floor: 0.01 });
    expect(typeof out2).toBe('number');
    expect(out2).toBeGreaterThanOrEqual(0);
  });
});
