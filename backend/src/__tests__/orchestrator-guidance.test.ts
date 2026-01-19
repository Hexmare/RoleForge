import { describe, it, expect } from 'vitest';
import { buildReconciliationEnvelope } from '../agents/Orchestrator.js';
import { AgentContextEnvelope } from '../agents/context/types.js';

describe('reconciliation envelope', () => {
  it('strips directorGuidance before second pass', () => {
    const base: AgentContextEnvelope = {
      requestType: 'user',
      sceneId: 1,
      history: ['h1'],
      summarizedHistory: [],
      perRoundSummaries: [],
      lastRoundMessages: [],
      lore: [],
      formattedLore: '',
      memories: {},
      scenarioNotes: { world: '', campaign: '', arc: '', scene: '' },
      characters: [],
      characterStates: {},
      worldState: {},
      trackers: {},
      directorGuidance: { openGuidance: 'keep calm' },
      tokenBudget: undefined
    } as any;

    const recon = buildReconciliationEnvelope(base, [{ character: 'A', response: 'hi' }]);
    expect(recon?.directorGuidance).toBeUndefined();
    expect((recon as any).recentCharacterResponses?.[0]?.character).toBe('A');
    expect((recon as any).directorPass).toBe(2);
  });
});
