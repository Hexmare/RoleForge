import Database from 'better-sqlite3';
import CharacterService from '../../services/CharacterService.js';
import SceneService from '../../services/SceneService.js';
import LorebookService from '../../services/LorebookService.js';
import { matchLoreEntries } from '../../utils/loreMatcher.js';
import { AgentContextEnvelope, CharacterSummary, PersonaSummary, RequestType, TokenBudgetMetadata, SectionCap, TokenAllocation } from './types.js';

export interface BuildAgentContextEnvelopeOptions {
  db: Database.Database;
  sceneId: number;
  requestType: RequestType;
  roundNumber?: number;
  historyWindow?: number;
  summarizationTrigger?: number;
  history?: string[];
  summarizedHistory?: string[];
  perRoundSummaries?: any[];
  lastRoundMessages?: string[];
  memories?: Record<string, any[]>;
  tokenBudget?: TokenBudgetMetadata;
  persona?: PersonaSummary;
  characterSummaries?: CharacterSummary[];
  characterStates?: Record<string, any>;
  trackers?: Record<string, any>;
  worldState?: Record<string, any>;
}

const SECTION_KEYS: Array<keyof TokenAllocation> = [
  'history',
  'summaries',
  'lore',
  'memories',
  'scenarioNotes',
  'directorGuidance',
  'characterGuidance'
];

const DEFAULT_ALLOCATIONS: TokenAllocation = {
  history: 0.3,
  summaries: 0.1,
  lore: 0.15,
  memories: 0.2,
  scenarioNotes: 0.1,
  directorGuidance: 0.05,
  characterGuidance: 0.1
};

function trimArrayToChars(values: string[] = [], cap?: SectionCap, opts?: { allowEmptyOnCap?: boolean }): string[] {
  if (!cap?.maxChars || cap.maxChars <= 0) return values;
  const result: string[] = [];
  let used = 0;
  for (const v of values) {
    const len = v?.length ?? 0;
    if (used + len > cap.maxChars) break;
    result.push(v);
    used += len;
  }
  // If nothing fit under the cap, keep first unless explicitly allowing empty
  if (result.length === 0 && values.length > 0 && !opts?.allowEmptyOnCap) {
    result.push(values[0]);
  }
  return result;
}

function trimMemories(memories: Record<string, any[]> = {}, cap?: SectionCap): Record<string, any[]> {
  if (!cap) return memories;
  const out: Record<string, any[]> = {};
  const topK = cap.topK && cap.topK > 0 ? cap.topK : undefined;
  const maxChars = cap.maxChars && cap.maxChars > 0 ? cap.maxChars : undefined;
  for (const key of Object.keys(memories)) {
    let entries = memories[key] || [];
    if (topK) entries = entries.slice(0, topK);
    if (maxChars) {
      const trimmed: any[] = [];
      let used = 0;
      for (const e of entries) {
        const text = typeof e === 'string' ? e : JSON.stringify(e);
        const len = text.length;
        if (used + len > maxChars) break;
        trimmed.push(e);
        used += len;
      }
      entries = trimmed;
    }
    out[key] = entries;
  }
  return out;
}

function deriveCapsFromAllocations(maxContextTokens?: number, allocations?: TokenAllocation): Partial<Record<keyof TokenAllocation, SectionCap>> {
  if (!maxContextTokens || !allocations) return {};
  const toCap = (pct: number | undefined): SectionCap | undefined => {
    if (!pct || pct <= 0) return undefined;
    const maxChars = Math.max(0, Math.floor(maxContextTokens * pct * 4)); // rough chars-per-token
    return { maxChars };
  };
  return {
    history: toCap(allocations.history),
    summaries: toCap(allocations.summaries),
    lore: toCap(allocations.lore),
    memories: toCap(allocations.memories),
    scenarioNotes: toCap(allocations.scenarioNotes),
    directorGuidance: toCap(allocations.directorGuidance),
    characterGuidance: toCap(allocations.characterGuidance)
  };
}

