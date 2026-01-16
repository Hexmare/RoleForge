import { describe, it, expect } from 'vitest';
import { applyConditionalBoost } from '../utils/memoryHelpers.js';

describe('applyConditionalBoost - text and emotion rules', () => {
  it('matches memory text with substring rule', () => {
    const original = 1.0;
    const rules = [{ field: 'text', match: 'betrayed', boost: 2 }];
    const res = applyConditionalBoost(original, {}, rules, { text: 'He was betrayed by his kin' });
    expect(res).toBeCloseTo(2.0);
  });

  it('infers emotion from text and applies emotion boost', () => {
    const original = 1.0;
    const rules = [{ field: 'emotion', match: 'angry', boost: 1.5 }];
    const res = applyConditionalBoost(original, {}, rules, { text: "I'm so angry right now" });
    expect(res).toBeCloseTo(1.5);
  });

  it('prefers metadata emotion over inferred emotion', () => {
    const original = 1.0;
    const rules = [{ field: 'emotion', match: 'sad', boost: 2 }];
    const metadata = { emotion: 'sad' };
    const res = applyConditionalBoost(original, metadata, rules, { text: 'I am very happy' });
    expect(res).toBeCloseTo(2.0);
  });

  it('applies multiplicative boosts when multiple rules match', () => {
    const original = 1.0;
    const rules = [
      { field: 'text', match: 'betrayed', boost: 2 },
      { field: 'emotion', match: 'angry', boost: 1.5 }
    ];
    const res = applyConditionalBoost(original, {}, rules, { text: 'He betrayed me; I am angry' });
    expect(res).toBeCloseTo(3.0); // 2 * 1.5
  });

  it('supports penalizing with boost < 1', () => {
    const original = 1.0;
    const rules = [{ field: 'metadata.isDeprecated', match: 'true', boost: 0.5, matchType: 'exact' }];
    const metadata = { metadata: { isDeprecated: 'true' } };
    const res = applyConditionalBoost(original, metadata, rules, { text: 'old memory' });
    expect(res).toBeCloseTo(0.5);
  });
});
