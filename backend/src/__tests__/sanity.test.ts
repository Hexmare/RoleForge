import { describe, it, expect } from 'vitest';

// Minimal guard to confirm Vitest wiring without logging worker internals
describe('sanity', () => {
  it('runs a trivial assertion', () => {
    expect(true).toBe(true);
  });
});
