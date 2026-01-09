import { describe, it, expect } from 'vitest';
import { unwrapPrompt } from '../utils/unpackPrompt';

describe('unwrapPrompt utility', () => {
  const cases: Array<{ name: string; input: any; expected: any }> = [
    { name: 'plain string', input: 'A raven in a storm', expected: 'A raven in a storm' },
    { name: 'simple object', input: JSON.stringify({ prompt: 'A raven' }), expected: 'A raven' },
    { name: 'double-stringified', input: JSON.stringify(JSON.stringify({ prompt: 'Nested raven' })), expected: 'Nested raven' },
    { name: 'nested prompt prop', input: JSON.stringify({ prompt: JSON.stringify({ prompt: 'Deep raven' }) }), expected: 'Deep raven' },
    { name: 'object with urls', input: JSON.stringify({ prompt: 'Scene', urls: ['http://x/1.png'], current: 0 }), expected: 'Scene' },
    { name: 'string-wrapped-object-with-escaped', input: '"{\"prompt\":\"Escaped raven\"}"', expected: 'Escaped raven' }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = unwrapPrompt(c.input);
      expect(out).toBe(c.expected);
    });
  }
});
