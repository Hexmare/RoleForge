import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock CharacterAgent before importing Orchestrator so Orchestrator will use our mock
const capturedContexts: any[] = [];

vi.mock('../agents/CharacterAgent.js', () => {
  return {
    CharacterAgent: class {
      name: string;
      constructor(n: string) { this.name = n; }
      async run(ctx: any) {
        // capture the context passed to the character
        capturedContexts.push({ name: this.name, ctx });
        if (this.name === 'CharA') return JSON.stringify({ response: 'Hi!' });
        if (this.name === 'CharB') return JSON.stringify({ response: 'Hello back!' });
        return JSON.stringify({ response: '...' });
      }
      getProfile() {
        return { sampler: { max_completion_tokens: 400 } };
      }
    }
  };
});

import { Orchestrator } from '../agents/Orchestrator.js';
import { ConfigManager } from '../configManager.js';
import * as nunjucks from 'nunjucks';

// Mock memoryRetriever to return a CharA memory for CharB scope
vi.mock('../utils/memoryRetriever.js', () => {
  return {
    getMemoryRetriever: () => ({
      initialize: async () => {},
      retrieve: async (opts: any) => {
        if (String(opts.scope).includes('char_charB') || String(opts.scope).includes('charB')) {
          return [{ text: 'CharA: Hi!', similarity: 1.0, scope: opts.scope, metadata: {} }];
        }
        return [];
      },
      formatMemoriesForPrompt: (m: any) => m.map((x: any) => x.text).join('\n')
    })
  };
});

// Stub SceneService to avoid DB-dependent updates during this unit test
vi.mock('../services/SceneService.js', () => {
  return {
    default: {
      getById: (id: number) => ({ id, title: 'Scene', description: '', location: '' }),
      update: (id: number, fields: any) => ({ ...fields, id }),
      getWorldIdFromSceneId: (sceneId: number) => 1,
      create: (obj: any) => ({ id: 1, ...obj })
    }
  };
});

describe('Orchestrator per-character memory injection', () => {
  let orch: Orchestrator;

  beforeEach(() => {
    const cfg = new ConfigManager();
    const env = new nunjucks.Environment();
    const dbStub: any = { prepare: () => ({ get: () => null, all: () => [] }) };
    orch = new Orchestrator(cfg, env, dbStub, undefined as any);

    // stub buildSessionContext to return minimal session with two characters
    (orch as any).buildSessionContext = async (_sceneId: number) => {
      return {
        world: { id: 1 },
        campaign: { id: 1 },
        arc: { id: 1 },
        scene: { id: 1, characterStates: {} },
        activeCharacters: [ { id: 'charA', name: 'CharA' }, { id: 'charB', name: 'CharB' } ],
        formattedLore: '',
        lore: []
      } as any;
    };

    // Replace director and world agents with lightweight mocks
    orch.getAgents().set('director', { run: async (_ctx: any) => JSON.stringify({
      openGuidance: 'Keep it quick',
      actingCharacters: [
        { name: 'CharA', guidance: 'Lead with a greeting', order: 1 },
        { name: 'CharB', guidance: 'React to CharA', order: 2 }
      ],
      activations: ['CharA'],
      deactivations: [] ,
      stateUpdates: []
    }) } as any);
    orch.getAgents().set('world', { run: async (_ctx: any) => JSON.stringify({ unchanged: true }) } as any);

    // Memory retriever module is mocked above via vi.mock
  });

  it('injects prior character response into subsequent character context', async () => {
    // Run processUserInput with user message; director will select CharA then CharB
    const result = await (orch as any).processUserInput('hello', 'user', ['CharA','CharB'], 1);
    // Expect two responses returned
    expect(result.responses.length).toBeGreaterThanOrEqual(2);
    // capturedContexts should contain two captured run contexts
    expect(capturedContexts.length).toBeGreaterThanOrEqual(2);

    const first = capturedContexts[0];
    const second = capturedContexts[1];
    // First character (CharA) should have no injected memories
    expect(first.name).toBe('CharA');
    expect(first.ctx.characterDirective).toBe('Lead with a greeting');
    expect(first.ctx.entryGuidance).toBeTruthy();
    expect(first.ctx.vectorMemoriesRaw && first.ctx.vectorMemoriesRaw.length).toBeFalsy();

    // Second character (CharB) should have injected memories that include CharA's response in history
    expect(second.name).toBe('CharB');
    expect(second.ctx.characterDirective).toBe('React to CharA');
    expect(second.ctx.vectorMemoriesRaw && second.ctx.vectorMemoriesRaw.length).toBeGreaterThan(0);
    const memText = second.ctx.vectorMemoriesRaw[0].text as string;
    expect(memText).toContain('CharA: Hi!');
  });
});
