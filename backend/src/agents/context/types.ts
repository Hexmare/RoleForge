export type RequestType = 'user' | 'continuation';

export interface PerRoundSummary {
  roundNumber: number;
  bullets: string[];
}

export interface TokenAllocation {
  history: number;
  summaries: number;
  lore: number;
  memories: number;
  scenarioNotes: number;
  directorGuidance: number;
  characterGuidance: number;
}

export interface SectionCap {
  maxTokens?: number;
  maxChars?: number;
  topK?: number;
}

export interface TokenBudgetMetadata {
  maxContextTokens?: number;
  allocations?: TokenAllocation;
  caps?: Partial<Record<keyof TokenAllocation, SectionCap>>;
}

export interface PersonaSummary {
  id?: string | number;
  name?: string;
  description?: string;
  personality?: string;
  goals?: string[];
  mood?: string;
}

export interface CharacterSummary extends PersonaSummary {
  state?: Record<string, any>;
}

export interface AgentContextEnvelope {
  requestType: RequestType;
  sceneId?: number;
  roundNumber?: number;
  historyWindow?: number;
  summarizationTrigger?: number;
  history: string[];
  summarizedHistory?: string[];
  perRoundSummaries?: PerRoundSummary[];
  lastRoundMessages?: string[];
  lore?: string[];
  formattedLore?: string;
  memories?: Record<string, any[]>; // keyed by character id/name
  scenarioNotes?: {
    world?: string;
    campaign?: string;
    arc?: string;
    scene?: string;
  };
  persona?: PersonaSummary;
  characters?: CharacterSummary[];
  characterStates?: Record<string, any>;
  worldState?: Record<string, any>;
  trackers?: Record<string, any>;
  directorGuidance?: Record<string, any>;
  tokenBudget?: TokenBudgetMetadata;
}
