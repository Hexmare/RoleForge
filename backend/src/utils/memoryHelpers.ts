/**
 * Memory helper utilities extracted from memoryRetriever for reuse and testing
 */

export async function computeDecayAdjustedScore(originalScore: number, metadata: Record<string, any>, decayCfg: any, messageServiceOverride?: any): Promise<number> {
  let score = originalScore;
  if (!decayCfg || !decayCfg.enabled || (metadata && metadata.temporalBlind)) return score;

  const mode = decayCfg.mode || 'time';
  const floor = (decayCfg.floor !== undefined) ? Number(decayCfg.floor) : 0.3;

  if (mode === 'messageCount') {
    let msgSince = Number(metadata && (metadata.messageCountSince || metadata.message_count_since || metadata.messages_since));
    if (isNaN(msgSince)) {
      try {
        const sceneId = metadata && (metadata.sceneId || metadata.scene_id || metadata.scene);
        const ts = metadata && (metadata.timestamp || metadata.stored_at);
        if (sceneId && ts) {
          if (messageServiceOverride && typeof messageServiceOverride.getMessageCountSince === 'function') {
            try {
              msgSince = Number(await messageServiceOverride.getMessageCountSince(Number(sceneId), ts));
            } catch (e) {
              msgSince = NaN;
            }
          } else {
            const { MessageService } = await import('../services/MessageService.js');
            try {
              msgSince = Number(await MessageService.getMessageCountSince(Number(sceneId), ts));
            } catch (e) {
              msgSince = NaN;
            }
          }
        }
      } catch (e) {
        msgSince = NaN;
      }
    }

    if (!isNaN(msgSince)) {
      const halfLifeMsgs = (decayCfg.halfLife && Number(decayCfg.halfLife)) || 50;
      const rawFactor = Math.pow(0.5, msgSince / Math.max(1, halfLifeMsgs));
      const decayFactor = Math.max(rawFactor, floor);
      score = score * decayFactor;
    } else {
      // Fallback to time-based
      const ts = metadata && (metadata.timestamp || metadata.stored_at);
      if (ts) {
        const created = Date.parse(ts);
        if (!isNaN(created)) {
          const ageMs = Date.now() - created;
          const halfLifeDays = (decayCfg.halfLife && Number(decayCfg.halfLife)) || 7;
          const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
          const rawFactor = Math.pow(0.5, ageMs / Math.max(1, halfLifeMs));
          const decayFactor = Math.max(rawFactor, floor);
          score = score * decayFactor;
        }
      }
    }
  } else {
    // time-based
    const ts = metadata && (metadata.timestamp || metadata.stored_at);
    if (ts) {
      const created = Date.parse(ts);
      if (!isNaN(created)) {
        const ageMs = Date.now() - created;
        const halfLifeDays = (decayCfg.halfLife && Number(decayCfg.halfLife)) || 7;
        const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
        const rawFactor = Math.pow(0.5, ageMs / Math.max(1, halfLifeMs));
        const decayFactor = Math.max(rawFactor, floor);
        score = score * decayFactor;
      }
    }
  }

  return score;
}

export function applyConditionalBoost(originalScore: number, metadata: Record<string, any>, rules: any[] = [], context?: { text?: string }): number {
  let score = originalScore;
  if (!Array.isArray(rules) || rules.length === 0) return score;

  // Simple keyword-based emotion detector fallback
  function detectEmotionFromText(text?: string): string {
    if (!text) return 'neutral';
    const t = String(text).toLowerCase();
    if (t.includes('happy') || t.includes('joy') || t.includes('glad') || t.includes('love')) return 'happy';
    if (t.includes('sad') || t.includes('sorrow') || t.includes('unhappy')) return 'sad';
    if (t.includes('angry') || t.includes('mad') || t.includes('rage')) return 'angry';
    if (t.includes('fear') || t.includes('scared') || t.includes('afraid')) return 'fear';
    return 'neutral';
  }

  let boostMultiplier = 1;
  for (const rule of rules) {
    try {
      const field = String(rule.field || '').trim();
      if (!field) continue;
      const matchVal = rule.match;
      const boost = Number(rule.boost) || 1;
      const matchType = rule.matchType || 'substring';

      // Support matching against memory text when rule.field is 'text' or starts with 'text.'
      let target: any = undefined;
      if (field === 'text' || field.startsWith('text.')) {
        target = context && context.text ? context.text : undefined;
        if (field !== 'text' && target != null) {
          const parts = field.split('.').slice(1);
          for (const p of parts) {
            if (target == null) break;
            target = target[p];
          }
        }
      } else if (field === 'emotion' || field.endsWith('.emotion')) {
        // Emotion may be present in metadata or inferred from text
        const parts = field.split('.');
        let metaTarget: any = metadata || {};
        for (const p of parts) {
          if (metaTarget == null) break;
          metaTarget = metaTarget[p];
        }
        target = metaTarget != null ? metaTarget : detectEmotionFromText(context && context.text ? context.text : undefined);
      } else {
        const parts = field.split('.');
        let metaTarget: any = metadata || {};
        for (const p of parts) {
          if (metaTarget == null) break;
          metaTarget = metaTarget[p];
        }
        target = metaTarget;
      }

      if (target == null) continue;
      const targetStr = String(target).toLowerCase();
      const mStr = String(matchVal).toLowerCase();
      let matched = false;
      if (matchType === 'exact') matched = targetStr === mStr;
      else matched = targetStr.includes(mStr);
      if (matched) boostMultiplier *= boost;
    } catch (_) {
      // ignore rule errors
    }
  }

  return score * boostMultiplier;
}

