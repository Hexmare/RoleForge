import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as nunjucks from 'nunjucks';
import { Orchestrator } from '../agents/Orchestrator.js';
import LorebookService from '../services/LorebookService.js';
import SceneService from '../services/SceneService.js';
import CharacterService from '../services/CharacterService.js';
import { ConfigManager } from '../configManager.js';

describe('Orchestrator.buildSessionContext', () => {
  it('returns session context with world/campaign/arc and resolved characters', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE Worlds (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, description TEXT);
             CREATE TABLE Campaigns (id INTEGER PRIMARY KEY, worldId INTEGER, name TEXT, slug TEXT, description TEXT);
             CREATE TABLE Arcs (id INTEGER PRIMARY KEY, campaignId INTEGER, name TEXT, orderIndex INTEGER, description TEXT);
             CREATE TABLE Scenes (id INTEGER PRIMARY KEY, arcId INTEGER, activeCharacters TEXT, characterStates TEXT);
             CREATE TABLE CampaignState (campaignId INTEGER PRIMARY KEY, currentSceneId INTEGER, elapsedMinutes INTEGER, dynamicFacts TEXT, trackers TEXT, updatedAt TEXT);
    `);

    db.prepare('INSERT INTO Worlds (id, name, slug, description) VALUES (?, ?, ?, ?)').run(1, 'W', 'w', 'world');
    db.prepare('INSERT INTO Campaigns (id, worldId, name, slug, description) VALUES (?, ?, ?, ?, ?)').run(2, 1, 'C', 'c', 'camp');
    db.prepare('INSERT INTO Arcs (id, campaignId, name, orderIndex, description) VALUES (?, ?, ?, ?, ?)').run(3, 2, 'A', 1, 'arc');
    db.prepare('INSERT INTO Scenes (id, arcId, activeCharacters, characterStates) VALUES (?, ?, ?, ?)').run(4, 3, JSON.stringify(['char-uuid-1']), JSON.stringify({}));
    db.prepare('INSERT INTO CampaignState (campaignId, currentSceneId, elapsedMinutes, dynamicFacts, trackers, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(2, 4, 10, JSON.stringify({}), JSON.stringify({}), new Date().toISOString());

    // stub LorebookService.getActiveLorebooks
    vi.spyOn(LorebookService as any, 'getActiveLorebooks').mockReturnValue([{ name: 'LB', uuid: 'lb1', entries: [{ key: 'k', content: 'entry' }] }]);

    // stub SceneService.getLoreContext (include `text` for lore matcher)
    vi.spyOn(SceneService as any, 'getLoreContext').mockReturnValue({ topic: 't', text: 'scene topic text' });

    // stub CharacterService.getMergedCharacter to return character object
    vi.spyOn(CharacterService as any, 'getMergedCharacter').mockImplementation(({ characterId }: any) => ({ id: characterId, name: 'CharName' }));

    const cfg = new ConfigManager();
    const env = nunjucks.configure({ autoescape: false });
    const orchestrator = new Orchestrator(cfg, env, db as any, undefined as any);

    const ctx = await (orchestrator as any).buildSessionContext(4);
    expect(ctx).toBeTruthy();
    expect(ctx.world).toBeTruthy();
    expect(ctx.campaign).toBeTruthy();
    expect(ctx.arc).toBeTruthy();
    expect(Array.isArray(ctx.activeCharacters)).toBe(true);

    // restore mocks
    (LorebookService as any).getActiveLorebooks.mockRestore?.();
    (SceneService as any).getLoreContext.mockRestore?.();
    (CharacterService as any).getMergedCharacter.mockRestore?.();
  });
});
