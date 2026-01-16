import { describe, it, expect } from 'vitest';
import db from '../database';
import { MemoryRetriever } from '../utils/memoryRetriever';

// Fake vector store that returns two memories with different timestamps
class FakeVectorStore {
  private sceneId: number;
  constructor(sceneId: number) { this.sceneId = sceneId; }
  async query(_query: string, _scope: string, _topK: number, _minSimilarity: number) {
    const now = Date.now();
    const memA_ts = new Date(now - 120_000).toISOString(); // older (2m)
    const memB_ts = new Date(now - 60_000).toISOString(); // newer (1m)

    return [
      { text: 'Memory A', similarity: 1.0, metadata: { sceneId: this.sceneId, timestamp: memA_ts } },
      { text: 'Memory B', similarity: 1.0, metadata: { sceneId: this.sceneId, timestamp: memB_ts } },
    ];
  }
}

describe('MemoryRetriever integration: message-count decay with real DB counts', () => {
  it('derives message counts from DB and applies decay ordering, cleaning up inserts', async () => {
    // Create minimal world/campaign/arc/scene hierarchy
    const uid = Date.now();
    const worldSlug = `it-test-world-${uid}`;
    const campaignSlug = `it-campaign-${uid}`;
    const worldRes = db.prepare('INSERT INTO Worlds (slug, name, description) VALUES (?, ?, ?)').run(worldSlug, 'IT Test World', 'tmp');
    const worldId = worldRes.lastInsertRowid as number;
    const campaignRes = db.prepare('INSERT INTO Campaigns (worldId, slug, name, description) VALUES (?, ?, ?, ?)').run(worldId, campaignSlug, 'IT Campaign', 'tmp');
    const campaignId = campaignRes.lastInsertRowid as number;
    const arcRes = db.prepare('INSERT INTO Arcs (campaignId, orderIndex, name, description) VALUES (?, ?, ?, ?)').run(campaignId, 1, 'IT Arc', 'tmp');
    const arcId = arcRes.lastInsertRowid as number;
    const sceneRes = db.prepare('INSERT INTO Scenes (arcId, orderIndex, title, description, elapsedMinutes, activeCharacters, currentRoundNumber) VALUES (?, ?, ?, ?, ?, ?, ?)').run(arcId, 1, 'IT Scene', 'tmp', 0, JSON.stringify([]), 1);
    const sceneId = sceneRes.lastInsertRowid as number;

    // Prepare message timestamps: one between memA and memB, one after memB
    const now = Date.now();
    const msg1_ts = new Date(now - 90_000).toISOString(); // 1.5m
    const msg2_ts = new Date(now - 30_000).toISOString(); // 0.5m

    const insertedMessageIds: number[] = [];

    try {
      // Insert two messages for the scene with explicit timestamps
      const stmt = db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, timestamp, roundNumber) VALUES (?, ?, ?, ?, ?, ?)');
      // Get starting messageNumber
      const maxRow = db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId) as any;
      let nextNum = (maxRow?.maxNum || 0) + 1;

      const r1 = stmt.run(sceneId, nextNum++, 'IT message 1', 'tester', msg1_ts, 1);
      insertedMessageIds.push(r1.lastInsertRowid as number);
      const r2 = stmt.run(sceneId, nextNum++, 'IT message 2', 'tester', msg2_ts, 1);
      insertedMessageIds.push(r2.lastInsertRowid as number);

      // Use MemoryRetriever with a fake vector store that returns memories referencing this scene
      const retriever = new MemoryRetriever();
      (retriever as any).vectorStore = new FakeVectorStore(sceneId);

      // Query with messageCount decay enabled and a small halfLife to make effects visible
      const options: any = {
        worldId: Number(worldId),
        characterId: 'it-char',
        topK: 2,
        temporalDecay: { enabled: true, mode: 'messageCount', halfLife: 1, floor: 0.01 },
      };

      const results = await retriever.queryMemories('test', options);

      // We expect Memory B (newer) to have higher adjusted similarity than Memory A (older)
      expect(results.length).toBeGreaterThanOrEqual(2);
      const idxA = results.findIndex(r => r.text === 'Memory A');
      const idxB = results.findIndex(r => r.text === 'Memory B');
      expect(idxB).toBeLessThan(idxA);
    } finally {
      // Cleanup inserted messages and created hierarchy
      try {
        for (const id of insertedMessageIds) {
          db.prepare('DELETE FROM Messages WHERE id = ?').run(id);
        }
        db.prepare('DELETE FROM Scenes WHERE id = ?').run(sceneId);
        db.prepare('DELETE FROM Arcs WHERE id = ?').run(arcId);
        db.prepare('DELETE FROM Campaigns WHERE id = ?').run(campaignId);
        db.prepare('DELETE FROM Worlds WHERE id = ?').run(worldId);
      } catch (e) {
        // swallow cleanup errors but log for visibility
        // console.warn('Cleanup error in integration test:', e);
      }
    }
  });
});