export function formatMemoriesForPrompt(memories: Array<{ text: string; similarity?: number; metadata?: Record<string, any> }>): string {
  if (!Array.isArray(memories) || memories.length === 0) return '';

  let formatted = '## Relevant Memories\n';
  for (const memory of memories) {
    const confidence = Math.round((memory.similarity || 0) * 100);
    let messageContent = memory.text || '';
    const colonIndex = messageContent.indexOf(': ');
    if (colonIndex !== -1) {
      const parts = messageContent.split(': ');
      if (parts.length > 1) messageContent = parts.slice(1).join(': ');
    }
    formatted += `- [${confidence}%] ${messageContent}\n`;
  }
  return formatted;
}

export default {
  computeDecayAdjustedScore,
  applyConditionalBoost
};

export function getNestedField(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((current: any, key: string) => current?.[key], obj);
}

export function matchesFilter(metadata: Record<string, any>, filter: Record<string, any>, options?: { matchType?: 'exact' | 'substring'; caseInsensitive?: boolean }): boolean {
  if (!filter || typeof filter !== 'object') return false;
  const opts = { matchType: 'exact', caseInsensitive: false, ...(options || {}) } as const;

  for (const rawKey of Object.keys(filter)) {
    const expected = filter[rawKey];
    // Support nested field keys using dot-notation
    const actual = getNestedField(metadata || {}, rawKey);

    if (actual === undefined) return false;

    if (opts.matchType === 'exact') {
      if (opts.caseInsensitive && typeof actual === 'string' && typeof expected === 'string') {
        if (String(actual).toLowerCase() !== String(expected).toLowerCase()) return false;
      } else {
        if (actual !== expected) return false;
      }
    } else {
      // substring match
      const a = String(actual);
      const b = String(expected);
      if (opts.caseInsensitive) {
        if (!a.toLowerCase().includes(b.toLowerCase())) return false;
      } else {
        if (!a.includes(b)) return false;
      }
    }
  }

  return true;
}

export function parseTimestampToMs(ts: any): number {
  if (ts === undefined || ts === null) return NaN;
  if (typeof ts === 'number') return Number(ts);
  if (typeof ts === 'string') {
    // Allow epoch ms string or ISO
    const asNum = Number(ts);
    if (!isNaN(asNum)) return asNum;
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? NaN : parsed;
  }
  if (ts instanceof Date) return ts.getTime();
  return NaN;
}

export function getAgeMsFromMetadata(metadata: Record<string, any>): number {
  const ts = metadata && (metadata.timestamp || metadata.stored_at);
  const t = parseTimestampToMs(ts);
  if (isNaN(t)) return NaN;
  return Date.now() - t;
}

export function normalizeIndexItems(rawItems: any[]): Array<{ id: string; metadata: Record<string, any> }> {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((it: any) => {
    const id = it?.id || it?.item?.id || it?.item?.item?.id || (it?.item && it.item.id) || (it && it.id);
    const metadata = it?.metadata || it?.meta || it?.item?.metadata || it?.item?.item?.metadata || {};
    return { id, metadata } as any;
  }).filter((x: any) => x.id);
}
