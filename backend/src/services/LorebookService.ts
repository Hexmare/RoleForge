import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import db from '../database';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const lorebooksPath = path.join(__dirname, '..', '..', 'data', 'lorebooks.db');

let lbDb: Database.Database | null = null;
function getLbDb() {
  if (lbDb) return lbDb;
  const dataDir = path.dirname(lorebooksPath);
  try {
    if (!fsExistsSync(dataDir)) {
      fsMkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    // ignore mkdir errors; DB open will fail with meaningful error
  }
  // open DB
  lbDb = new Database(lorebooksPath);
  // ensure schema exists (create tables if missing)
  try {
    lbDb.prepare(`
      CREATE TABLE IF NOT EXISTS Lorebooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        scan_depth INTEGER DEFAULT 4,
        token_budget INTEGER DEFAULT 2048,
        recursive_scanning INTEGER DEFAULT 1,
        extensions TEXT DEFAULT '[]',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME
      )
    `).run();

    lbDb.prepare(`
      CREATE TABLE IF NOT EXISTS LoreEntries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lorebookUuid TEXT NOT NULL,
        uid INTEGER NOT NULL,
        key TEXT,
        optional_filter TEXT,
        title_memo TEXT,
        content TEXT,
        constant INTEGER DEFAULT 0,
        selective INTEGER DEFAULT 0,
        selectiveLogic INTEGER DEFAULT 0,
        insertion_order INTEGER DEFAULT 100,
        insertion_position TEXT,
        outletName TEXT,
        enabled INTEGER DEFAULT 1,
        preventRecursion INTEGER DEFAULT 0,
        probability INTEGER DEFAULT 100,
        useProbability INTEGER DEFAULT 0,
        depth INTEGER,
        caseSensitive INTEGER DEFAULT 0,
        matchWholeWords INTEGER DEFAULT 1,
        vectorized INTEGER DEFAULT 0,
        groupName TEXT,
        groupOverride INTEGER DEFAULT 0,
        groupWeight INTEGER DEFAULT 50,
        useGroupScoring INTEGER DEFAULT 0,
        automationId TEXT,
        sticky INTEGER DEFAULT 0,
        cooldown INTEGER DEFAULT 0,
        delay INTEGER DEFAULT 0,
        triggers TEXT,
        additional_matching_sources TEXT,
        extensions TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME
      )
    `).run();
    lbDb.prepare('CREATE INDEX IF NOT EXISTS idx_loreentries_lorebookUid ON LoreEntries(lorebookUuid, uid)').run();
  } catch (e) {
    // if schema creation fails, let DB usage fail later with clearer error
  }
  // ensure WAL mode
  try { lbDb.pragma('journal_mode = WAL'); } catch (e) {}
  return lbDb;
}

// small helpers to avoid importing fs at top-level for tests
import { existsSync as fsExistsSync, mkdirSync as fsMkdirSync } from 'fs';

interface LorebookRow {
  uuid: string;
  name: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: number;
  extensions?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const LorebookService = {
  listAll() {
    const db = getLbDb();
    return db.prepare('SELECT * FROM Lorebooks ORDER BY name').all();
  },

  getEntries(lorebookUuid: string) {
    const db = getLbDb();
    const rows: any[] = db.prepare('SELECT * FROM LoreEntries WHERE lorebookUuid = ? ORDER BY uid').all(lorebookUuid);
    const tryParse = (v: any) => {
      if (v === null || v === undefined) return v;
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch { return v; }
    };
    return rows.map(r => ({
      ...r,
      key: tryParse(r.key),
      optional_filter: tryParse(r.optional_filter),
      triggers: tryParse(r.triggers),
      additional_matching_sources: tryParse(r.additional_matching_sources),
      extensions: tryParse(r.extensions),
    }));
  },
  createLorebook({ name, description, settings }: { name: string; description?: string; settings?: any }) {
    const uuid = randomUUID();
    const db = getLbDb();
    const stmt = db.prepare(
      `INSERT INTO Lorebooks (uuid, name, description, scan_depth, token_budget, recursive_scanning, extensions) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const scanDepth = settings?.scan_depth ?? 4;
    const tokenBudget = settings?.token_budget ?? 2048;
    const recursive = settings?.recursive_scanning ? 1 : 1;
    const extensions = settings?.extensions ? JSON.stringify(settings.extensions) : JSON.stringify([]);
    stmt.run(uuid, name, description || null, scanDepth, tokenBudget, recursive, extensions);
    return this.getLorebook(uuid);
  },

  getLorebook(uuid: string) {
    const db = getLbDb();
    const row: any = db.prepare('SELECT * FROM Lorebooks WHERE uuid = ?').get(uuid);
    if (!row) return null;
    const rawEntries = db.prepare('SELECT * FROM LoreEntries WHERE lorebookUuid = ? ORDER BY uid').all(uuid) as any[];
    const tryParse = (v: any) => {
      if (v === null || v === undefined) return v;
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch { return v; }
    };
    const entries = rawEntries.map(r => ({
      ...r,
      key: tryParse(r.key),
      optional_filter: tryParse(r.optional_filter),
      triggers: tryParse(r.triggers),
      additional_matching_sources: tryParse(r.additional_matching_sources),
      extensions: tryParse(r.extensions),
    }));
    return { ...row, entries };
  },

  updateLorebook(uuid: string, data: Partial<{ name: string; description: string; settings: any }>) {
    const db = getLbDb();
    const existing: any = db.prepare('SELECT * FROM Lorebooks WHERE uuid = ?').get(uuid);
    if (!existing) return null;
    const name = data.name ?? existing.name;
    const description = data.description ?? existing.description;
    const settings = data.settings ?? {};
    const scanDepth = settings.scan_depth ?? existing.scan_depth ?? 4;
    const tokenBudget = settings.token_budget ?? existing.token_budget ?? 2048;
    const recursive = settings.recursive_scanning ?? existing.recursive_scanning ?? 1;
    const extensions = settings.extensions ? JSON.stringify(settings.extensions) : existing.extensions ?? JSON.stringify([]);
    const stmt = db.prepare(
      `UPDATE Lorebooks SET name = ?, description = ?, scan_depth = ?, token_budget = ?, recursive_scanning = ?, extensions = ?, updatedAt = CURRENT_TIMESTAMP WHERE uuid = ?`
    );
    stmt.run(name, description, scanDepth, tokenBudget, recursive, extensions, uuid);
    return this.getLorebook(uuid);
  },

  deleteLorebook(uuid: string) {
    const deleteTxn = getLbDb().transaction(() => {
      const db2 = getLbDb();
      db2.prepare('DELETE FROM LoreEntries WHERE lorebookUuid = ?').run(uuid);
      db2.prepare('DELETE FROM Lorebooks WHERE uuid = ?').run(uuid);
    });
    deleteTxn();

    // Clean references from main roleforge DB join tables if present
    try {
      db.prepare('DELETE FROM World_Lorebooks WHERE lorebookUuid = ?').run(uuid);
    } catch (e) {
      // table may not exist yet
    }
    try {
      db.prepare('DELETE FROM Campaign_Lorebooks WHERE lorebookUuid = ?').run(uuid);
    } catch (e) {
      // table may not exist yet
    }

    return { deleted: true };
  },

  getNextUid(lorebookUuid: string) {
    const db = getLbDb();
    const row: any = db.prepare('SELECT MAX(uid) as m FROM LoreEntries WHERE lorebookUuid = ?').get(lorebookUuid);
    const max = row && row.m ? Number(row.m) : 0;
    return max + 1;
  },

  addEntry(lorebookUuid: string, entry: any) {
    const uid = this.getNextUid(lorebookUuid);
    const db = getLbDb();
    const insert = db.prepare(
      `INSERT INTO LoreEntries (
         lorebookUuid, uid, key, optional_filter, title_memo, content, constant, selective, selectiveLogic,
         insertion_order, insertion_position, outletName, enabled, preventRecursion, probability, useProbability,
         depth, caseSensitive, matchWholeWords, vectorized, groupName, groupOverride, groupWeight, useGroupScoring,
         automationId, sticky, cooldown, delay, triggers, additional_matching_sources, extensions
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const params = [
      lorebookUuid,
      uid,
      JSON.stringify(entry.key ?? []),
      entry.optional_filter ? JSON.stringify(entry.optional_filter) : null,
      entry.title_memo ?? null,
      entry.content ?? '',
      entry.constant ? 1 : 0,
      entry.selective ? 1 : 0,
      entry.selectiveLogic ?? 0,
      entry.insertion_order ?? 100,
      entry.insertion_position ?? 'Before Char Defs',
      entry.outletName ?? null,
      entry.enabled === false ? 0 : 1,
      entry.preventRecursion ? 1 : 0,
      entry.probability ?? 100,
      entry.useProbability ? 1 : 0,
      entry.depth ?? null,
      entry.caseSensitive ? 1 : 0,
      entry.matchWholeWords === false ? 0 : 1,
      entry.vectorized ? 1 : 0,
      entry.group ?? null,
      entry.groupOverride ? 1 : 0,
      entry.groupWeight ?? 50,
      entry.useGroupScoring ? 1 : 0,
      entry.automationId ?? null,
      entry.sticky ?? 0,
      entry.cooldown ?? 0,
      entry.delay ?? 0,
      entry.triggers ? JSON.stringify(entry.triggers) : null,
      entry.additional_matching_sources ? JSON.stringify(entry.additional_matching_sources) : null,
      entry.extensions ? JSON.stringify(entry.extensions) : null
    ];

    const info = insert.run(...params);
    return db.prepare('SELECT * FROM LoreEntries WHERE id = ?').get(info.lastInsertRowid);
  },

  updateEntry(lorebookUuid: string, entryId: number, entry: any) {
    const db = getLbDb();
    const existing: any = db.prepare('SELECT * FROM LoreEntries WHERE id = ? AND lorebookUuid = ?').get(entryId, lorebookUuid);
    if (!existing) return null;
    const stmt = getLbDb().prepare(
      `UPDATE LoreEntries SET key = ?, optional_filter = ?, title_memo = ?, content = ?, constant = ?, selective = ?, selectiveLogic = ?,
        insertion_order = ?, insertion_position = ?, outletName = ?, enabled = ?, preventRecursion = ?, probability = ?, useProbability = ?,
        depth = ?, caseSensitive = ?, matchWholeWords = ?, vectorized = ?, groupName = ?, groupOverride = ?, groupWeight = ?, useGroupScoring = ?,
        automationId = ?, sticky = ?, cooldown = ?, delay = ?, triggers = ?, additional_matching_sources = ?, extensions = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND lorebookUuid = ?`
    );

    const params = [
      JSON.stringify(entry.key ?? JSON.parse(existing.key)),
      entry.optional_filter ? JSON.stringify(entry.optional_filter) : existing.optional_filter,
      entry.title_memo ?? existing.title_memo,
      entry.content ?? existing.content,
      entry.constant ? 1 : existing.constant,
      entry.selective ? 1 : existing.selective,
      entry.selectiveLogic ?? existing.selectiveLogic,
      entry.insertion_order ?? existing.insertion_order,
      entry.insertion_position ?? existing.insertion_position,
      entry.outletName ?? existing.outletName,
      entry.enabled === undefined ? existing.enabled : (entry.enabled ? 1 : 0),
      entry.preventRecursion ? 1 : existing.preventRecursion,
      entry.probability ?? existing.probability,
      entry.useProbability ? 1 : existing.useProbability,
      entry.depth ?? existing.depth,
      entry.caseSensitive ? 1 : existing.caseSensitive,
      entry.matchWholeWords === undefined ? existing.matchWholeWords : (entry.matchWholeWords ? 1 : 0),
      entry.vectorized ? 1 : existing.vectorized,
      entry.group ?? existing.groupName,
      entry.groupOverride ? 1 : existing.groupOverride,
      entry.groupWeight ?? existing.groupWeight,
      entry.useGroupScoring ? 1 : existing.useGroupScoring,
      entry.automationId ?? existing.automationId,
      entry.sticky ?? existing.sticky,
      entry.cooldown ?? existing.cooldown,
      entry.delay ?? existing.delay,
      entry.triggers ? JSON.stringify(entry.triggers) : existing.triggers,
      entry.additional_matching_sources ? JSON.stringify(entry.additional_matching_sources) : existing.additional_matching_sources,
      entry.extensions ? JSON.stringify(entry.extensions) : existing.extensions,
      entryId,
      lorebookUuid
    ];

    stmt.run(...params);
    return db.prepare('SELECT * FROM LoreEntries WHERE id = ?').get(entryId);
  },

  deleteEntry(lorebookUuid: string, entryId: number) {
    const db = getLbDb();
    const stmt = db.prepare('DELETE FROM LoreEntries WHERE id = ? AND lorebookUuid = ?');
    const info = stmt.run(entryId, lorebookUuid);
    return { changes: info.changes };
  }
,

  // Normalize a SillyTavern-style lorebook JSON to our schema
  normalizeSillyTavern(json: any) {
    // basic mapping: name, description, settings, entries[]
    const name = json.name || json.title || 'Imported Lorebook';
    const description = json.description || json.info || '';
    const settings: any = {};
    if (json.scan_depth) settings.scan_depth = json.scan_depth;
    if (json.token_budget) settings.token_budget = json.token_budget;
    const entries: any[] = Array.isArray(json.entries) ? json.entries : (json.items || []);
    const normalizedEntries = entries.map((e: any) => {
      const rawKey = e.key || e.keys || e.match || (e.trigger ? e.trigger : undefined);
      const optional_filter = e.keysecondary || e.optional_filter || e.filters || null;

      // Normalize primary key: if it's a pipe-delimited string, split on '|' and trim
      let normKey: any[] = [];
      if (Array.isArray(rawKey)) {
        normKey = rawKey.map((k: any) => (typeof k === 'string' ? k.trim() : String(k))).filter(Boolean);
      } else if (typeof rawKey === 'string') {
        if (rawKey.includes('|')) {
          normKey = rawKey.split('|').map((s: string) => s.trim()).filter(Boolean);
        } else if (rawKey.trim().length) {
          normKey = [rawKey.trim()];
        }
      } else if (rawKey !== undefined && rawKey !== null) {
        normKey = [String(rawKey)];
      }

      // Normalize optional filter similarly if given as pipe-delimited string
      let normFilter: any = null;
      if (Array.isArray(optional_filter)) {
        normFilter = optional_filter.map((f: any) => (typeof f === 'string' ? f.trim() : String(f))).filter(Boolean);
      } else if (typeof optional_filter === 'string') {
        if (optional_filter.includes('|')) normFilter = optional_filter.split('|').map((s: string) => s.trim()).filter(Boolean);
        else normFilter = optional_filter.trim().length ? [optional_filter.trim()] : null;
      }

      return {
        key: normKey,
        optional_filter: normFilter,
        title_memo: e.comment ?? e.title ?? e.name ?? null,
        content: e.content || e.text || e.value || '',
        constant: e.constant || false,
        selective: e.selective || false,
        selectiveLogic: e.selectiveLogic ?? e.selective_logic ?? 0,
        insertion_order: e.insertion_order ?? e.order ?? 100,
        insertion_position: (() => {
          if (e.insertion_position) return e.insertion_position;
          if (e.position !== undefined) {
            // Map old numeric position to string
            const posMap: { [key: number]: string } = {
              0: 'Before Char Defs',
              1: 'After Char Defs',
              2: 'Top of AN',
              3: 'Bottom of AN',
              4: 'In Chat @Depth',
              5: 'Deep Chat @Depth'
            };
            return posMap[e.position] || 'Before Char Defs';
          }
          return 'Before Char Defs';
        })(),
        outletName: e.outletName || e.outlet || null,
        enabled: (e.disabled === true) ? 0 : (e.enabled === false ? 0 : 1),
        preventRecursion: e.preventRecursion || false,
        probability: e.probability ?? 100,
        useProbability: e.useProbability || false,
        depth: e.depth ?? null,
        caseSensitive: e.caseSensitive || false,
        matchWholeWords: (e.matchWholeWords === undefined) ? true : e.matchWholeWords,
        vectorized: e.vectorized || false,
        group: e.group || e.groupName || null,
        groupOverride: e.groupOverride || false,
        groupWeight: e.groupWeight ?? 50,
        useGroupScoring: e.useGroupScoring || false,
        automationId: e.automationId || null,
        sticky: e.sticky ?? 0,
        cooldown: e.cooldown ?? 0,
        delay: e.delay ?? 0,
        triggers: e.triggers ?? [],
        additional_matching_sources: e.additional_matching_sources ?? [],
        extensions: e.extensions ?? null
      };
    });
    return { name, description, settings, entries: normalizedEntries };
  },

  // Import a SillyTavern JSON object (or our export format) and create a lorebook + entries
  importFromSillyTavern(json: any) {
    // Validate input structure
    if (!json || typeof json !== 'object') throw new Error('Invalid JSON payload');
    const normalized = this.normalizeSillyTavern(json);
    if (!normalized.name || typeof normalized.name !== 'string') throw new Error('Lorebook missing name');
    if (!Array.isArray(normalized.entries)) throw new Error('Lorebook entries must be an array');
    if (normalized.entries.length > 2000) throw new Error('Too many entries in import (limit 2000)');

    // Validate individual entries
    for (let i = 0; i < normalized.entries.length; i++) {
      const e = normalized.entries[i];
      if (!e || typeof e !== 'object') throw new Error(`Entry ${i} is invalid`);
      if (!Array.isArray(e.key) || e.key.length === 0) throw new Error(`Entry ${i} missing key array`);
      if (typeof e.content !== 'string') throw new Error(`Entry ${i} missing content`);
      // sanitize keys to strings
      e.key = e.key.map((k: any) => (typeof k === 'string' ? k : String(k)));
      if (e.optional_filter && !Array.isArray(e.optional_filter)) e.optional_filter = [String(e.optional_filter)];
    }

    const lb = this.createLorebook({ name: normalized.name, description: normalized.description, settings: normalized.settings });
    const uuid = lb && lb.uuid;
    if (!uuid) throw new Error('Failed to create lorebook');
    for (const e of normalized.entries) {
      this.addEntry(uuid, e);
    }
    return this.getLorebook(uuid);
  },

  // Export a lorebook to a SillyTavern-compatible JSON structure
  exportForSillyTavern(uuid: string) {
    const lb: any = this.getLorebook(uuid);
    if (!lb) return null;
    const out: any = {
      name: lb.name,
      description: lb.description || '',
      scan_depth: lb.scan_depth ?? lb.scanDepth ?? 4,
      token_budget: lb.token_budget ?? lb.tokenBudget ?? 2048,
      entries: (lb.entries || []).map((e: any) => ({
        uid: e.uid,
        key: (() => { try { return JSON.parse(e.key); } catch { return e.key; } })(),
        optional_filter: e.optional_filter ? (() => { try { return JSON.parse(e.optional_filter); } catch { return e.optional_filter; } })() : null,
        title: e.title_memo,
        comment: e.title_memo,
        content: e.content,
        constant: Boolean(e.constant),
        selective: Boolean(e.selective),
        selectiveLogic: e.selectiveLogic,
        insertion_order: e.insertion_order,
        insertion_position: e.insertion_position,
        outletName: e.outletName,
        enabled: Boolean(e.enabled),
        preventRecursion: Boolean(e.preventRecursion),
        probability: e.probability,
        useProbability: Boolean(e.useProbability),
        depth: e.depth,
        caseSensitive: Boolean(e.caseSensitive),
        matchWholeWords: Boolean(e.matchWholeWords),
        vectorized: Boolean(e.vectorized),
        group: e.groupName || e.group,
        groupOverride: Boolean(e.groupOverride),
        groupWeight: e.groupWeight,
        useGroupScoring: Boolean(e.useGroupScoring),
        automationId: e.automationId,
        sticky: e.sticky,
        cooldown: e.cooldown,
        delay: e.delay,
        triggers: e.triggers ? (() => { try { return JSON.parse(e.triggers); } catch { return e.triggers; } })() : [],
        additional_matching_sources: e.additional_matching_sources ? (() => { try { return JSON.parse(e.additional_matching_sources); } catch { return e.additional_matching_sources; } })() : [],
        extensions: e.extensions ? (() => { try { return JSON.parse(e.extensions); } catch { return e.extensions; } })() : null
      }))
    };
    return out;
  },

  // Get active lorebooks for a world and campaign, merging entries
  getActiveLorebooks(worldId: number, campaignId: number) {
    console.log(`[LORE] LorebookService.getActiveLorebooks called for worldId=${worldId}, campaignId=${campaignId}`);
    // Get lorebook UUIDs assigned to world
    const worldLorebookUuids: string[] = db.prepare('SELECT lorebookUuid FROM World_Lorebooks WHERE worldId = ?').all(worldId).map((r: any) => r.lorebookUuid);
    console.log(`[LORE] World lorebooks found: ${worldLorebookUuids.length} (${worldLorebookUuids.join(', ') || 'none'})`);
    // Get lorebook UUIDs assigned to campaign
    const campaignLorebookUuids: string[] = db.prepare('SELECT lorebookUuid FROM Campaign_Lorebooks WHERE campaignId = ?').all(campaignId).map((r: any) => r.lorebookUuid);
    console.log(`[LORE] Campaign lorebooks found: ${campaignLorebookUuids.length} (${campaignLorebookUuids.join(', ') || 'none'})`);
    // Merge unique UUIDs (campaign overrides world if duplicate, but since UUIDs are unique, just combine)
    const allUuids = [...new Set([...worldLorebookUuids, ...campaignLorebookUuids])];
    console.log(`[LORE] Total merged lorebook UUIDs: ${allUuids.length}`);
    const lorebooks: any[] = [];
    for (const uuid of allUuids) {
      const lb = this.getLorebook(uuid);
      if (lb) {
        console.log(`[LORE] Loaded lorebook: ${lb.name} (${lb.uuid}), entries: ${(lb.entries || []).length}`);
        lorebooks.push(lb);
      } else {
        console.warn(`[LORE] Failed to load lorebook with uuid: ${uuid}`);
      }
    }
    console.log(`[LORE] Total lorebooks loaded: ${lorebooks.length}`);
    return lorebooks;
  }
};

export default LorebookService;
