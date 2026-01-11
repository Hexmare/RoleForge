import { describe, it, expect } from 'vitest';
import { matchLoreEntries } from '../utils/loreMatcher';

describe('loreMatcher', () => {
  it('matches primary keys', () => {
    const entries = [
      {
        uid: 1,
        key: ['dragon', 'fire'],
        content: 'Dragons breathe fire.',
        enabled: true,
        selective: false,
        selectiveLogic: 0,
        insertion_order: 100,
        probability: 100,
        useProbability: false,
        matchWholeWords: true,
        caseSensitive: false,
      }
    ];
    const context = {
      text: 'The dragon breathes fire.',
      activeCharacters: [],
    };
    const result = matchLoreEntries(entries, context, 4, 2048);
    expect(result.selectedEntries.length).toBe(1);
    expect(result.selectedEntries[0].content).toBe('Dragons breathe fire.');
  });

  it('respects token budget', () => {
    const entries = [
      {
        uid: 2,
        key: ['b'],
        content: 'Short',
        enabled: true,
        selective: false,
        selectiveLogic: 0,
        insertion_order: 100,
        probability: 100,
        useProbability: false,
        matchWholeWords: false,
        caseSensitive: false,
      },
      {
        uid: 1,
        key: ['a'],
        content: 'Long content '.repeat(100), // ~1200 tokens approx
        enabled: true,
        selective: false,
        selectiveLogic: 0,
        insertion_order: 100,
        probability: 100,
        useProbability: false,
        matchWholeWords: false,
        caseSensitive: false,
      }
    ];
    const context = {
      text: 'a b',
      activeCharacters: [],
    };
    const result = matchLoreEntries(entries, context, 4, 5); // Low budget
    expect(result.selectedEntries.length).toBe(1); // Only the short one fits
    expect(result.selectedEntries[0].content).toBe('Short');
  });

  it('handles selective logic', () => {
    const entries = [
      {
        uid: 1,
        key: ['hero'],
        filters: ['sword'],
        content: 'Hero with sword.',
        enabled: true,
        selectiveLogic: 1,
        insertion_order: 100,
        probability: 100,
        useProbability: false,
        matchWholeWords: false,
        caseSensitive: false,
      }
    ];
    const context = {
      text: 'hero sword',
      activeCharacters: [],
    };
    const result = matchLoreEntries(entries, context, 4, 2048);
    expect(result.selectedEntries.length).toBe(1);
  });
});