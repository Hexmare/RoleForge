import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../database';
import { MessageService } from '../services/MessageService';
import fs from 'fs';
import path from 'path';

async function createWorldCampaignArcScene() {
  const w = db.prepare('INSERT INTO Worlds (slug, name) VALUES (?, ?)').run('w-' + Date.now() + Math.random(), 'W');
  const worldId = w.lastInsertRowid as number;
  const c = db.prepare('INSERT INTO Campaigns (worldId, slug, name) VALUES (?, ?, ?)').run(worldId, 'c-' + Date.now() + Math.random(), 'C');
  const campaignId = c.lastInsertRowid as number;
  const a = db.prepare('INSERT INTO Arcs (campaignId, orderIndex, name) VALUES (?, ?, ?)').run(campaignId, 0, 'A');
  const arcId = a.lastInsertRowid as number;
  const s = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title, currentRoundNumber) VALUES (?, ?, ?, ?)').run(arcId, 0, 'S', 1);
  const sceneId = s.lastInsertRowid as number;
  return { worldId, campaignId, arcId, sceneId };
}

function cleanupIds(ids: { worldId?: number; campaignId?: number; arcId?: number; sceneId?: number }) {
  try {
    if (ids.sceneId) db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(ids.sceneId);
    if (ids.sceneId) db.prepare('DELETE FROM Scenes WHERE id = ?').run(ids.sceneId);
    if (ids.arcId) db.prepare('DELETE FROM Arcs WHERE id = ?').run(ids.arcId);
    if (ids.campaignId) db.prepare('DELETE FROM Campaigns WHERE id = ?').run(ids.campaignId);
    if (ids.worldId) db.prepare('DELETE FROM Worlds WHERE id = ?').run(ids.worldId);
  } catch (e) {
    // ignore
  }
}

describe('MessageService extended tests', () => {
  let idsPromise: Promise<any>;
  let ids: any;

  beforeEach(async () => {
    idsPromise = createWorldCampaignArcScene();
    ids = await idsPromise;
  });
  afterEach(async () => {
    const resolved = await idsPromise;
    // attempt cleanup of generated public files directory
    try {
      const genDir = path.join(process.cwd(), 'public', 'generated', String(resolved.worldId), String(resolved.campaignId), String(resolved.arcId), String(resolved.sceneId));
      if (fs.existsSync(genDir)) {
        // remove files then directories
        const files = fs.readdirSync(genDir);
        for (const f of files) {
          try { fs.unlinkSync(path.join(genDir, f)); } catch {}
        }
        try { fs.rmdirSync(genDir); } catch {}
      }
    } catch (e) {}
    cleanupIds(resolved);
  });

  it('moveMessage moves messages up and down and preserves sequencing', () => {
    const resolved = ids;
    const a = MessageService.logMessage(resolved.sceneId, 'A', 'one');
    const b = MessageService.logMessage(resolved.sceneId, 'B', 'two');
    const c = MessageService.logMessage(resolved.sceneId, 'C', 'three');
    // ids a,b,c have messageNumber 1,2,3
    expect(a.messageNumber).toBe(1);
    expect(b.messageNumber).toBe(2);
    expect(c.messageNumber).toBe(3);

    // move 'b' up -> becomes 1
    const movedUp = MessageService.moveMessage(b.id, 'up');
    expect(movedUp.changed).toBe(1);
    const seq = db.prepare('SELECT id, messageNumber FROM Messages WHERE sceneId = ? ORDER BY messageNumber ASC').all(resolved.sceneId);
    expect(seq.map((r: any) => r.messageNumber)).toEqual([1,2,3]);
    // the order of ids should have b first now
    expect(seq[0].id).toBe(b.id);

    // move the original 'b' (now at 1) down
    const movedDown = MessageService.moveMessage(b.id, 'down');
    expect(movedDown.changed).toBe(1);
    const seq2 = db.prepare('SELECT id, messageNumber FROM Messages WHERE sceneId = ? ORDER BY messageNumber ASC').all(resolved.sceneId);
    expect(seq2[1].id).toBe(b.id);

    // cleanup
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(resolved.sceneId);
  });

  it('deleteMessage removes referenced generated files and decrements subsequent messageNumbers', () => {
    const resolved = ids;
    // Insert three messages
    const m1 = MessageService.logMessage(resolved.sceneId, 'X', 'first');
    const m2 = MessageService.logMessage(resolved.sceneId, 'Y', '![alt](public/generated/' + resolved.worldId + '/' + resolved.campaignId + '/' + resolved.arcId + '/' + resolved.sceneId + '/img1.png)');
    const m3 = MessageService.logMessage(resolved.sceneId, 'Z', 'third');

    // create the referenced file
    const genDir = path.join(process.cwd(), 'public', 'generated', String(resolved.worldId), String(resolved.campaignId), String(resolved.arcId), String(resolved.sceneId));
    try { fs.mkdirSync(genDir, { recursive: true }); } catch {}
    const filePath = path.join(genDir, 'img1.png');
    fs.writeFileSync(filePath, 'data');
    expect(fs.existsSync(filePath)).toBe(true);

    // delete m2
    const res = MessageService.deleteMessage(m2.id);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    // referenced file should be removed
    expect(fs.existsSync(filePath)).toBe(false);

    // ensure remaining messages have messageNumber sequenced starting at 1
    const remaining = db.prepare('SELECT messageNumber FROM Messages WHERE sceneId = ? ORDER BY messageNumber ASC').all(resolved.sceneId);
    expect(remaining.map((r: any) => r.messageNumber)).toEqual([1,2]);

    // cleanup
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(resolved.sceneId);
  });

  it('getLatestRound and getCurrentRoundMessages behavior', () => {
    const resolved = ids;
    // insert messages across rounds
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, charactersPresent, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 1, 'r1m1', 'A', JSON.stringify([]), 1, JSON.stringify({}), '', 1);
    db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, charactersPresent, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolved.sceneId, 2, 'r2m1', 'B', JSON.stringify([]), 1, JSON.stringify({}), '', 2);
    db.prepare('INSERT INTO SceneRounds (sceneId, roundNumber, activeCharacters, status) VALUES (?, ?, ?, ?)')
      .run(resolved.sceneId, 1, JSON.stringify([]), 'completed');
    db.prepare('INSERT INTO SceneRounds (sceneId, roundNumber, activeCharacters, status) VALUES (?, ?, ?, ?)')
      .run(resolved.sceneId, 2, JSON.stringify([]), 'in-progress');

    // getLatestRound should be 2
    expect(MessageService.getLatestRound(resolved.sceneId)).toBe(2);

    // set Scenes.currentRoundNumber to 2 and test getCurrentRoundMessages
    db.prepare('UPDATE Scenes SET currentRoundNumber = ? WHERE id = ?').run(2, resolved.sceneId);
    const cur = MessageService.getCurrentRoundMessages(resolved.sceneId);
    expect(Array.isArray(cur)).toBe(true);
    expect(cur.length).toBeGreaterThanOrEqual(1);

    // cleanup
    db.prepare('DELETE FROM Messages WHERE sceneId = ?').run(resolved.sceneId);
    db.prepare('DELETE FROM SceneRounds WHERE sceneId = ?').run(resolved.sceneId);
  });
});
