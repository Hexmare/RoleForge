import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTimestampToMs,
  getAgeMsFromMetadata,
  computeDecayAdjustedScore,
  matchesFilter,
  normalizeIndexItems
} from '../utils/memoryHelpers';

describe('memoryHelpers - parseTimestampToMs & age', () => {
  const NOW = 1670000000000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('parses ISO, epoch string, number and Date correctly', () => {
    const iso = new Date(NOW).toISOString();
    expect(parseTimestampToMs(iso)).toBe(NOW);
    expect(parseTimestampToMs(String(NOW))).toBe(NOW);
    expect(parseTimestampToMs(NOW)).toBe(NOW);
    expect(parseTimestampToMs(new Date(NOW))).toBe(NOW);
    expect(Number.isNaN(parseTimestampToMs('not-a-date'))).toBe(true);
  });

  it('computes age from metadata using timestamp', () => {
    const metadata = { timestamp: String(NOW - 5000) };
    const age = getAgeMsFromMetadata(metadata);
    expect(age).toBe(5000);
  });
});

describe('computeDecayAdjustedScore', () => {
  const NOW = 1670000000000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('applies time-based decay correctly', async () => {
    const halfLifeDays = 1; // 1 day half-life
    const decayCfg = { enabled: true, mode: 'time', halfLife: halfLifeDays, floor: 0 };
    // create a timestamp exactly one half-life ago
    const ts = new Date(NOW - (halfLifeDays * 24 * 60 * 60 * 1000)).toISOString();
    const score = await computeDecayAdjustedScore(1.0, { timestamp: ts }, decayCfg);
    // Expect approximately 0.5
    expect(score).toBeGreaterThan(0.49);
    expect(score).toBeLessThan(0.51);
  });

  it('uses messageCount mode with messageServiceOverride fallback', async () => {
    const decayCfg = { enabled: true, mode: 'messageCount', halfLife: 5, floor: 0 };
    const metadata = { sceneId: 1, timestamp: String(Date.now()) };
    const fakeMsgSvc = { getMessageCountSince: async () => 10 };
    const score = await computeDecayAdjustedScore(1.0, metadata, decayCfg, fakeMsgSvc as any);
    // rawFactor = 0.5^(10/5) = 0.25
    expect(score).toBeCloseTo(0.25, 6);
  });
});

describe('matchesFilter & normalizeIndexItems', () => {
  it('matches exact and substring with nested fields and case insensitivity', () => {
    const metadata = { meta: { keywords: 'Silver Sword' }, name: 'Alice' };
    expect(matchesFilter(metadata, { 'meta.keywords': 'Silver' }, { matchType: 'substring', caseInsensitive: true })).toBe(true);
    expect(matchesFilter(metadata, { name: 'Alice' }, { matchType: 'exact' })).toBe(true);
    expect(matchesFilter(metadata, { name: 'alice' }, { matchType: 'exact', caseInsensitive: true })).toBe(true);
    expect(matchesFilter(metadata, { 'meta.keywords': 'Gold' }, { matchType: 'substring' })).toBe(false);
  });

  it('normalizes various index item shapes', () => {
    const raw = [
      { id: 'a1', metadata: { k: 1 } },
      { item: { id: 'b2', metadata: { k: 2 } } },
      { item: { item: { id: 'c3', metadata: { k: 3 } } } },
      { foo: 'bar' }
    ];
    const norm = normalizeIndexItems(raw as any);
    const ids = norm.map(x => x.id).sort();
    expect(ids).toEqual(['a1', 'b2', 'c3']);
  });
});
