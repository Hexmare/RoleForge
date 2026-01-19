import { describe, it, expect } from 'vitest';
import { normalizeDirectorPlan, applyDirectorPlan, DirectorPlan } from '../agents/directorUtils.js';

describe('director plan normalization and application', () => {
  it('orders actors by explicit order then priority then name and applies activations/deactivations', () => {
    const raw: DirectorPlan = normalizeDirectorPlan({
      actingCharacters: [
        { name: 'Charlie', priority: 1 },
        { name: 'Alice', order: 0 },
        { name: 'Bob', priority: 2 }
      ],
      activations: ['Dora'],
      deactivations: ['Charlie'],
      stateUpdates: [{ name: 'Bob', mood: 'focused' }]
    });

    const session = { world: { id: 1 }, campaign: { id: 1 }, activeCharacters: [{ name: 'Eve' }] } as any;
    const resolver = (ref: string) => ({ name: ref });
    const result = applyDirectorPlan(raw, session, {}, resolver);

    expect(result.orderedActors.map((a) => a.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    expect(result.activations[0]?.name).toBe('Dora');
    expect(result.deactivations[0]?.name).toBe('Charlie');
    expect(result.updatedStates.Bob?.mood).toBe('focused');
    expect(result.activeCharacterIds).toContain('Eve');
    expect(result.activeCharacterIds).toContain('Dora');
    expect(result.activeCharacterIds).not.toContain('Charlie');
  });

  it('ignores state updates set to default', () => {
    const raw = normalizeDirectorPlan({
      stateUpdates: [{ name: 'Alice', mood: 'default', location: 'town' }]
    });
    const session = { world: { id: 1 }, campaign: { id: 1 }, activeCharacters: [] } as any;
    const result = applyDirectorPlan(raw, session, {});
    expect(result.updatedStates.Alice?.location).toBe('town');
    expect(result.updatedStates.Alice?.mood).toBeUndefined();
  });
});
