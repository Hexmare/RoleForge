import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as nunjucks from 'nunjucks';
import { Orchestrator } from '../agents/Orchestrator.js';
import SceneService from '../services/SceneService.js';
import MessageService from '../services/MessageService.js';
import { ConfigManager } from '../configManager.js';

describe('Orchestrator round completion and vectorization trigger', () => {
  it('calls vectorization agent.run and advances round', async () => {
    // in-memory DB setup
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Scenes (id INTEGER PRIMARY KEY, arcId INTEGER, currentRoundNumber INTEGER DEFAULT 1, activeCharacters TEXT, characterStates TEXT);`);
    const insert = db.prepare('INSERT INTO Scenes (id, arcId, currentRoundNumber, activeCharacters) VALUES (?, ?, ?, ?)');
    insert.run(1, 1, 1, JSON.stringify(['char1', 'char2']));

    // stub SceneService.completeRound and MessageService.getRoundMessages
    let completeRoundCalled = false;
    (SceneService as any).completeRound = (sceneId: number, chars: string[]) => {
      completeRoundCalled = true;
      return 2; // next round number
    };

    (MessageService as any).getRoundMessages = (sceneId: number, roundNumber: number) => {
      return [
        { character: 'char1', message: 'Hello', source: 'npc' },
        { character: 'char2', message: 'Reply', source: 'npc' }
      ];
    };

    const cfg = new ConfigManager();
    const env = nunjucks.configure({ autoescape: false });

    const orchestrator = new Orchestrator(cfg, env, db as any, undefined as any);

    // replace vectorization agent with a mock
    let runCalled = false;
    let capturedContext: any = null;
    orchestrator.getAgents().set('vectorization', {
      run: async (context: any) => {
        runCalled = true;
        capturedContext = context;
      }
    } as any);

    const next = await orchestrator.completeRound(1, ['char1', 'char2']);

    expect(completeRoundCalled).toBe(true);
    expect(next).toBe(2);
    expect(runCalled).toBe(true);
    expect(capturedContext).toBeTruthy();
    expect(capturedContext.messages.length).toBe(2);
    // orchestrator should have incremented its internal round counter
    expect(orchestrator.getCurrentRound()).toBe(2);
  });
});
