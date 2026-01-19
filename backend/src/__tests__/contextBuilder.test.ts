import { describe, it, expect, vi } from 'vitest';
import { createTestDatabase, seedTestScene } from './fixtures/rounds-db';

vi.mock('../services/CharacterService.js', () => ({
  default: { getMergedCharacter: vi.fn() }
}));

vi.mock('../services/SceneService.js', () => ({
  default: { getLoreContext: vi.fn().mockReturnValue(null) }
}));

vi.mock('../services/LorebookService.js', () => ({
  default: { getActiveLorebooks: vi.fn().mockReturnValue([]) }
}));

vi.mock('../utils/loreMatcher.js', () => ({
  matchLoreEntries: vi.fn().mockReturnValue({ selectedEntries: [] })
}));

import { buildAgentContextEnvelope } from '../agents/context/contextBuilder.js';

describe('buildAgentContextEnvelope caps', () => {
  it('uses default allocations when none provided', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const history = ['h'.repeat(200), 'h'.repeat(180)];

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      history,
      tokenBudget: {
        maxContextTokens: 100
      }
    });

    expect(envelope.history).toEqual([history[0]]);
    db.close();
  });

  it('applies derived caps from token allocations', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const history = ['h'.repeat(30), 'z'.repeat(20)];
    const summaries = ['s'.repeat(10), 't'.repeat(15)];

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      history,
      summarizedHistory: summaries,
      tokenBudget: {
        maxContextTokens: 100,
        allocations: {
          history: 0.1,
          summaries: 0.05,
          lore: 0,
          memories: 0,
          scenarioNotes: 0,
          directorGuidance: 0,
          characterGuidance: 0
        }
      }
    });

    expect(envelope.history).toEqual([history[0]]);
    expect(envelope.summarizedHistory).toEqual([summaries[0]]);
    db.close();
  });

  it('prefers explicit caps over derived allocations', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const history = ['abcdefghi', 'jklmnopqr'];

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      history,
      tokenBudget: {
        maxContextTokens: 200,
        allocations: {
          history: 0.5,
          summaries: 0,
          lore: 0,
          memories: 0,
          scenarioNotes: 0,
          directorGuidance: 0,
          characterGuidance: 0
        },
        caps: {
          history: { maxChars: 10 }
        }
      }
    });

    expect(envelope.history).toEqual([history[0]]);
    db.close();
  });

  it('trims scenario notes when allocation cap is small', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      tokenBudget: {
        maxContextTokens: 40,
        allocations: {
          history: 0,
          summaries: 0,
          lore: 0,
          memories: 0,
          scenarioNotes: 0.05,
          directorGuidance: 0,
          characterGuidance: 0
        }
      }
    });

    expect(envelope.scenarioNotes?.world).toBe('');
    expect(envelope.scenarioNotes?.arc).toBe('');
    db.close();
  });

  it('applies history window when provided', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const history = ['m1', 'm2', 'm3', 'm4'];

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      historyWindow: 2,
      history
    });

    expect(envelope.history).toEqual(['m3', 'm4']);
    expect(envelope.historyWindow).toBe(2);
    db.close();
  });

  it('prefers lore override provided in memories', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      memories: { __loreOverride: ['forced lore'], c1: ['mem'] }
    });

    expect(envelope.lore).toEqual(['forced lore']);
    expect(envelope.memories?.c1).toEqual(['mem']);
    db.close();
  });

  it('reallocates budget when sections are absent', () => {
    const db = createTestDatabase();
    const { sceneId } = seedTestScene(db);

    const history = ['h'.repeat(180), 'h'.repeat(180)];
    const summaries = ['short'];

    const envelope = buildAgentContextEnvelope({
      db,
      sceneId,
      requestType: 'user',
      history,
      summarizedHistory: summaries,
      tokenBudget: {
        maxContextTokens: 100,
        allocations: {
          history: 0.3,
          summaries: 0.1
        }
      }
    });

    expect(envelope.history).toEqual([history[0]]);
    expect(envelope.summarizedHistory).toEqual(summaries);
    db.close();
  });
});
