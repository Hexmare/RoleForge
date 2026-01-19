import { describe, it, expect } from 'vitest';
import { applyDirectorPlan, normalizeDirectorPlan, orderActingCharacters } from '../agents/directorUtils.js';

describe('directorUtils ordering', () => {
  it('sorts actors by order, priority, then name', () => {
    const plan = normalizeDirectorPlan({
      openGuidance: 'test',
      actingCharacters: [
        { name: 'Charlie', priority: 1 },
        { name: 'Bravo', priority: 3 },
        { name: 'Alpha', priority: 3, order: 2 },
        { name: 'Delta', order: 1 }
      ],
      activations: [],
      deactivations: [],
      stateUpdates: []
    });

    const ordered = orderActingCharacters(plan);
    expect(ordered.map((a) => a.name)).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie']);
  });
});

describe('applyDirectorPlan', () => {
  it('applies activations, deactivations, and state updates before character turns', () => {
    const plan = normalizeDirectorPlan({
      openGuidance: 'Move fast',
      actingCharacters: [
        { name: 'Bravo', priority: 2 },
        { name: 'Charlie', priority: 4 }
      ],
      activations: ['Charlie'],
      deactivations: ['Alpha'],
      stateUpdates: [
        { name: 'Charlie', mood: 'excited', location: 'balcony' },
        { id: 'alpha-id', activity: 'waiting' }
      ]
    });

    const sessionContext = {
      activeCharacters: [
        { id: 'alpha-id', name: 'Alpha' },
        { id: 'bravo-id', name: 'Bravo' }
      ],
      world: { id: 1 },
      campaign: { id: 1 }
    } as any;

    const resolver = (ref: string) => {
      const map: Record<string, { id?: string; name: string }> = {
        Alpha: { id: 'alpha-id', name: 'Alpha' },
        'alpha-id': { id: 'alpha-id', name: 'Alpha' },
        Bravo: { id: 'bravo-id', name: 'Bravo' },
        'bravo-id': { id: 'bravo-id', name: 'Bravo' },
        Charlie: { id: 'charlie-id', name: 'Charlie' },
        'charlie-id': { id: 'charlie-id', name: 'Charlie' }
      };
      return map[ref] || null;
    };

    const result = applyDirectorPlan(plan, sessionContext, { Alpha: { mood: 'neutral' } }, resolver);

    expect(result.charactersToRespond).toEqual(['Charlie', 'Bravo']);
    expect(result.activeCharacterIds.sort()).toEqual(['bravo-id', 'charlie-id']);
    expect(result.appliedStateUpdates).toEqual([
      { name: 'Charlie', changes: { mood: 'excited', location: 'balcony' } },
      { name: 'Alpha', changes: { activity: 'waiting' } }
    ]);
    expect(result.updatedStates.Charlie.location).toBe('balcony');
    expect(result.deactivations).toHaveLength(1);
  });
});