function mergeAllocationsWithDefaults(allocations?: TokenAllocation): TokenAllocation {
  return { ...DEFAULT_ALLOCATIONS, ...(allocations || {}) };
}

function resolveAllocations(tokenBudget?: TokenBudgetMetadata, presence?: Partial<Record<keyof TokenAllocation, boolean>>): TokenAllocation {
  const merged = mergeAllocationsWithDefaults(tokenBudget?.allocations);
  if (!presence) return merged;

  const missingKeys = SECTION_KEYS.filter((key) => presence[key] === false);
  const presentKeys = SECTION_KEYS.filter((key) => presence[key] !== false);

  const missingBudget = missingKeys.reduce((total, key) => total + (merged[key] || 0), 0);
  const presentTotal = presentKeys.reduce((total, key) => total + (merged[key] || 0), 0);

  if (missingBudget <= 0 || presentTotal <= 0) {
    const adjusted = { ...merged } as TokenAllocation;
    missingKeys.forEach((key) => {
      adjusted[key] = 0;
    });
    return adjusted;
  }

  const adjusted = { ...merged } as TokenAllocation;
  for (const key of presentKeys) {
    const weight = merged[key] || 0;
    const share = (weight / presentTotal) * missingBudget;
    adjusted[key] = weight + share;
  }
  for (const key of missingKeys) {
    adjusted[key] = 0;
  }
  return adjusted;
}

function safeParse(json: any, fallback: any) {
  if (json === null || json === undefined) return fallback;
  try {
    if (typeof json === 'string') return JSON.parse(json);
    return json;
  } catch {
    return fallback;
  }
}

function buildScenarioNotes(worldRow?: any, campaignRow?: any, arcRow?: any, sceneRow?: any) {
  return {
    world: worldRow?.description || worldRow?.notes || '',
    campaign: campaignRow?.description || '',
    arc: arcRow?.description || '',
    scene: sceneRow?.description || ''
  };
}

function toCharacterSummaries(activeCharactersResolved: any[]): CharacterSummary[] {
  return activeCharactersResolved.map((c: any) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    personality: c.personality,
    goals: c.goals || c.motivations,
    mood: c.mood,
    state: c.state || undefined
  }));
}

function hasMemoriesContent(memories: Record<string, any[]> = {}): boolean {
  return Object.keys(memories).some((key) => key !== '__loreOverride' && (memories[key]?.length ?? 0) > 0);
}

function hasScenarioNotesContent(notes: { world?: string; campaign?: string; arc?: string; scene?: string } = {}): boolean {
  return Object.values(notes).some((value) => (value || '').trim().length > 0);
}

