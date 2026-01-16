import db from '../database';
import * as fs from 'fs';
import * as path from 'path';
import { countTokens } from '../utils/tokenCounter.js';

export const MessageService = {
  // Updated logMessage to accept optional sourceId (personaId or characterId)
  // Signature kept backward-compatible: sourceId is optional last parameter
  logMessage(sceneId: number, sender: string, message: string, metadata: any = {}, source: string = '', roundNumber: number = 1, sourceId: string | null = null) {
    // Normalize sender: strip leading "user:" prefix if present
    let normalizedSender = String(sender || '');
    if (/^user:/i.test(normalizedSender)) {
      normalizedSender = normalizedSender.replace(/^user:/i, '').trim();
    }

    // Canonicalize source values
    const srcRaw = (String(source || '') || (metadata && metadata.source ? String(metadata.source) : '')).toLowerCase();
    let canonicalSource = '';
    if (srcRaw === 'user' || srcRaw === 'user-input' || srcRaw === 'user_input' || srcRaw === 'userinput') {
      canonicalSource = 'User';
    } else if (srcRaw === 'character' || srcRaw === 'continue-round' || srcRaw === 'continue_round' || srcRaw === 'ai' || srcRaw === 'ai-response') {
      canonicalSource = 'CharacterAgent';
    } else if (srcRaw === 'narrator' || srcRaw === 'narration') {
      canonicalSource = 'Narrator';
    } else if (srcRaw === 'system') {
      canonicalSource = 'System';
    } else if (srcRaw === 'image') {
      canonicalSource = 'Image';
    } else if (srcRaw && srcRaw.length > 0) {
      // Fallback: capitalize first
      canonicalSource = srcRaw.charAt(0).toUpperCase() + srcRaw.slice(1);
    } else {
      canonicalSource = '';
    }

    // Allow metadata to provide sourceId if available
    let resolvedSourceId: string | null = sourceId || null;
    if (!resolvedSourceId && metadata) {
      if (metadata.sourceId) resolvedSourceId = String(metadata.sourceId);
      else if (metadata.personaId) resolvedSourceId = String(metadata.personaId);
      else if (metadata.characterId) resolvedSourceId = String(metadata.characterId);
    }

    const row = db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId) as any;
    const next = (row?.maxNum ?? 0) + 1;
    const tokenCount = countTokens(message);
    let result: any;
    try {
      const stmt = db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, tokenCount, metadata, source, sourceId, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      result = stmt.run(sceneId, next, message, normalizedSender, tokenCount, JSON.stringify(metadata || {}), canonicalSource, resolvedSourceId, roundNumber);
    } catch (e: any) {
      // Fallback for older DB schemas that don't have sourceId column yet
      const msg = String(e && e.message ? e.message : e);
      if (msg.includes('no column named sourceId') || msg.includes('has no column named sourceId')) {
        const stmt2 = db.prepare('INSERT INTO Messages (sceneId, messageNumber, message, sender, tokenCount, metadata, source, roundNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        result = stmt2.run(sceneId, next, message, normalizedSender, tokenCount, JSON.stringify(metadata || {}), canonicalSource, roundNumber);
      } else {
        throw e;
      }
    }
    const inserted = db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.id = ?').get(result.lastInsertRowid) as any;
    if (inserted) {
      inserted.charactersPresent = JSON.parse(inserted.activeCharacters || '[]');
      try { inserted.metadata = JSON.parse(inserted.metadata || '{}'); } catch { inserted.metadata = inserted.metadata || {}; }
      delete inserted.activeCharacters;
    }
    return inserted || { id: result.lastInsertRowid, sceneId, messageNumber: next, message, sender: normalizedSender, tokenCount, source: canonicalSource, sourceId: resolvedSourceId, roundNumber };
  },

  getMessages(sceneId: number, limit = 100, offset = 0) {
    return db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.sceneId = ? ORDER BY m.messageNumber DESC LIMIT ? OFFSET ?').all(sceneId, limit, offset).map((r: any) => {
      r.charactersPresent = JSON.parse(r.activeCharacters || '[]');
      try { r.metadata = JSON.parse(r.metadata || '{}'); } catch { r.metadata = r.metadata || {}; }
      delete r.activeCharacters;
      return r;
    });
  },

  editMessage(id: number, newContent: string, metadata?: any) {
    if (metadata !== undefined) {
      const stmt = db.prepare('UPDATE Messages SET message = ?, metadata = ? WHERE id = ?');
      const result = stmt.run(newContent, JSON.stringify(metadata || {}), id);
      const updated = db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.id = ?').get(id) as any;
      if (updated) {
        updated.charactersPresent = JSON.parse(updated.activeCharacters || '[]');
        try { updated.metadata = JSON.parse(updated.metadata || '{}'); } catch { updated.metadata = updated.metadata || {}; }
        delete updated.activeCharacters;
      }
      return { changes: result.changes, row: updated };
    } else {
      const stmt = db.prepare('UPDATE Messages SET message = ? WHERE id = ?');
      const result = stmt.run(newContent, id);
      const updated = db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.id = ?').get(id) as any;
      if (updated) {
        updated.charactersPresent = JSON.parse(updated.activeCharacters || '[]');
        try { updated.metadata = JSON.parse(updated.metadata || '{}'); } catch { updated.metadata = updated.metadata || {}; }
        delete updated.activeCharacters;
      }
      return { changes: result.changes, row: updated };
    }
  },
  deleteMessage(id: number) {
    // Find the message and its sceneId and messageNumber
    const row = db.prepare('SELECT sceneId, messageNumber, message FROM Messages WHERE id = ?').get(id) as any;
    if (!row) return { changes: 0 };
    const { sceneId, messageNumber, message } = row;
    // Attempt to delete any stored files referenced by this message (local generated images)
    try {
      // Match image markdown and capture alt-text + target
      const matches = Array.from(String(message).matchAll(/!\[(.*?)\]\((.*?)\)/g));
      const extractUrlsFromAlt = (alt: string) => {
        const found: string[] = [];
        // Try to parse alt as JSON, unwrapping quoted JSON if necessary
        const tryParse = (s: any) => {
          if (typeof s !== 'string') return s;
          const str = s.trim();
          if (!(str.startsWith('{') || str.startsWith('[') || (str.startsWith('"{') && str.endsWith('"')))) return s;
          try { return JSON.parse(s); } catch { try { return JSON.parse(str.replace(/^"|"$/g, '')); } catch { return s; } }
        };
        const deepFindUrls = (obj: any) => {
          if (!obj) return;
          if (typeof obj === 'string') {
            // find http(s) urls in string
            const urlRe = /https?:\/\/[^\s"')\]]+/g;
            const matches = Array.from(new Set(Array.from(String(obj).matchAll(urlRe)).map(m => m[0])));
            for (const u of matches) found.push(u);
            return;
          }
          if (Array.isArray(obj)) {
            for (const v of obj) deepFindUrls(v);
            return;
          }
          if (typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
              const v = obj[k];
              if (k === 'urls' && Array.isArray(v)) {
                for (const u of v) found.push(String(u));
              } else {
                deepFindUrls(v);
              }
            }
          }
        };

        try {
          const parsed = tryParse(alt);
          if (parsed && parsed !== alt) {
            deepFindUrls(parsed);
          } else {
            // fallback: search plain alt text for URLs
            deepFindUrls(alt);
          }
        } catch (e) {
          // fallback to regex search
          deepFindUrls(alt);
        }
        return Array.from(new Set(found));
      };

      for (const m of matches) {
        const altText = m[1] || '';
        const linkTarget = m[2] || '';
        const candidateUrls = [] as string[];
        // include the link target
        if (linkTarget) candidateUrls.push(linkTarget);
        // include any URLs found inside alt JSON or text
        candidateUrls.push(...extractUrlsFromAlt(altText));

        for (const url of candidateUrls) {
          try {
            let rel = null;
            try {
              const u = new URL(url);
              rel = u.pathname.replace(/^\//, '');
            } catch (e) {
              // not an absolute URL, use as-is
              rel = url.replace(/^\//, '');
            }
            if (rel && rel.startsWith('public/generated/')) {
              const fp = path.join(process.cwd(), rel);
              if (fs.existsSync(fp)) fs.unlinkSync(fp);
            }
          } catch (e) {
            // ignore per-file errors
          }
        }
      }
    } catch (e) {
      // ignore
    }
    // Delete the message
    const del = db.prepare('DELETE FROM Messages WHERE id = ?').run(id);
    // Decrement messageNumber for all messages with higher messageNumber in same scene
    const upd = db.prepare('UPDATE Messages SET messageNumber = messageNumber - 1 WHERE sceneId = ? AND messageNumber > ?');
    upd.run(sceneId, messageNumber);
    // Clean up empty generated folders for this scene if present
    try {
      const sceneRow = db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
      if (sceneRow) {
        const arcRow = db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any;
        const campaignRow = db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
        const worldRow = db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;
        const sceneDir = path.join(process.cwd(), 'public', 'generated', String(worldRow.id), String(campaignRow.id), String(arcRow.id), String(sceneRow.id));
        // Remove empty directories up to public/generated
        const stopAt = path.join(process.cwd(), 'public', 'generated');
        let cur = sceneDir;
        while (cur && cur.startsWith(stopAt)) {
          try {
            if (fs.existsSync(cur)) {
              const files = fs.readdirSync(cur);
              if (files.length === 0) {
                fs.rmdirSync(cur);
                cur = path.dirname(cur);
                continue;
              }
            }
          } catch (e) {
            break;
          }
          break;
        }
      }
    } catch (e) {
      // ignore cleanup errors
    }

    return { deleted: del.changes };
  },

  moveMessage(id: number, direction: 'up' | 'down') {
    // Get current message
    const row = db.prepare('SELECT sceneId, messageNumber FROM Messages WHERE id = ?').get(id) as any;
    if (!row) return { changed: 0 };
    const { sceneId, messageNumber } = row;
    if (direction === 'up') {
      if (messageNumber <= 1) return { changed: 0 };
      // Find message with messageNumber - 1
      const other = db.prepare('SELECT id FROM Messages WHERE sceneId = ? AND messageNumber = ?').get(sceneId, messageNumber - 1) as any;
      if (!other) return { changed: 0 };
      // Use a temp value to avoid UNIQUE constraint conflicts, run in transaction
      const tx = db.transaction(() => {
        const tmp = -1000000;
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(tmp, id);
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(messageNumber, other.id);
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(messageNumber - 1, id);
      });
      try {
        tx();
        return { changed: 1 };
      } catch (e) {
        console.error('Failed to move message up transaction', e);
        return { changed: 0, error: String(e) };
      }
    } else {
      // down
      const maxRow = db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId) as any;
      const maxNum = maxRow?.maxNum ?? messageNumber;
      if (messageNumber >= maxNum) return { changed: 0 };
      const other = db.prepare('SELECT id FROM Messages WHERE sceneId = ? AND messageNumber = ?').get(sceneId, messageNumber + 1) as any;
      if (!other) return { changed: 0 };
      const tx = db.transaction(() => {
        const tmp = -1000000;
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(tmp, id);
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(messageNumber, other.id);
        db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(messageNumber + 1, id);
      });
      try {
        tx();
        return { changed: 1 };
      } catch (e) {
        console.error('Failed to move message down transaction', e);
        return { changed: 0, error: String(e) };
      }
    }
  },

  // Task 2.2: Get all messages for a specific round
  getRoundMessages(sceneId: number, roundNumber: number) {
    return db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.sceneId = ? AND m.roundNumber = ? ORDER BY m.messageNumber ASC').all(sceneId, roundNumber).map((r: any) => {
      r.charactersPresent = JSON.parse(r.activeCharacters || '[]');
      try { r.metadata = JSON.parse(r.metadata || '{}'); } catch { r.metadata = r.metadata || {}; }
      delete r.activeCharacters;
      return r;
    });
  },

  // Task 2.3: Get the latest (highest) round number for a scene
  getLatestRound(sceneId: number): number {
    const result = db.prepare('SELECT MAX(roundNumber) as maxRound FROM Messages WHERE sceneId = ?').get(sceneId) as any;
    return result?.maxRound || 1;
  },

  // Task 2.4: Get messages from the currently active round
  getCurrentRoundMessages(sceneId: number) {
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!scene) return [];
    return this.getRoundMessages(sceneId, scene.currentRoundNumber);
  },

  // Task 2.5: Utility methods for round operations
  getLastMessage(sceneId: number) {
    return db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.sceneId = ? ORDER BY m.messageNumber DESC LIMIT 1').get(sceneId) as any;
  },

  getLastMessageInRound(sceneId: number, roundNumber: number) {
    return db.prepare('SELECT m.*, sr.activeCharacters FROM Messages m LEFT JOIN SceneRounds sr ON m.sceneId = sr.sceneId AND m.roundNumber = sr.roundNumber WHERE m.sceneId = ? AND m.roundNumber = ? ORDER BY m.messageNumber DESC LIMIT 1').get(sceneId, roundNumber) as any;
  },

  getMessageCountInRound(sceneId: number, roundNumber: number): number {
    const result = db.prepare('SELECT COUNT(*) as count FROM Messages WHERE sceneId = ? AND roundNumber = ?').get(sceneId, roundNumber) as any;
    return result?.count || 0;
  },

  getRoundMessageCount(sceneId: number, roundNumber: number): number {
    return this.getMessageCountInRound(sceneId, roundNumber);
  },

  // Count messages in a scene created after a given ISO timestamp
  getMessageCountSince(sceneId: number, sinceIso: string): number {
    try {
      const result = db.prepare('SELECT COUNT(*) as count FROM Messages WHERE sceneId = ? AND timestamp > ?').get(sceneId, sinceIso) as any;
      return result?.count || 0;
    } catch (e) {
      console.warn('MessageService.getMessageCountSince failed:', e);
      return 0;
    }
  },
};

export default MessageService;
