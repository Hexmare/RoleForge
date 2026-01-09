import db from '../database';

function deepMerge(target: any, ...sources: any[]) {
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (Array.isArray(val)) {
        target[key] = val;
      } else if (val && typeof val === 'object') {
        target[key] = deepMerge(target[key] || {}, val);
      } else {
        target[key] = val;
      }
    }
  }
  return target;
}

export const CharacterService = {
  getBaseById(id: number) {
    const row = db.prepare('SELECT * FROM BaseCharacters WHERE id = ?').get(id) as any;
    if (!row) return null;
    row.data = JSON.parse(row.data);
    return row;
  },

  getBaseBySlug(slug: string) {
    const row = db.prepare('SELECT * FROM BaseCharacters WHERE slug = ?').get(slug) as any;
    if (!row) return null;
    row.data = JSON.parse(row.data);
    return row;
  },

  getMergedCharacter({ worldId, campaignId, characterSlug }: { worldId?: number; campaignId?: number; characterSlug: string }) {
    const base = this.getBaseBySlug(characterSlug);
    if (!base) return null;
    let result = JSON.parse(JSON.stringify(base.data));

    if (worldId) {
      const wo = db.prepare('SELECT overrideData FROM WorldCharacterOverrides WHERE worldId = ? AND characterId = ?').get(worldId, base.id) as any;
      if (wo) {
        const override = JSON.parse(wo.overrideData);
        result = deepMerge(result, override);
      }
    }

    if (campaignId) {
      const co = db.prepare('SELECT overrideData FROM CampaignCharacterOverrides WHERE campaignId = ? AND characterId = ?').get(campaignId, base.id) as any;
      if (co) {
        const override = JSON.parse(co.overrideData);
        result = deepMerge(result, override);
      }
    }

    return result;
  },

  saveBaseCharacter(slug: string, data: any) {
    const existing = db.prepare('SELECT id FROM BaseCharacters WHERE slug = ?').get(slug);
    if (existing) {
      const stmt = db.prepare('UPDATE BaseCharacters SET data = ? WHERE id = ?');
      stmt.run(JSON.stringify(data), existing.id);
      return { id: existing.id };
    } else {
      const stmt = db.prepare('INSERT INTO BaseCharacters (slug, data) VALUES (?, ?)');
      const res = stmt.run(slug, JSON.stringify(data));
      return { id: res.lastInsertRowid };
    }
  }
};

export default CharacterService;
