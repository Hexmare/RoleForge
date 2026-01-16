import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as nunjucks from 'nunjucks';
import { Orchestrator } from '../agents/Orchestrator.js';
import MessageService from '../services/MessageService.js';
import SceneService from '../services/SceneService.js';
import { ConfigManager } from '../configManager.js';

describe('Orchestrator.continueRound', () => {
  it('builds synthetic input and calls processUserInput, logs messages, and completes round', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Scenes (id INTEGER PRIMARY KEY, arcId INTEGER, currentRoundNumber INTEGER DEFAULT 1, activeCharacters TEXT, characterStates TEXT);`);
    const insert = db.prepare('INSERT INTO Scenes (id, arcId, currentRoundNumber, activeCharacters) VALUES (?, ?, ?, ?)');
    insert.run(1, 1, 2, JSON.stringify(['char1']));

    // stub MessageService.getRoundMessages to supply previous round messages
    (MessageService as any).getRoundMessages = (sceneId: number, roundNumber: number) => {
      return [
        { character: 'char1', message: 'Hello', source: 'npc' }
      ];
    };

    const cfg = new ConfigManager();
    const env = nunjucks.configure({ autoescape: false });
    const orchestrator = new Orchestrator(cfg, env, db as any, undefined as any);

    // stub buildSessionContext to return activeCharacters resolved
    (orchestrator as any).buildSessionContext = async (_sceneId: number) => ({ activeCharacters: [{ id: 'char1', name: 'Char One' }] });

    // stub processUserInput to invoke the callback provided by continueRound
    let processCalled = false;
    (orchestrator as any).processUserInput = async (_input: string, _persona: string, _activeCharacterUUIDs: string[], _sceneId: number, cb: any) => {
      processCalled = true;
      // simulate agent response -> call the callback that orchestrator passed in
      cb({ sender: 'char1', content: 'Auto reply' });
    };

    // spy on MessageService.logMessage to confirm callback path executed
    const logSpy = vi.spyOn(MessageService as any, 'logMessage').mockImplementation(() => {});

    // stub orchestrator.completeRound to avoid nested behavior
    (orchestrator as any).completeRound = async (_sceneId: number, _active?: string[]) => 3;

    await orchestrator.continueRound(1);

    expect(processCalled).toBe(true);
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
