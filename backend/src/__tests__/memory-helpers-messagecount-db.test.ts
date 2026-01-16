import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../database';
import { computeDecayAdjustedScore } from '../utils/memoryHelpers';

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
    if (ids.sceneId) db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(ids.sceneId);
  } catch (e) {
    // ignore
  }
}

describe('computeDecayAdjustedScore DB-backed message-count path', () => {
  let ids: any = {};

  beforeEach(async () => {
    ids = createWorldCampaignArcScene();
  });

  afterEach(async () => {
    const resolved = await ids;
    cleanupIds(resolved);
  });

  it('uses MessageService.getMessageCountSince via DB when mode=messageCount and metadata lacks messageCountSince', async () => {
    const resolved = await ids;

    // Insert an old message and two newer messages
    const baseTs = new Date(Date.now() - 60000).toISOString(); // 60s ago
    const newer1 = new Date(Date.now() - 30000).toISOString(); // 30s ago
    const newer2 = new Date(Date.now() - 10000).toISOString(); // 10s ago

    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 1, 'old', 'Alice', baseTs, 1, JSON.stringify({}), '', 1);
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 2, 'n1', 'Bob', newer1, 1, JSON.stringify({}), '', 1);
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 3, 'n2', 'Eve', newer2, 1, JSON.stringify({}), '', 1);

    const metadata = { sceneId: resolved.sceneId, timestamp: baseTs };
    const decayCfg = { enabled: true, mode: 'messageCount', halfLife: 2, floor: 0.001 };

    const originalScore = 1.0;
    const adjusted = await computeDecayAdjustedScore(originalScore, metadata, decayCfg);

    // There are 2 messages after baseTs (n1 and n2)
    const msgSince = 2;
    const halfLifeMsgs = 2;
    const rawFactor = Math.pow(0.5, msgSince / Math.max(1, halfLifeMsgs));
    const expectedFactor = Math.max(rawFactor, decayCfg.floor);
    const expected = originalScore * expectedFactor;

    // Allow small floating point tolerance
    expect(adjusted).toBeGreaterThan(0);
    expect(Math.abs(adjusted - expected)).toBeLessThan(1e-6);
  });
});
