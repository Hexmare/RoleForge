import { describe, it, expect, beforeEach } from 'vitest';
import { tokenTelemetry } from '../utils/tokenTelemetry.js';

describe('tokenTelemetry', () => {
  beforeEach(() => {
    tokenTelemetry.clear();
  });

  it('retains only the latest 500 records', () => {
    for (let i = 0; i < 505; i++) {
      tokenTelemetry.record({
        sceneId: 1,
        roundNumber: i,
        timestamp: `t-${i}`,
        sections: { history: i }
      });
    }

    const latest = tokenTelemetry.latest();
    expect(latest.length).toBe(10); // default latest count

    const all = tokenTelemetry.latest(600);
    expect(all.length).toBe(500);
    expect(all[0].roundNumber).toBe(5); // first five evicted
    expect(all[all.length - 1].roundNumber).toBe(504);
  });

  it('returns most recent records when requesting a subset', () => {
    for (let i = 0; i < 20; i++) {
      tokenTelemetry.record({
        sceneId: 2,
        roundNumber: i,
        timestamp: `t-${i}`,
        sections: { history: i }
      });
    }

    const latestFive = tokenTelemetry.latest(5);
    expect(latestFive.map((r) => r.roundNumber)).toEqual([15, 16, 17, 18, 19]);
  });
});
