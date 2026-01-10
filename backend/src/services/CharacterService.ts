import db, { charactersDb } from '../database';

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
  getBaseById(id: string) {
    console.log(`CharacterService: looking for base character with id ${id}`);
    const row = charactersDb.prepare('SELECT * FROM Characters WHERE id = ?').get(id) as any;
    if (!row) {
      console.log(`CharacterService: no base character found for id ${id}`);
      return null;
    }
    console.log(`CharacterService: found base character for id ${id}`);
    const parsed = JSON.parse(row.data);
    return { id: row.id, name: row.name, ...parsed, avatar: row.avatar };
  },

  getMergedCharacter({ characterId, worldId, campaignId }: { characterId: string; worldId?: number; campaignId?: number }) {
    let baseId = characterId;
    let base = this.getBaseById(baseId);
    if (!base) {
      const chars = this.getAllCharacters();
      const char = chars.find(c => c.name.toLowerCase() === characterId.toLowerCase());
      if (char) {
        base = char;
        baseId = char.id;
      } else {
        return null;
      }
    }
    let result = { ...base };

    if (worldId) {
      const wo = db.prepare('SELECT overrideData FROM WorldCharacterOverrides WHERE worldId = ? AND characterId = ?').get(worldId, baseId) as any;
      if (wo) {
        const override = JSON.parse(wo.overrideData);
        result = deepMerge(result, override);
      }
    }

    if (campaignId) {
      const co = db.prepare('SELECT overrideData FROM CampaignCharacterOverrides WHERE campaignId = ? AND characterId = ?').get(campaignId, baseId) as any;
      if (co) {
        const override = JSON.parse(co.overrideData);
        result = deepMerge(result, override);
      }
    }

    return result;
  },

  saveBaseCharacter(idOrName: string, dataOrName: any, avatarOrData?: string, dataIfAvatar?: any) {
    // Handle both create and update cases
    let id: string, name: string, data: any, avatar: string | undefined;
    
    if (typeof dataOrName === 'string') {
      // Create new: saveBaseCharacter(name, data, avatar?)
      id = crypto.randomUUID();
      name = idOrName;
      data = dataOrName;
      avatar = avatarOrData;
    } else {
      // Update existing: saveBaseCharacter(id, data, avatar?)
      id = idOrName;
      const existing = this.getBaseById(id);
      name = existing?.name || 'Unknown';
      data = dataOrName;
      avatar = avatarOrData;
    }
    
    const existing = this.getBaseById(id);
    if (existing) {
      // Update existing
      const stmt = charactersDb.prepare('UPDATE Characters SET name = ?, avatar = ?, data = ? WHERE id = ?');
      stmt.run(name, avatar || null, JSON.stringify(data), id);
    } else {
      // Create new
      const stmt = charactersDb.prepare('INSERT INTO Characters (id, name, avatar, data) VALUES (?, ?, ?, ?)');
      stmt.run(id, name, avatar || null, JSON.stringify(data));
    }
    return { id, name, avatar };
  },

  getAllCharacters() {
    const rows = charactersDb.prepare('SELECT * FROM Characters').all() as any[];
    return rows.map(row => {
      const parsed = JSON.parse(row.data);
      return { id: row.id, name: row.name, ...parsed, avatar: row.avatar };
    });
  },

  deleteCharacter(slug: string) {
    charactersDb.prepare('DELETE FROM Characters WHERE id = ?').run(slug);
  }
};

export default CharacterService;
