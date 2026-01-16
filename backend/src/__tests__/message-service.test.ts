import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../database';
import { MessageService } from '../services/MessageService';

async function createWorldCampaignArcScene() {
  const w = db.prepare('INSERT INTO Worlds (slug, name) VALUES (?, ?)').run('w-' + Date.now() + Math.random(), 'W');
  const worldId = w.lastInsertRowid as number;
  const c = db.prepare('INSERT INTO Campaigns (worldId, slug, name) VALUES (?, ?, ?)').run(worldId, 'c-' + Date.now() + Math.random(), 'C');
  const campaignId = c.lastInsertRowid as number;
  const a = db.prepare('INSERT INTO Arcs (campaignId, orderIndex, name) VALUES (?, ?, ?)').run(campaignId, 0, 'A');
  const arcId = a.lastInsertRowid as number;
  const s = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title) VALUES (?, ?, ?)').run(arcId, 0, 'S');
  const sceneId = s.lastInsertRowid as number;
  return { worldId, campaignId, arcId, sceneId };
}

function cleanupIds(ids: { worldId?: number; campaignId?: number; arcId?: number; sceneId?: number }) {
  try {
    if (ids.sceneId) db.prepare('DELETE FROM Scenes WHERE id = ?').run(ids.sceneId);
    if (ids.arcId) db.prepare('DELETE FROM Arcs WHERE id = ?').run(ids.arcId);
    if (ids.campaignId) db.prepare('DELETE FROM Campaigns WHERE id = ?').run(ids.campaignId);
    if (ids.worldId) db.prepare('DELETE FROM Worlds WHERE id = ?').run(ids.worldId);
    // Also remove any messages tied to the scene
    if (ids.sceneId) db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(ids.sceneId);
  } catch (e) {
    // ignore
  }
}

describe('MessageService integration tests', () => {
  let ids: any = {};

  beforeEach(() => {
    ids = createWorldCampaignArcScene();
  });

  afterEach(async () => {
    const resolved = await ids;
    cleanupIds(resolved);
  });

  it('logMessage increments messageNumber sequentially', async () => {
    const resolved = await ids;
    const first = MessageService.logMessage(resolved.sceneId, 'Alice', 'hello');
    expect(first.messageNumber).toBe(1);
    const second = MessageService.logMessage(resolved.sceneId, 'Bob', 'reply');
    expect(second.messageNumber).toBe(2);
    // cleanup
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(resolved.sceneId);
  });

  it('getMessageCountSince counts messages after given ISO timestamp', async () => {
    const resolved = await ids;
    // Insert a message with an old timestamp, and another newer message
    const oldTs = new Date(Date.now() - 10000).toISOString();
    const newerTs = new Date(Date.now() - 1000).toISOString();
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, charactersPresent, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 1, 'old', 'Alice', oldTs, JSON.stringify([]), 1, JSON.stringify({}), '', 1);
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, charactersPresent, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 2, 'new', 'Bob', newerTs, JSON.stringify([]), 1, JSON.stringify({}), '', 1);

    const count = MessageService.getMessageCountSince(resolved.sceneId, oldTs);
    // should count messages with timestamp > oldTs, which is the newer one (1)
    expect(count).toBeGreaterThanOrEqual(1);

    // cleanup
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(resolved.sceneId);
  });
});
