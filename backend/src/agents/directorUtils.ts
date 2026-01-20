import CharacterService from '../services/CharacterService.js';

export interface DirectorActingCharacter {
  id?: string;
  name?: string;
  guidance?: string;
  priority?: number;
  order?: number;
}

export interface DirectorStateUpdate {
  id?: string;
  name?: string;
  location?: string;
  mood?: string;
  clothing?: string;
  activity?: string;
  intentions?: string;
}

export interface DirectorPlan {
  openGuidance: string;
  actingCharacters: DirectorActingCharacter[];
  activations: string[];
  deactivations: string[];
  stateUpdates: DirectorStateUpdate[];
  remainingActors?: string[];
  newActivations?: string[];
}

export interface DirectorApplicationResult {
  charactersToRespond: string[];
  orderedActors: DirectorActingCharacter[];
  activeCharacterIds: string[];
  updatedStates: Record<string, any>;
  appliedStateUpdates: Array<{ name: string; changes: Record<string, string> }>;
  activations: Array<{ id?: string; name: string }>;
  deactivations: Array<{ id?: string; name: string }>;
  remainingActors?: string[];
  newActivations?: string[];
}

type CharacterResolver = (ref: string) => { id?: string; name: string } | null;

type SessionContext = {
  world?: { id?: number };
  campaign?: { id?: number };
  activeCharacters?: Array<{ id?: string; name?: string }>;
};

function toArray<T>(value: any): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}

function defaultResolver(sessionContext: SessionContext): CharacterResolver {
  return (ref: string) => {
    if (!ref) return null;
    const normalized = String(ref).trim();
    const lower = normalized.toLowerCase();
    const activeMatch = (sessionContext.activeCharacters || []).find((c) => c && ((c.id && String(c.id) === normalized) || (c.name || '').toLowerCase() === lower));
    if (activeMatch) {
      return { id: activeMatch.id, name: activeMatch.name || normalized };
    }
    const merged = CharacterService.getMergedCharacter({
      characterId: normalized,
      worldId: sessionContext.world?.id,
      campaignId: sessionContext.campaign?.id
    });
    if (merged) {
      return { id: merged.id, name: merged.name || normalized };
    }
    return null;
  };
}

export function normalizeDirectorPlan(raw: any): DirectorPlan {
  const openGuidance = typeof raw?.openGuidance === 'string' ? raw.openGuidance : typeof raw?.guidance === 'string' ? raw.guidance : '';
  const actingCharacters = toArray<DirectorActingCharacter>(raw?.actingCharacters || raw?.characters)
    .filter((c) => !!c)
    .map((c) => {
      if (typeof c === 'string') {
        return { name: c } as DirectorActingCharacter;
      }
      return c;
    });
  const activations = toArray<string>(raw?.activations);
  const deactivations = toArray<string>(raw?.deactivations);
  const stateUpdates = toArray<DirectorStateUpdate>(raw?.stateUpdates);
    const remainingActors = toArray<string>(raw?.remainingActors || raw?.remaining)
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    const newActivations = toArray<string>(raw?.newActivations || raw?.nextActivations)
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    return { openGuidance, actingCharacters, activations, deactivations, stateUpdates, remainingActors, newActivations };
}

export function orderActingCharacters(plan: DirectorPlan, resolver?: CharacterResolver): DirectorActingCharacter[] {
  const resolved = plan.actingCharacters.map((actor) => {
    const named = { ...actor } as DirectorActingCharacter;
    if (!named.name && actor.id && resolver) {
      const r = resolver(actor.id);
      if (r) named.name = r.name;
    }
    return named;
  });

  return resolved
    .map((actor, index) => ({ ...actor, _index: index }))
    .sort((a: any, b: any) => {
      const aOrder = Number.isFinite(a.order) ? a.order : null;
      const bOrder = Number.isFinite(b.order) ? b.order : null;
      if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
      if (aOrder !== null && bOrder === null) return -1;
      if (aOrder === null && bOrder !== null) return 1;

      const aPriority = Number.isFinite(a.priority) ? a.priority : 0;
      const bPriority = Number.isFinite(b.priority) ? b.priority : 0;
      if (aPriority !== bPriority) return bPriority - aPriority;

      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      if (aName !== bName) return aName.localeCompare(bName);

      return a._index - b._index;
    })
    .map(({ _index, ...rest }) => rest);
}

