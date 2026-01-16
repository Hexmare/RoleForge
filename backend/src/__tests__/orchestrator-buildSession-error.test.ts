import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as nunjucks from 'nunjucks';
import { Orchestrator } from '../agents/Orchestrator.js';
import SceneService from '../services/SceneService.js';

describe('Orchestrator.buildSessionContext errors', () => {
  it('throws when scene has no arc/world linkage', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Scenes (id INTEGER PRIMARY KEY, arcId INTEGER, activeCharacters TEXT, characterStates TEXT);
             CREATE TABLE Arcs (id INTEGER PRIMARY KEY, campaignId INTEGER);
             CREATE TABLE Campaigns (id INTEGER PRIMARY KEY, worldId INTEGER);
    `);
    // Insert a scene pointing to a non-existent arc
    db.prepare('INSERT INTO Scenes (id, arcId, activeCharacters, characterStates) VALUES (?, ?, ?, ?)').run(20, 9999, JSON.stringify([]), JSON.stringify({}));

    const cfg: any = {};
    const env = nunjucks.configure({ autoescape: false });
    const orchestrator = new Orchestrator(cfg, env, db as any, undefined as any);

    await expect((orchestrator as any).buildSessionContext(20)).rejects.toThrow();
  });
});
