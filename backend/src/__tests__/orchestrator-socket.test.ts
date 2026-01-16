import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as nunjucks from 'nunjucks';
import { Orchestrator } from '../agents/Orchestrator.js';
import SceneService from '../services/SceneService.js';

describe('Orchestrator socket emission', () => {
  it('emits stateUpdated to scene room on completeRound', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Scenes (id INTEGER PRIMARY KEY, arcId INTEGER, activeCharacters TEXT, characterStates TEXT);`);
    db.prepare('INSERT INTO Scenes (id, arcId, activeCharacters, characterStates) VALUES (?, ?, ?, ?)').run(10, 1, JSON.stringify([]), JSON.stringify({}));

    const cfg: any = {};
    const env = nunjucks.configure({ autoescape: false });

    // stub SceneService.completeRound to return nextRound
    vi.spyOn(SceneService as any, 'completeRound').mockResolvedValue({ nextRoundId: 11 });

    // mock io with to().emit()
    const emitSpy = vi.fn();
    const toSpy = vi.fn(() => ({ emit: emitSpy }));
    const ioMock: any = { to: toSpy };

    const orchestrator = new Orchestrator(cfg, env, db as any, ioMock);

    const result = await (orchestrator as any).completeRound(10);
    expect(result).toBeTruthy();
    expect(toSpy).toHaveBeenCalledWith('scene-10');
    expect(emitSpy).toHaveBeenCalled();

    // restore
    (SceneService as any).completeRound.mockRestore?.();
  });
});