export function applyDirectorPlan(plan: DirectorPlan, sessionContext: SessionContext, existingStates: Record<string, any>, resolveCharacter?: CharacterResolver): DirectorApplicationResult 
{
  const resolver = resolveCharacter || defaultResolver(sessionContext);
  const orderedActors = orderActingCharacters(plan, resolver);

  const activeSet = new Set<string>();
  const appliedStateUpdates: Array<{ name: string; changes: Record<string, string> }> = [];
  const resolvedActivations: Array<{ id?: string; name: string }> = [];
  const resolvedDeactivations: Array<{ id?: string; name: string }> = [];

  const seedActive = sessionContext.activeCharacters || [];
  for (const c of seedActive) {
    if (!c) continue;
    const key = c.id || c.name;
    if (key) activeSet.add(key);
  }

  for (const actor of orderedActors) {
    const resolved = resolver(actor.id || actor.name || '');
    const key = resolved?.id || actor.id || resolved?.name || actor.name;
    if (key) activeSet.add(key);
  }

  for (const nameOrId of plan.activations) {
    const resolved = resolver(String(nameOrId));
    if (resolved) {
      const key = resolved.id || resolved.name;
      if (key) {
        activeSet.add(key);
        resolvedActivations.push(resolved);
      }
    }
  }

  const removeActiveByRef = (raw: string): { id?: string; name: string } | null => {
    const lower = raw.toLowerCase();
    // Try resolver first
    const resolved = resolver(raw);
    if (resolved) {
      const keys = [resolved.id, resolved.name].filter(Boolean) as string[];
      for (const k of keys) activeSet.delete(k);
      if (keys.length > 0) return resolved;
    } else {
      // If resolver fails, try to remove by raw string as name/id
      console.log(`[applyDirectorPlan] Resolver could not find character for deactivation ref: ${raw}`);
    }

    // Try matching against sessionContext.activeCharacters by name/id case-insensitive
    const activeMatch = (sessionContext.activeCharacters || []).find((c) => {
      const cId = c?.id ? String(c.id) : '';
      const cName = (c?.name || '').toLowerCase();
      return (cId && cId.toLowerCase() === lower) || (cName && cName === lower);
    });
    if (activeMatch) {
      const keys = [activeMatch.id, activeMatch.name].filter(Boolean) as string[];
      for (const k of keys) activeSet.delete(k);
      return { id: activeMatch.id, name: activeMatch.name || raw };
    } else {
      console.log(`[applyDirectorPlan] Could not find active character matching deactivation ref: ${raw}`);
    }

    // Fallback: case-insensitive match against whatever is currently in activeSet
    const fallback = Array.from(activeSet).find((k) => String(k).toLowerCase() === lower);
    if (fallback) {
      activeSet.delete(fallback);
      return { name: fallback }; 
    } else {
      console.log(`[applyDirectorPlan] Could not find active character in activeSet matching deactivation ref: ${raw}`);
    }

    return null;
  };

  for (const nameOrId of plan.deactivations) {
    const raw = String(nameOrId);
    console.log(`[applyDirectorPlan] Processing deactivation for ref: ${raw}`);
    const removed = removeActiveByRef(raw);
    if (removed) {
      resolvedDeactivations.push(removed);
    }
  }

  const updatedStates: Record<string, any> = { ...existingStates };
  for (const update of plan.stateUpdates) {
    const resolved = resolver(update.name || update.id || '');
    const stateKey = resolved?.name || update.name || update.id;
    if (!stateKey) continue;
    const current = { ...(updatedStates[stateKey] || {}) };
    const changes: Record<string, string> = {};

    const applyField = (field: keyof DirectorStateUpdate) => {
      const value = (update as any)[field];
      if (value && value !== 'default' && value !== 'Default') {
        current[field] = value;
        changes[field] = String(value);
      }
    };

    applyField('location');
    applyField('mood');
    applyField('clothing');
    applyField('activity');
    applyField('intentions');

    if (Object.keys(changes).length > 0) {
      updatedStates[stateKey] = current;
      appliedStateUpdates.push({ name: stateKey, changes });
    }
  }

  let charactersToRespond = orderedActors.map((c) => c.name).filter((n): n is string => !!n);

  // Fallback: if the Director provided activations but no actingCharacters, let activations act this turn
  if (charactersToRespond.length === 0 && resolvedActivations.length > 0) {
    charactersToRespond = resolvedActivations.map((a) => a.name).filter((n) => !!n);
  }
  const activeCharacterIds = Array.from(new Set(activeSet));

  return {
    charactersToRespond,
    orderedActors,
    activeCharacterIds,
    updatedStates,
    appliedStateUpdates,
    activations: resolvedActivations,
    deactivations: resolvedDeactivations,
    remainingActors: plan.remainingActors,
    newActivations: plan.newActivations
  };
}