export function buildAgentContextEnvelope(options: BuildAgentContextEnvelopeOptions): AgentContextEnvelope {
  const { db, sceneId, requestType } = options;

  const windowedHistory = options.historyWindow && options.history?.length
    ? options.history.slice(Math.max(options.history.length - options.historyWindow, 0))
    : options.history || [];

  const sceneRow = db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
  const arcRow = sceneRow ? db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any : null;
  const campaignRow = arcRow ? db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any : null;
  const worldRow = campaignRow ? db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any : null;

  const sceneCharacterStates = safeParse(sceneRow?.characterStates, {});
  const trackers = options.trackers || safeParse(campaignRow?.trackers, {});
  const worldState = options.worldState || safeParse(sceneRow?.worldState, {}) || safeParse(campaignRow?.dynamicFacts, {});

  const activeCharacters = sceneRow?.activeCharacters ? safeParse(sceneRow.activeCharacters, []) : [];
  const activeCharactersResolved: any[] = [];
  for (const item of activeCharacters) {
    const merged = CharacterService.getMergedCharacter({ characterId: item, worldId: worldRow?.id, campaignId: campaignRow?.id });
    if (merged) activeCharactersResolved.push(merged);
  }

  // Lore matching (reuse existing helper)
  let formattedLore = '';
  let matchedLore: string[] = [];
  try {
    const activeLorebooks = worldRow && campaignRow ? LorebookService.getActiveLorebooks(worldRow.id, campaignRow.id) : [];
    const allEntries: any[] = [];
    for (const lb of activeLorebooks) allEntries.push(...(lb.entries || []));
    const loreContext = SceneService.getLoreContext(sceneId, 4);
    if (loreContext && allEntries.length > 0) {
      const result = matchLoreEntries(allEntries, loreContext, 4, 2048);
      matchedLore = result.selectedEntries.map((e: any) => e.content);
      formattedLore = result.selectedEntries.map((e: any) => e.content).join('\n\n');
    }
  } catch {
    // lore optional; ignore errors
  }

  const scenarioNotes = buildScenarioNotes(worldRow, campaignRow, arcRow, sceneRow);
  const loreOverride = options.memories?.__loreOverride;
  const loreSource = loreOverride && loreOverride.length > 0 ? loreOverride : matchedLore;
  const presence: Partial<Record<keyof TokenAllocation, boolean>> = {
    history: (windowedHistory?.length ?? 0) > 0,
    summaries: ((options.summarizedHistory?.length ?? 0) + (options.perRoundSummaries?.length ?? 0)) > 0,
    lore: (loreSource?.length ?? 0) > 0,
    memories: hasMemoriesContent(options.memories || {}),
    scenarioNotes: hasScenarioNotesContent(scenarioNotes),
    directorGuidance: false,
    characterGuidance: false
  };

  const resolvedAllocations = resolveAllocations(options.tokenBudget, presence);
  const derivedCaps = deriveCapsFromAllocations(options.tokenBudget?.maxContextTokens, resolvedAllocations);
  const caps = {
    ...derivedCaps,
    ...(options.tokenBudget?.caps || {})
  };

  const cappedLore = trimArrayToChars(loreSource, caps?.lore);
  const cappedSummaries = trimArrayToChars(options.summarizedHistory || [], caps?.summaries);
  const cappedHistory = trimArrayToChars(windowedHistory, caps?.history);
  const cappedPerRound = (options.perRoundSummaries || []).slice(0, caps?.summaries?.topK || undefined);
  const cappedLastRound = trimArrayToChars(options.lastRoundMessages || [], caps?.history);
  const cappedMemories = trimMemories(options.memories || {}, caps?.memories);
  const cappedScenarioNotes = {
    world: trimArrayToChars([scenarioNotes.world || ''], caps?.scenarioNotes, { allowEmptyOnCap: true })[0] || '',
    campaign: trimArrayToChars([scenarioNotes.campaign || ''], caps?.scenarioNotes, { allowEmptyOnCap: true })[0] || '',
    arc: trimArrayToChars([scenarioNotes.arc || ''], caps?.scenarioNotes, { allowEmptyOnCap: true })[0] || '',
    scene: trimArrayToChars([scenarioNotes.scene || ''], caps?.scenarioNotes, { allowEmptyOnCap: true })[0] || ''
  };

  const characters = options.characterSummaries || toCharacterSummaries(activeCharactersResolved);

  return {
    requestType,
    sceneId,
    roundNumber: options.roundNumber,
    historyWindow: options.historyWindow,
    summarizationTrigger: options.summarizationTrigger,
    history: cappedHistory,
    summarizedHistory: cappedSummaries,
    perRoundSummaries: cappedPerRound,
    lastRoundMessages: cappedLastRound,
    lore: cappedLore,
    formattedLore,
    memories: cappedMemories,
    scenarioNotes: cappedScenarioNotes,
    persona: options.persona,
    characters,
    characterStates: options.characterStates || sceneCharacterStates,
    worldState,
    trackers,
    directorGuidance: {},
    tokenBudget: options.tokenBudget ? { ...options.tokenBudget, allocations: resolvedAllocations } : undefined
  };
}
