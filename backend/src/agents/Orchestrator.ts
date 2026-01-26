import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ConfigManager } from '../configManager.js';
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, NAMESPACES } from '../logging';

import { NarratorAgent } from './NarratorAgent.js';
import { CharacterAgent } from './CharacterAgent.js';
import { DirectorAgent } from './DirectorAgent.js';
import { WorldAgent } from './WorldAgent.js';
import { SummarizeAgent } from './SummarizeAgent.js';
import { VisualAgent } from './VisualAgent.js';
import { CreatorAgent } from './CreatorAgent.js';
import { VectorizationAgent } from './VectorizationAgent.js';
import { applyDirectorPlan, normalizeDirectorPlan } from './directorUtils.js';
import { getMemoryRetriever } from '../utils/memoryRetriever.js';
import CharacterService from '../services/CharacterService.js';
import SceneService from '../services/SceneService.js';
import MessageService from '../services/MessageService.js';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import LorebookService from '../services/LorebookService.js';
import { matchLoreEntries } from '../utils/loreMatcher.js';
import tryJsonRepair from '../utils/jsonRepair.js';
import { getNestedField } from '../utils/memoryHelpers.js';
import { buildAgentContextEnvelope, BuildAgentContextEnvelopeOptions } from './context/contextBuilder.js';
import { AgentContextEnvelope } from './context/types.js';
import { tokenTelemetry } from '../utils/tokenTelemetry.js';
import { countTokens } from '../utils/tokenCounter.js';

const orchestratorLog = createLogger(NAMESPACES.agents.orchestrator);

export function buildReconciliationEnvelope(
  base?: AgentContextEnvelope,
  turnResponses?: Array<{ character: string; response: string }>,
  actedThisRound: string[] = []
) {
  if (!base) return undefined;
  const { directorGuidance, ...rest } = base;
  return {
    ...rest,
    directorPass: 2,
    recentCharacterResponses: turnResponses,
    actedThisRound
  } as AgentContextEnvelope & {
    directorPass: number;
    recentCharacterResponses?: Array<{ character: string; response: string }>;
    actedThisRound?: string[];
  };
}

export class Orchestrator {
  private configManager: ConfigManager;
  private env: nunjucks.Environment;
  private db: Database.Database;
  private io?: Server;
  private agents: Map<string, BaseAgent> = new Map();
  private worldState: Record<string, any> = {};
  private trackers: { stats: Record<string, any>; objectives: string[]; relationships: Record<string, string> } = { stats: {}, objectives: [], relationships: {} };
  private characterStates: Record<string, any> = {};
  private history: string[] = [];
  private sceneSummary: string = '';
  
  // Task 4.1: Round tracking properties
  private currentRoundNumber: number = 1;
  private roundActiveCharacters: string[] = [];
  private pendingCharacterPass: string[] = [];

  constructor(configManager: ConfigManager, env: nunjucks.Environment, db: Database.Database, io?: Server) {
    this.configManager = configManager;
    this.env = env;
    this.db = db;
    this.io = io;

    // Initialize agents
    this.agents.set('narrator', new NarratorAgent(configManager, env));
    this.agents.set('character', new CharacterAgent('', configManager, env));
    this.agents.set('director', new DirectorAgent(configManager, env));
    this.agents.set('world', new WorldAgent(configManager, env));
    this.agents.set('summarize', new SummarizeAgent(configManager, env));
    this.agents.set('visual', new VisualAgent(configManager, env));
    this.agents.set('creator', new CreatorAgent(configManager, env));
    this.agents.set('vectorization', new VectorizationAgent(configManager, env));
  }

  private emitSceneEvent(eventName: string, payload: Record<string, unknown>, sceneId?: number): void {
    if (!this.io || !sceneId) return;
    this.io.to(`scene-${sceneId}`).emit(eventName, {
      sceneId,
      roundNumber: this.currentRoundNumber,
      timestamp: new Date().toISOString(),
      ...payload
    });
  }

  private emitAgentStatus(agentName: string, status: 'start' | 'complete', sceneId?: number) {
    if (!sceneId) return;
    this.emitSceneEvent('agentStatus', { agent: agentName, status }, sceneId);
  }

  // Task 4.1: Initialize round state from database
  async initializeRoundState(sceneId: number): Promise<void> {
    const scene = this.db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    this.currentRoundNumber = scene?.currentRoundNumber || 1;
    this.roundActiveCharacters = [];
    orchestratorLog('[ORCHESTRATOR] Round initialized: scene=%d, roundNumber=%d', sceneId, this.currentRoundNumber);
  }

  // Task 4.1: Get current round number
  getCurrentRound(): number {
    return this.currentRoundNumber;
  }

  // Get agents map (for external access)
  getAgents(): Map<string, BaseAgent> {
    return this.agents;
  }

  // Task 4.1: Track active characters in current round
  addActiveCharacter(characterName: string): void {
    if (!this.roundActiveCharacters.includes(characterName)) {
      this.roundActiveCharacters.push(characterName);
    }
  }

  // Generate and persist a scene summary using the SummarizeAgent
  public async summarizeScene(sceneId: number, options?: { emitStatus?: boolean; force?: boolean; reason?: string }): Promise<{ summary: string; tokenCount: number } | null> {
    try {
      const summarizeAgent = this.agents.get('summarize');
      if (!summarizeAgent) return null;

      const cfg = this.configManager.getConfig();
      const features = cfg.features || {};
      const summarizationEnabled = features.summarizationEnabled ?? false;
      if (!summarizationEnabled) {
        orchestratorLog('[ORCHESTRATOR] summarizeScene skipped: summarization disabled via config');
        return null;
      }
      const maxSummaryTokens = features.maxSummaryTokens || 500;

      // Determine summarizer context token budget
      const summarizeAgentCfg = cfg.agents?.summarize || {};
      const requestedProfile = summarizeAgentCfg.llmProfile || cfg.defaultProfile;
      const profileName = requestedProfile === 'default' ? cfg.defaultProfile : requestedProfile;
      const profile = this.configManager.getProfile(profileName);
      const maxContextTokens = summarizeAgentCfg.sampler?.maxContextTokens || profile?.sampler?.maxContextTokens || 4096;
      const inputBudgetTokens = Math.max(512, Math.floor(maxContextTokens * 0.8));

      const sceneRow = this.db.prepare('SELECT summary, lastSummarizedMessageId FROM Scenes WHERE id = ?').get(sceneId) as any;
      const existingSummary = options?.force ? '' : (sceneRow?.summary || '');
      const lastSummarizedId = options?.force ? 0 : (sceneRow?.lastSummarizedMessageId || 0);

      const messages = MessageService.getMessages(sceneId, 5000, 0) || [];
      if (messages.length === 0) return null;

      // Select target messages based on last summarized
      const pendingMessages = options?.force ? messages : messages.filter((m: any) => (m.id || 0) > lastSummarizedId);
      if (!options?.force && pendingMessages.length === 0) {
        return null;
      }

      // Sort chronological
      const chronological = [...pendingMessages].sort((a: any, b: any) => {
        const aNum = typeof a.messageNumber === 'number' ? a.messageNumber : a.id || 0;
        const bNum = typeof b.messageNumber === 'number' ? b.messageNumber : b.id || 0;
        return aNum - bNum;
      });

      // Chunk messages by token budget (~80% of context)
      const chunks: Array<{ history: string[]; latestId: number }> = [];
      let currentChunk: string[] = [];
      let currentTokens = 0;
      let chunkLatestId = 0;
      const pushChunk = () => {
        if (currentChunk.length > 0) {
          chunks.push({ history: currentChunk.slice(), latestId: chunkLatestId });
          currentChunk = [];
          currentTokens = 0;
          chunkLatestId = 0;
        }
      };

      for (const msg of chronological) {
        const text = `${msg.sender}: ${msg.message}`;
        const tokens = countTokens(text);
        if (currentTokens + tokens > inputBudgetTokens && currentChunk.length > 0) {
          pushChunk();
        }
        currentChunk.push(text);
        currentTokens += tokens;
        chunkLatestId = Math.max(chunkLatestId, Number(msg.id) || 0);
      }
      pushChunk();

      if (chunks.length === 0) return null;

      if (options?.emitStatus) this.emitAgentStatus('Summarize', 'start', sceneId);

      let runningSummary = existingSummary;
      let latestProcessedId = lastSummarizedId;

      for (const chunk of chunks) {
        const context: AgentContext = {
          userInput: '',
          history: chunk.history,
          worldState: {},
          existingSummary: runningSummary || undefined,
          maxSummaryTokens
        } as AgentContext;

        let summary: string | null = null;
        try {
          summary = await summarizeAgent.run(context);
        } catch (error) {
          orchestratorLog('[SUMMARIZE] Agent call failed for chunk:', error);
          continue;
        }
        
        if (!summary) {
          continue;
        }

        // Append to preserve older details (unless starting fresh)
        if (runningSummary && !options?.force) {
          runningSummary = `${runningSummary}\n\n${summary}`;
        } else {
          runningSummary = summary as string;
        }

        latestProcessedId = Math.max(latestProcessedId, chunk.latestId);
      }

      if (!runningSummary) {
        if (options?.emitStatus) this.emitAgentStatus('Summarize', 'complete', sceneId);
        return null;
      }

      const tokenCount = countTokens(runningSummary as string);
      const latestId = latestProcessedId || lastSummarizedId;

      this.db.prepare('UPDATE Scenes SET summary = ?, summaryTokenCount = ?, lastSummarizedMessageId = ? WHERE id = ?')
        .run(runningSummary, tokenCount, latestId, sceneId);

      this.sceneSummary = runningSummary as string;

      this.emitSceneEvent('sceneUpdated', { sceneId, summary: runningSummary, summaryTokenCount: tokenCount, reason: options?.reason || 'auto' }, sceneId);
      if (options?.emitStatus) this.emitAgentStatus('Summarize', 'complete', sceneId);

      return { summary: runningSummary as string, tokenCount };
    } catch (error) {
      orchestratorLog('[ORCHESTRATOR] summarizeScene failed for scene %d: %o', sceneId, error);
      if (options?.emitStatus) this.emitAgentStatus('Summarize', 'complete', sceneId);
      return null;
    }
  }

  // Task 4.2: Complete the current round
  // Completes previous round, advances round number, creates new round record
  async completeRound(sceneId: number, activeCharacters?: string[]): Promise<number> {
    try {
      const charsToPass = activeCharacters || this.roundActiveCharacters;
      
      // 1. Persist round metadata to database (completes previous, advances number, creates new)
      const nextRoundNumber = SceneService.completeRound(sceneId, charsToPass);
      orchestratorLog('[ORCHESTRATOR] Round completed. Previous: %d, Next: %d', this.currentRoundNumber, nextRoundNumber);

      // Task 4.4: Emit Socket.io event for roundCompleted
      this.emitSceneEvent('roundCompleted', {
        roundNumber: this.currentRoundNumber,
        nextRoundNumber: nextRoundNumber,
        activeCharacters: charsToPass
      }, sceneId);

      // 3. Trigger VectorizationAgent if available (fire and forget)
      if (this.agents.has('vectorization')) {
        const vectorizationAgent = this.agents.get('vectorization');
        if (vectorizationAgent) {
          const roundMessages = MessageService.getRoundMessages(sceneId, this.currentRoundNumber);
          const context: AgentContext = {
            sceneId,
            roundNumber: this.currentRoundNumber,
            messages: roundMessages,
            activeCharacters: charsToPass,
            userInput: '',
            history: [],
            worldState: this.worldState,
            trackers: this.trackers,
            characterStates: this.characterStates,
            lore: [],
            formattedLore: '',
            userPersona: {}
          };

          vectorizationAgent.run(context).catch((err: any) => {
            orchestratorLog('[ORCHESTRATOR] VectorizationAgent failed for round %d: %o', this.currentRoundNumber, err);
          });
        }
      }

      try {
        const features = this.configManager.getConfig().features || {};
        const summarizationEnabled = features.summarizationEnabled ?? false;
        const interval = features.summarizationRoundInterval ?? 4;
        if (!summarizationEnabled) {
          orchestratorLog('[ORCHESTRATOR] Summarization disabled; skipping auto-summarize for round %d', this.currentRoundNumber);
        } else if (interval <= 1 || (this.currentRoundNumber % interval === 0)) {
          await this.summarizeScene(sceneId, { emitStatus: true, reason: 'round-complete' });
        } else {
          orchestratorLog('[ORCHESTRATOR] Skipping auto-summarize this round (interval=%d, current=%d)', interval, this.currentRoundNumber);
        }
      } catch (summaryErr) {
        orchestratorLog('[ORCHESTRATOR] Summarization after round %d failed: %o', this.currentRoundNumber, summaryErr);
      }

      // 4. Increment round for next cycle in Orchestrator state (database already done)
      this.currentRoundNumber++;
      this.roundActiveCharacters = [];
      
      return nextRoundNumber;
    } catch (error) {
      orchestratorLog('[ORCHESTRATOR] Failed to complete round %d: %o', this.currentRoundNumber, error);
      throw error;
    }
  }

  // Task 4.3: Continue round without user input (AI-driven continuation)
  // This follows the EXACT SAME PATH as processUserInput for consistency and reuse
  async continueRound(sceneId: number): Promise<void> {
    try {
      // Get the CURRENT round number (already incremented by the last completeRound)
      const scene = this.db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
        .get(sceneId) as any;
      const currentRoundNumber = scene?.currentRoundNumber || 1;
      orchestratorLog('[ORCHESTRATOR] Continuing round %d for scene %d', currentRoundNumber, sceneId);
      
      // Load the round into orchestrator state
      this.currentRoundNumber = currentRoundNumber;
      this.roundActiveCharacters = [];

      // Get the previous round number to fetch character messages from last round
      const previousRoundNumber = currentRoundNumber - 1;
      const previousRoundMessages = previousRoundNumber > 0 
        ? MessageService.getRoundMessages(sceneId, previousRoundNumber)
        : [];
      
      // Filter out user messages - only include character responses
      const characterMessagesFromLastRound = previousRoundMessages
        .filter((msg: any) => msg.source !== 'user')
        .map((msg: any) => `${msg.character}: ${msg.message}`)
        .join('\n\n');

      // Build synthetic user input that triggers AI-to-AI continuation
      // This tells the director we're continuing the scene
      const syntheticUserInput = characterMessagesFromLastRound 
        ? `[System: Continue scene. Previous character messages:\n${characterMessagesFromLastRound}\n\nDecide which characters should continue the scene.]`
        : '[System: Continue scene]';

      // Load session context to get active characters
      const sessionContext = await this.buildSessionContext(sceneId);
      if (!sessionContext) {
        throw new Error(`[ORCHESTRATOR] Failed to build session context for scene ${sceneId}`);
      }

      // Extract active character UUIDs from the resolved character objects
      // sessionContext.activeCharacters are full character objects, we need just the IDs
      const activeCharacterUUIDs = sessionContext.activeCharacters.map((c: any) => c.id);
      orchestratorLog('[ORCHESTRATOR] Active character UUIDs for round %d: %s', currentRoundNumber, JSON.stringify(activeCharacterUUIDs));

      // REUSE THE EXACT SAME processUserInput PATH
      // This ensures all agent status messages, parsing, world updates, and frontend notifications happen
      await this.processUserInput(
        syntheticUserInput,
        'system', // Use 'system' as persona
        activeCharacterUUIDs, // Pass active character UUIDs
        sceneId, // Pass scene ID for round tracking
        (response: { sender: string; content: string }) => {
          orchestratorLog('[CONTINUE_ROUND] Callback received response from %s', response.sender);
          // Log character response with current round number
          MessageService.logMessage(sceneId, response.sender, response.content, {}, 'continue-round', this.currentRoundNumber);
          this.addActiveCharacter(response.sender);
          
          // Emit to frontend immediately
          if (this.io) {
            orchestratorLog('[CONTINUE_ROUND] Emitting characterResponse for %s to scene-%d', response.sender, sceneId);
            this.emitSceneEvent('characterResponse', response, sceneId);
          } else {
            orchestratorLog('[CONTINUE_ROUND] No Socket.io instance available to emit');
          }
        }
      );

      // Complete the round
      await this.completeRound(sceneId, activeCharacterUUIDs);
    } catch (error) {
      orchestratorLog('[ORCHESTRATOR] Failed to continue round: %o', error);
      throw error;
    }
  }

  /**
   * Extract character state fields from character description when Default values are present
   * Attempts to parse clothing, mood, activity, and position from the description text
   */
  private extractStateFromDescription(character: any): Partial<any> {
    const state: any = {};
    if (!character?.description) return state;

    const desc = character.description.toLowerCase();
    
    // Try to extract clothing/outfit info
    if (!character.currentOutfit || character.currentOutfit === 'default') {
      const clothingPatterns = [
        /wearing\s+(.+?)(?:\.|,|and)/i,
        /dressed in\s+(.+?)(?:\.|,|and)/i,
        /outfit:\s+(.+?)(?:\.|,|and)/i,
        /clothes?:\s+(.+?)(?:\.|,|and)/i,
      ];
      for (const pattern of clothingPatterns) {
        const match = desc.match(pattern);
        if (match) {
          state.clothing = match[1].trim();
          break;
        }
      }
    }

    // Try to extract mood/personality
    if (!character.mood || character.mood === 'default' || character.mood === 'neutral') {
      const moodKeywords = ['cheerful', 'happy', 'sad', 'angry', 'calm', 'anxious', 'confident', 'shy', 'curious', 'determined', 'amused', 'serious', 'playful', 'reserved', 'outgoing'];
      for (const mood of moodKeywords) {
        if (desc.includes(mood)) {
          state.mood = mood;
          break;
        }
      }
    }

    // Try to extract activity/occupation
    if (!character.activity || character.activity === 'default' || character.activity === 'present') {
      const activityPatterns = [
        /(?:is|works? as|acts? as)\s+(?:a\s+)?(.+?)(?:\.|,|and)/i,
        /occupation:\s+(.+?)(?:\.|,|and)/i,
        /role:\s+(.+?)(?:\.|,|and)/i,
      ];
      for (const pattern of activityPatterns) {
        const match = desc.match(pattern);
        if (match) {
          state.activity = match[1].trim();
          break;
        }
      }
    }

    return state;
  }

  // Recreate a single agent instance (useful when config changes)
  public reloadAgent(agentName: string): boolean {
    try {
      if (agentName === 'visual') {
        this.agents.set('visual', new VisualAgent(this.configManager, this.env));
        return true;
      }
      // add other agents as needed
      return false;
    } catch (e) {
      orchestratorLog('Failed to reload agent', agentName, e);
      return false;
    }
  }

  // Get an agent instance
  public getAgent(agentName: string): BaseAgent | undefined {
    return this.agents.get(agentName);
  }

  // Build a rich SessionContext for a given sceneId
  async buildSessionContext(sceneId: number) {
    orchestratorLog(`\n========== [ORCHESTRATOR] Building SessionContext for Scene ${sceneId} ==========`);
    orchestratorLog(`\n========== [LORE ENGINE] Building SessionContext for Scene ${sceneId} ==========`);
    const sceneRow = this.db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!sceneRow) return null;

    const arcRow = this.db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any;
    const campaignRow = this.db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
    const worldRow = this.db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;

    // Get active lorebooks for world and campaign
    orchestratorLog(`[LORE] Building session context for scene ${sceneId}`);
    orchestratorLog(`[LORE] World: ${worldRow.name} (${worldRow.id}), Campaign: ${campaignRow.name} (${campaignRow.id})`);
    
    const activeLorebooks = LorebookService.getActiveLorebooks(worldRow.id, campaignRow.id);
    orchestratorLog(`[LORE] Active lorebooks count: ${activeLorebooks.length}`);
    activeLorebooks.forEach((lb: any) => {
      orchestratorLog(`[LORE]   - Lorebook: "${lb.name}" (uuid: ${lb.uuid}, entries: ${(lb.entries || []).length})`);
    });
    
    const allEntries: any[] = [];
    for (const lb of activeLorebooks) {
      allEntries.push(...(lb.entries || []));
    }
    orchestratorLog(`[LORE] Total entries available: ${allEntries.length}`);

    // Get lore context for matching
    const loreContext = SceneService.getLoreContext(sceneId, 4); // scanDepth 4
    orchestratorLog(`[LORE] Lore context keys: ${loreContext ? Object.keys(loreContext).join(', ') : 'none'}`);
    
    let matchedLore: string[] = [];
    let formattedLore = '';
    if (loreContext && allEntries.length > 0) {
      orchestratorLog(`[LORE] Matching entries against context...`);
      const result = matchLoreEntries(allEntries, loreContext, 4, 2048); // tokenBudget 2048
      orchestratorLog(`[LORE] Match results: ${result.selectedEntries.length} selected out of ${allEntries.length} available entries`);
      result.selectedEntries.forEach((entry: any, idx: number) => {
        orchestratorLog(`[LORE]   SELECTED ${idx + 1}: "${entry.key}" (position: ${entry.insertion_position})`);
      });
      matchedLore = result.selectedEntries.map(e => e.content);
      
      // Format lore with labeled sections (Option B) by insertion_position
      const groupedByPosition: { [key: string]: string[] } = {};
      for (const entry of result.selectedEntries) {
        const pos = entry.insertion_position || 'Before Char Defs';
        if (!groupedByPosition[pos]) {
          groupedByPosition[pos] = [];
        }
        groupedByPosition[pos].push(entry.content);
      }
      
      // Build formatted lore string
      const sections: string[] = [];
      for (const [position, contents] of Object.entries(groupedByPosition)) {
        sections.push(`[LORE - ${position}]\n${contents.join('\n')}`);
      }
      formattedLore = sections.join('\n\n');
      orchestratorLog(`[LORE] Formatted lore sections: ${Object.keys(groupedByPosition).join(', ')}`);
      orchestratorLog(`[LORE] Total formatted lore length: ${formattedLore.length} chars`);
    } else {
      orchestratorLog(`[LORE] No lore context or entries found. loreContext: ${!!loreContext}, entries: ${allEntries.length}`);
    }

    // Campaign state
    const cs = this.db.prepare('SELECT * FROM CampaignState WHERE campaignId = ?').get(campaignRow.id) as any;
    const campaignState = cs ? {
      campaignId: cs.campaignId,
      currentSceneId: cs.currentSceneId,
      elapsedMinutes: cs.elapsedMinutes,
      dynamicFacts: JSON.parse(cs.dynamicFacts || '{}'),
      trackers: JSON.parse(cs.trackers || '{}'),
      updatedAt: cs.updatedAt
    } : { campaignId: campaignRow.id, currentSceneId: null, elapsedMinutes: 0, dynamicFacts: {}, trackers: {}, updatedAt: null };

    // Ensure CampaignState row exists (if legacy data missed creation)
    if (!cs) {
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO CampaignState (campaignId, currentSceneId, elapsedMinutes, dynamicFacts, trackers)
        VALUES (?, ?, ?, ?, ?)
      `);
      if (insertStmt && typeof insertStmt.run === 'function') {
        insertStmt.run(campaignRow.id, null, 0, JSON.stringify({}), JSON.stringify({ stats: {}, objectives: [], relationships: {} }));
      }
    }

    const sanitizedTrackers = this.sanitizeTrackers(campaignState.trackers);
    // NOTE: We sanitize trackers for use in session context (removing unwanted fields like clothing),
    // but we do NOT persist the sanitized version back to the database to preserve manual edits.
    // The sanitization only affects the in-memory session context.

    // Parse active characters UUIDs
    const activeCharacters = sceneRow.activeCharacters ? JSON.parse(sceneRow.activeCharacters) : [];
    orchestratorLog(`[ORCHESTRATOR] Scene ${sceneId}: activeCharacters in DB = ${JSON.stringify(activeCharacters)}`);

    // Resolve merged character objects where possible
    const activeCharactersResolved: any[] = [];
    const characterStates: Record<string, any> = sceneRow.characterStates ? JSON.parse(sceneRow.characterStates) : {};
    for (const item of activeCharacters) {
      const merged = CharacterService.getMergedCharacter({ characterId: item, worldId: worldRow.id, campaignId: campaignRow.id });
      if (merged) {
        orchestratorLog(`[ORCHESTRATOR] Found merged character for ${item}: ${merged.name}`);
        // Apply current character state if available
        const currentState = characterStates[merged.id] || characterStates[merged.name];
        if (currentState) {
          Object.assign(merged, currentState);
        }
        activeCharactersResolved.push(merged);
      } else {
        orchestratorLog(`[ORCHESTRATOR] No merged character found for ${item}`);
      }
    }
    orchestratorLog(`[ORCHESTRATOR] Scene ${sceneId}: resolved ${activeCharactersResolved.length} characters`);

    const sessionContext = {
      world: { id: worldRow.id, slug: worldRow.slug, name: worldRow.name, description: worldRow.description },
      campaign: { id: campaignRow.id, slug: campaignRow.slug, name: campaignRow.name, description: campaignRow.description },
      arc: { id: arcRow.id, orderIndex: arcRow.orderIndex, name: arcRow.name, description: arcRow.description },
      scene: {
        id: sceneRow.id,
        title: sceneRow.title,
        description: sceneRow.description,
        location: sceneRow.location,
        timeOfDay: sceneRow.timeOfDay,
        elapsedMinutes: sceneRow.elapsedMinutes,
        notes: sceneRow.notes ? JSON.parse(sceneRow.notes) : null,
        backgroundImage: sceneRow.backgroundImage,
        locationRelationships: sceneRow.locationRelationships ? JSON.parse(sceneRow.locationRelationships) : null,
        summary: sceneRow.summary,
        lastSummarizedMessageId: sceneRow.lastSummarizedMessageId,
        summaryTokenCount: sceneRow.summaryTokenCount,
        worldState: sceneRow.worldState ? JSON.parse(sceneRow.worldState) : {},
        lastWorldStateMessageNumber: sceneRow.lastWorldStateMessageNumber || 0,
        characterStates: sceneRow.characterStates ? JSON.parse(sceneRow.characterStates) : {}
      },
      activeCharacters: activeCharactersResolved,
      worldState: { elapsedMinutes: campaignState.elapsedMinutes, dynamicFacts: campaignState.dynamicFacts },
      trackers: sanitizedTrackers,
      locationMap: (sceneRow.locationRelationships ? JSON.parse(sceneRow.locationRelationships) : {}),
      lore: matchedLore,
      formattedLore: formattedLore
    };

    // Seed orchestrator worldState from scene-level world state, falling back to campaign dynamic facts
    this.worldState = sessionContext.scene.worldState || sessionContext.worldState.dynamicFacts || {};
    this.trackers = sanitizedTrackers;
    this.characterStates = sessionContext.scene.characterStates || {};

    return sessionContext;
  }

  private preprocessTemplate(template: string, context: AgentContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const value = getNestedField(context, key.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  private getActivatedLore(text: string): string[] {
    const lorebooks = this.db.prepare('SELECT entries FROM lorebooks').all() as any[];
    const activated: string[] = [];
    const lowerText = text.toLowerCase();
    for (const lb of lorebooks) {
      const entries = JSON.parse(lb.entries || '[]');
      for (const entry of entries) {
        const keys = entry.keys || [];
        if (keys.some((key: string) => lowerText.includes(key.toLowerCase()))) {
          activated.push(entry.value);
        }
      }
    }
    return activated;
  }

  private sanitizeTrackers(trackers: any): { stats: Record<string, any>; objectives: any[]; relationships: Record<string, any> } {
    const safeTrackers = trackers || {};
    const stats = { ...(safeTrackers.stats || {}) };

    for (const key of Object.keys(stats)) {
      const lower = key.toLowerCase();
      if (lower.includes('clothing')) {
        delete stats[key];
      }
    }

    return {
      stats,
      objectives: Array.isArray(safeTrackers.objectives) ? safeTrackers.objectives : [],
      relationships: safeTrackers.relationships || {}
    };
  }

  private getCharacterByName(name: string): any {
    const character = this.db.prepare('SELECT * FROM BaseCharacters WHERE json_extract(data, \'$.name\') = ?').get(name) as any;
    if (character) {
      const parsedData = JSON.parse(character.data);
      parsedData.id = character.id;
      parsedData.slug = character.slug;
      return parsedData;
    }
    return null;
  }

  private rehydrateActiveCharacters(activeCharacterIds: string[], worldId?: number, campaignId?: number): any[] {
    const resolved: any[] = [];
    for (const identifier of activeCharacterIds) {
      const merged = CharacterService.getMergedCharacter({
        characterId: identifier,
        worldId,
        campaignId
      });
      if (merged) {
        resolved.push(merged);
      }
    }
    return resolved;
  }

  // Search for characters and personas by name with overrides applied
  private searchForEntities(prompt: string, worldId?: number, campaignId?: number): any[] {
    const matchedEntities: any[] = [];
    
    // Build search pool: all characters + all personas
    const searchPool: Array<{ name: string; type: 'character' | 'persona'; data: any }> = [];
    
    // Add all characters with overrides applied
    const allCharacters = CharacterService.getAllCharacters();
    for (const char of allCharacters) {
      const mergedWithOverrides = CharacterService.getMergedCharacter({
        characterId: char.id,
        worldId,
        campaignId
      });
      if (mergedWithOverrides) {
        searchPool.push({ name: mergedWithOverrides.name, type: 'character', data: mergedWithOverrides });
      }
    }
    
    // Add all personas
    const allPersonas = this.db.prepare('SELECT * FROM personas').all() as any[];
    for (const persona of allPersonas) {
      const flattened = this.getPersona(persona.name);
      searchPool.push({ name: persona.name, type: 'persona', data: flattened });
    }
    
    // Search for matching names in the prompt
    for (const entity of searchPool) {
      if (prompt.toLowerCase().includes(entity.name.toLowerCase())) {
        // Add type field to the data for template usage
        const entityData = { ...entity.data, type: entity.type };
        matchedEntities.push(entityData);
        orchestratorLog(`[searchForEntities] Found ${entity.type}: ${entity.name}`);
      }
    }
    
    return matchedEntities;
  }

  private getPersona(name: string): any {
    const persona = this.db.prepare('SELECT * FROM personas WHERE name = ?').get(name) as any;
    if (persona) {
      // Parse the JSON data and flatten it to top level for easy template access
      const data = JSON.parse(persona.data || '{}');
      return {
        id: persona.id,
        name: persona.name,
        avatarUrl: persona.avatarUrl,
        // Flatten all data properties to top level
        ...data,
        // Also keep as nested for backward compatibility
        data: data
      };
    }
    return { name: 'Default', description: 'A user in the story.', data: {} };
  }

  private buildContextEnvelope(sceneId: number, requestType: 'user' | 'continuation', overrides?: Partial<BuildAgentContextEnvelopeOptions>) {
    const features = this.configManager.getConfig().features || {};
    const config = this.configManager.getConfig();
    const defaultProfile = config.profiles[config.defaultProfile];
    const maxContextTokens = defaultProfile?.sampler?.maxContextTokens;
    
    // Always fetch the latest summary from the database for this scene
    let latestSummary: string | undefined = undefined;
    try {
      const sceneRow = this.db.prepare('SELECT summary FROM Scenes WHERE id = ?').get(sceneId) as any;
      if (sceneRow && sceneRow.summary && typeof sceneRow.summary === 'string' && sceneRow.summary.trim().length > 0) {
        latestSummary = sceneRow.summary;
        this.sceneSummary = sceneRow.summary;
      }
    } catch (e) {
      // If DB fails, fallback to current in-memory summary
      latestSummary = this.sceneSummary;
    }
    console.log(`[ORCHESTRATOR] buildContextEnvelope: Window message size ${features.historyWindowMessages}`);
    return buildAgentContextEnvelope({
      db: this.db,
      sceneId,
      requestType,
      historyWindow: features.historyWindowMessages,
      summarizationTrigger: features.summarizationTriggerMessages,
      summarizedHistory: latestSummary ? [latestSummary] : undefined,
      tokenBudget: maxContextTokens ? { maxContextTokens } : undefined,
      ...overrides
    });
  }

  private recordTokenTelemetry(envelope: any, sceneId?: number): void {
    if (!envelope) return;
    const sumArray = (arr?: string[]) => (arr || []).reduce((acc, v) => acc + (v?.length || 0), 0);
    const sumMemories = (mem?: Record<string, any[]>) => {
      if (!mem) return 0;
      let total = 0;
      for (const entries of Object.values(mem)) {
        for (const entry of entries || []) {
          if (typeof entry === 'string') {
            total += entry.length;
          } else if (entry && typeof entry === 'object') {
            total += JSON.stringify(entry).length;
          }
        }
      }
      return total;
    };
    const sumNotes = (notes?: { world?: string; campaign?: string; arc?: string; scene?: string }) => {
      if (!notes) return 0;
      return Object.values(notes).reduce((acc, v) => acc + ((v || '').length), 0);
    };

    const sections: Record<string, number> = {
      history: sumArray(envelope.history),
      summaries: sumArray(envelope.summarizedHistory) + sumArray(envelope.perRoundSummaries as any),
      lore: (envelope.formattedLore || '').length + sumArray(envelope.lore as any),
      memories: sumMemories(envelope.memories),
      scenarioNotes: sumNotes(envelope.scenarioNotes),
      directorGuidance: envelope.directorGuidance ? JSON.stringify(envelope.directorGuidance).length : 0
    };

    tokenTelemetry.record({
      sceneId,
      roundNumber: this.currentRoundNumber,
      timestamp: new Date().toISOString(),
      sections
    });
  }

  private extractFirstJson(text: string): string | null {
    // First, try to extract from ```json code blocks
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      return jsonMatch[1];
    }
    // Also try for arrays in code blocks
    const arrayMatch = text.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (arrayMatch) {
      return arrayMatch[1];
    }
    // Fallback: extract first JSON object by counting braces
    let braceCount = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (start === -1) start = i;
        braceCount++;
      } else if (text[i] === '}') {
        braceCount--;
        if (braceCount === 0 && start !== -1) {
          return text.substring(start, i + 1);
        }
      }
    }
    return null;
  }

  private parseSlashCommand(input: string): { command: string; args: string[] } | null {
    if (!input.startsWith('/')) return null;
    const parts = input.slice(1).split(' ');
    return { command: parts[0], args: parts.slice(1) };
  }

  private isSceneDescriptionRequest(userInput: string): boolean {
    const lowerInput = userInput.toLowerCase();
    const keywords = ['what do i see', 'describe the scene', 'where am i', 'what\'s around me', 'look around', 'survey the area'];
    return keywords.some(keyword => lowerInput.includes(keyword));
  }

  async processUserInput(userInput: string, personaName: string = 'default', activeCharacters?: string[], sceneId?: number, onCharacterResponse?: (response: { sender: string; content: string }) => void): Promise<{ responses: { sender: string; content: string }[], lore: string[] }> {
    // Task 4.1: Initialize round state if sceneId provided
    if (sceneId) {
      await this.initializeRoundState(sceneId);
    }

    // Clear any pending follow-up passes at the start of a new request
    this.pendingCharacterPass = [];

    const worldAgentEnabled = this.configManager.isWorldAgentEnabled();
    let pendingWorldStateUpdate: { lastWorldStateMessageNumber: number | null } | null = null;
    let pendingTrackersUpdate: { campaignId: number } | null = null;

    // Load scene summary from database if sceneId is provided
    if (sceneId && !this.sceneSummary) {
      const sceneRow = this.db.prepare('SELECT summary FROM Scenes WHERE id = ?').get(sceneId) as any;
      if (sceneRow?.summary) {
        this.sceneSummary = sceneRow.summary;
      }
    }

    // Load recent message history from database for this scene
    if (sceneId) {
      const maxHistoryTokens = 10000;
      const maxMessagesToScan = 200; // Safety limit to avoid scanning entire scene
      
      // Get recent messages from database with token counts (ordered newest first)
      const allRecentMessages = this.db.prepare(
        'SELECT sender, message, tokenCount FROM Messages WHERE sceneId = ? ORDER BY messageNumber DESC LIMIT ?'
      ).all(sceneId, maxMessagesToScan) as Array<{ sender: string; message: string; tokenCount: number }>;
      
      // Accumulate messages until we hit token limit
      const selectedMessages: Array<{ sender: string; message: string }> = [];
      let cumulativeTokens = 0;
      
      for (const msg of allRecentMessages) {
        const msgTokens = msg.tokenCount || 0;
        if (cumulativeTokens + msgTokens > maxHistoryTokens && selectedMessages.length > 0) {
          break; // Stop if adding this message would exceed limit
        }
        selectedMessages.push({ sender: msg.sender, message: msg.message });
        cumulativeTokens += msgTokens;
      }
      
      // Reverse to get chronological order (oldest to newest)
      selectedMessages.reverse();
      
      // Replace in-memory history with database messages
      this.history = selectedMessages.map(m => `${m.sender}: ${m.message}`);
      
      orchestratorLog(`[ORCHESTRATOR] Loaded ${this.history.length} messages (${cumulativeTokens} tokens) from database for scene ${sceneId}`);
    }

    const slashCmd = this.parseSlashCommand(userInput);
    if (slashCmd) {
      return this.handleSlashCommand(slashCmd.command, slashCmd.args, activeCharacters, sceneId, personaName);
    }

    // Check if user is requesting a scene description
    if (this.isSceneDescriptionRequest(userInput)) {
      // Load session context for scene-level data
      const sessionContext = sceneId ? await this.buildSessionContext(sceneId) : null;

      // Add user input to history
      this.history.push(`User: ${userInput}`);

      const contextEnvelope = sceneId
        ? this.buildContextEnvelope(sceneId, 'user', {
            roundNumber: this.currentRoundNumber,
            history: this.history,
            summarizedHistory: this.sceneSummary ? [this.sceneSummary] : undefined,
            characterSummaries: sessionContext?.activeCharacters,
            characterStates: sessionContext?.scene.characterStates,
            worldState: sessionContext?.scene.worldState,
            trackers: sessionContext?.trackers
          })
        : undefined;

      this.recordTokenTelemetry(contextEnvelope, sceneId);

      // Extract user persona state from characterStates if available
      const userPersonaState = sessionContext?.scene.characterStates?.['user'] || 
                               sessionContext?.scene.characterStates?.[personaName] || {};

      // Prepare context
      const context: AgentContext = {
        userInput,
        history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history,
        worldState: this.worldState,
        lore: this.getActivatedLore(userInput + ' ' + this.history.join(' ')),
        userPersona: this.getPersona(personaName),
        userPersonaState: userPersonaState,
        activeCharacters: sessionContext?.activeCharacters || [],
        formattedLore: sessionContext?.formattedLore || '',
        contextEnvelope
      };

      // Query memories for narrator (Phase 3)
      if (sceneId && this.worldState?.id) {
        try {
          const retriever = getMemoryRetriever();
          await retriever.initialize();
          const memories = await retriever.retrieve({
            query: userInput + ' ' + this.sceneSummary,
            scope: `world_${this.worldState.id}_multi`,
            topK: 3,
            minSimilarity: 0.5,
            includeMultiCharacter: true,
          } as any);
          if (memories.length > 0) {
            // Provide raw memories for template rendering and keep formatted string for compatibility
            context.vectorMemoriesRaw = memories;
            context.vectorMemories = retriever.formatMemoriesForPrompt(memories);
            orchestratorLog(`[NARRATOR] Injected ${memories.length} memories into context`);
          }
        } catch (error) {
          orchestratorLog('[NARRATOR] Memory retrieval failed (non-blocking):', error);
        }
      }

      // Call only NarratorAgent for scene description
      const narratorAgent = this.agents.get('narrator')!;
      orchestratorLog('Calling NarratorAgent');
      this.emitAgentStatus('Narrator', 'start', sceneId);
      let narration: string = '';
      try {
        narration = await narratorAgent.run(context);
        orchestratorLog('NarratorAgent completed');
      } catch (error) {
        orchestratorLog('[NARRATOR] Agent call failed:', error);
        narration = 'The narrator is momentarily silent.';
      }
      this.emitAgentStatus('Narrator', 'complete', sceneId);
      this.history.push(`Narrator: ${narration}`);
      return { responses: [{ sender: 'Narrator', content: narration }], lore: [] };
    }

    // Normal interaction flow
    // Track current round start position before adding user input
    const currentRoundStartIndex = this.history.length;
    
    // Add user input to history
    this.history.push(`User: ${userInput}`);

    // Load session context for scene-level data
    const sessionContext = sceneId ? await this.buildSessionContext(sceneId) : null;

    // If no sceneId, we can't do world state management
    if (!sessionContext) {
      // Fallback to basic interaction without scene-level state
      // This would be for non-scene based interactions
      return { responses: [{ sender: 'System', content: 'Scene context required for full interaction' }], lore: [] };
    }

    const maxDirectorPasses = this.configManager.getConfig().features?.maxDirectorPasses ?? 2;
    const roundTimeline: any = { roundNumber: this.currentRoundNumber };

    const audit = (type: string, detail: Record<string, unknown> = {}) => {
      roundTimeline.auditLog = roundTimeline.auditLog || [];
      roundTimeline.auditLog.push({
        type,
        roundNumber: this.currentRoundNumber,
        timestamp: new Date().toISOString(),
        ...detail
      });
    };

    const emitLifecycle = (eventName: string, payload: Record<string, unknown> = {}) => {
      this.emitSceneEvent(eventName, payload, sceneId);
    };

    if (sceneId) {
      const seedActiveCharacters = (sessionContext.activeCharacters || [])
        .map((c: any) => c?.id || c?.name)
        .filter((v: any) => !!v);
      SceneService.startRound(sceneId, seedActiveCharacters);
      audit('roundStarted', { sceneId, roundNumber: this.currentRoundNumber, activeCharacters: seedActiveCharacters });
      emitLifecycle('roundStarted', { activeCharacters: seedActiveCharacters });
    }

    const contextEnvelope = sceneId
      ? this.buildContextEnvelope(sceneId, 'user', {
          roundNumber: this.currentRoundNumber,
          history: this.history.slice(0, currentRoundStartIndex), // Exclude current round
          summarizedHistory: this.sceneSummary ? [this.sceneSummary] : undefined,
          characterSummaries: sessionContext.activeCharacters,
          characterStates: sessionContext.scene.characterStates,
          worldState: sessionContext.scene.worldState,
          trackers: sessionContext.trackers
        })
      : undefined;

    this.recordTokenTelemetry(contextEnvelope, sceneId);

    // Prepare base context
    let context: AgentContext = {
      userInput,
      history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history,
      worldState: this.worldState,
      lore: this.getActivatedLore(userInput + ' ' + this.history.join(' ')),
      formattedLore: sessionContext.formattedLore,
      userPersona: this.getPersona(personaName),
      contextEnvelope
    };

    let characterStates = { ...(sessionContext.scene.characterStates || {}) };
    const summarizationEnabled = this.configManager.getConfig().features?.summarizationEnabled ?? false
    // Step 1: Summarize if history too long (simple check: > 10 messages)
    if (summarizationEnabled && this.history.length > 10) {
      const summarizeAgent = this.agents.get('summarize')!;
      orchestratorLog('Calling SummarizeAgent');
      this.emitAgentStatus('Summarize', 'start', sceneId);
      let summary: string = '';
      let summarizeParsed: any = null;
      let summarizeRetries = 0;
      let summarizeLastError: any = null;
      while (summarizeRetries < 3) {
        const summarizeResponse = await summarizeAgent.run(context);
        try {
          summarizeParsed = JSON.parse(summarizeResponse);
          break;
        } catch (e) {
          summarizeLastError = e;
          const repaired = tryJsonRepair(summarizeResponse);
          if (repaired) {
            try {
              summarizeParsed = JSON.parse(repaired);
              break;
            } catch (e2) {
              summarizeLastError = e2;
            }
          }
          const jsonMatch = summarizeResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              summarizeParsed = JSON.parse(jsonMatch[0]);
              break;
            } catch (innerE) {
              summarizeLastError = innerE;
            }
          }
        }
        summarizeRetries++;
      }
      if (summarizeParsed && summarizeParsed.summary) {
        summary = summarizeParsed.summary;
      } else if (summarizeParsed && typeof summarizeParsed === 'string') {
        summary = summarizeParsed;
      } else {
        summary = '';
        orchestratorLog('SummarizeAgent failed to parse/repair JSON after', summarizeRetries, 'attempts:', summarizeLastError);
      }
      orchestratorLog('SummarizeAgent completed');
      this.emitAgentStatus('Summarize', 'complete', sceneId);
      this.sceneSummary = summary;
      // Truncate history
      this.history = this.history.slice(-5);
    }

    // Step 2: Director guidance and character selection
    const directorAgent = this.agents.get('director')!;
    // Resolve active character names. Prefer explicit `activeCharacters` parameter when provided
    const safeActiveNames = (sessionContext.activeCharacters || [])
      .map((c: any) => (c && (c.name || c.displayName || c.id)) || null)
      .filter((n: any) => !!n);

    const paramResolvedNames = (activeCharacters || [])
      .map((a: any) => {
        // Try to match against resolved session characters first
        const match = (sessionContext.activeCharacters || []).find((c: any) => c && (c.id === a || c.name === a || c.slug === a));
        if (match) return match.name || match.displayName || match.id;

        // Try to resolve via CharacterService (if 'a' is an id)
        try {
          const merged = CharacterService.getMergedCharacter({ characterId: a, worldId: sessionContext.world.id, campaignId: sessionContext.campaign.id });
          if (merged) return merged.name || merged.displayName || merged.id;
        } catch (e) {
          // ignore resolution errors
        }

        // Try lookup by name as a last resort
        const byName = this.getCharacterByName(String(a));
        if (byName) return byName.name || byName.id;

        return null;
      })
      .filter((n: any) => !!n);

    const activeCharacterNamesStr = paramResolvedNames.length ? paramResolvedNames.join(', ') : (safeActiveNames.length ? safeActiveNames.join(', ') : 'None');
    
    // Get all available characters for potential activation
    const allAvailableChars = CharacterService.getAllCharacters();
    const availableCharNames = allAvailableChars
      .map((c: any) => {
        const merged = CharacterService.getMergedCharacter({
          characterId: c.id,
          worldId: sessionContext.world.id,
          campaignId: sessionContext.campaign.id
        });
        return merged ? (merged.name || merged.displayName || merged.id) : null;
      })
      .filter((n: any) => !!n);
    
    const directorContext = { 
      ...context, 
      activeCharacters: activeCharacters || [],
      activeCharacterNames: activeCharacterNamesStr,
      availableCharacterNames: availableCharNames.join(', '),
      history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history
    };
    const directorAgentEnabled = this.configManager.isDirectorAgentEnabled();
    let directorOutput = '';
    
    if (directorAgentEnabled) {
      audit('directorPassStarted', { pass: 1, activeCharacterNames: activeCharacterNamesStr });
      emitLifecycle('directorPassStarted', { pass: 1, activeCharacterNames: activeCharacterNamesStr });
      orchestratorLog('Calling DirectorAgent');
      this.emitAgentStatus('Director', 'start', sceneId);
      try {
        directorOutput = await directorAgent.run(directorContext);
        orchestratorLog('DirectorAgent completed, output length:', directorOutput.length);
        orchestratorLog('DirectorAgent raw output preview:', directorOutput.substring(0, 200) + (directorOutput.length > 200 ? '...' : ''));
      } catch (error) {
        orchestratorLog('[DIRECTOR] Agent call failed (pass 1):', error);
        directorOutput = '{}';
      }
      this.emitAgentStatus('Director', 'complete', sceneId);
    } else {
      orchestratorLog('DirectorAgent disabled, skipping first pass');
    }
    
    // Check if the director returned a validation error
    let isValidationError = false;
    try {
      const quickParse = JSON.parse(directorOutput.trim());
      if (quickParse && quickParse.error === 'failed_json_validation') {
        isValidationError = true;
        orchestratorLog('[DIRECTOR ERROR] Director returned validation error:', quickParse.errors);
        // Continue with fallback parsing rather than treating this as valid director output
      }
    } catch (e) {
      // Not JSON or not an error object, continue normal parsing
    }
    
    // Parse Director output using schema (actingCharacters, activations, stateUpdates, openGuidance)
    let charactersToRespond: string[] = [];
    let directorParsed: any = null;
    let directorRetries = 0;
    let directorLastError: any = null;
    
    // Skip parsing attempts if we already know it's a validation error or director is disabled
    if (directorAgentEnabled && !isValidationError) {
      while (directorRetries < 3) {
      let cleanedOutput = directorOutput.trim();
      if (cleanedOutput.startsWith('```json') && cleanedOutput.endsWith('```')) {
        cleanedOutput = cleanedOutput.slice(7, -3).trim();
      }
      try {
        directorParsed = JSON.parse(cleanedOutput);
        break;
      } catch (e) {
        directorLastError = e;
        const repaired = tryJsonRepair(cleanedOutput);
        if (repaired) {
          try {
            directorParsed = JSON.parse(repaired);
            break;
          } catch (e2) {
            directorLastError = e2;
          }
        }
        const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            directorParsed = JSON.parse(jsonMatch[0]);
            break;
          } catch (innerE) {
            directorLastError = innerE;
          }
        }
      }
      directorRetries++;
    }
    }

    let directorPlan = directorParsed ? normalizeDirectorPlan(directorParsed) : normalizeDirectorPlan({ openGuidance: directorOutput });
    
    // If director is disabled, use a minimal plan with empty guidance
    if (!directorAgentEnabled) {
      directorPlan = normalizeDirectorPlan({ openGuidance: '' });
      orchestratorLog('[DIRECTOR] Disabled - using fallback plan with no guidance');
    }
    
    // Never allow the user persona to appear in director lists
    if (personaName) {
      const normalizeRef = (ref?: string) => {
        if (!ref) return '';
        const base = String(ref).trim().toLowerCase();
        return base.endsWith('_implied') ? base.slice(0, -8) : base;
      };
      const userRef = normalizeRef(personaName);
      const isUserRef = (ref?: string) => normalizeRef(ref) === userRef;

      directorPlan.actingCharacters = (directorPlan.actingCharacters || []).filter((c) => !isUserRef(c.name) && !isUserRef(c.id));
      directorPlan.activations = (directorPlan.activations || []).filter((a) => !isUserRef(String(a)));
      directorPlan.deactivations = (directorPlan.deactivations || []).filter((d) => !isUserRef(String(d)));
      directorPlan.stateUpdates = (directorPlan.stateUpdates || []).filter((s) => !isUserRef(s.name) && !isUserRef(s.id));
      directorPlan.remainingActors = (directorPlan.remainingActors || []).filter((r) => !isUserRef(r));
      directorPlan.newActivations = (directorPlan.newActivations || []).filter((r) => !isUserRef(r));
    }
    // Helper function for round-robin character selection (fallback when director is unavailable)
    // Uses heuristics: 1) Order by mention in user input, 2) Random order if no mentions
    // For continue rounds: starts with the character who should respond next after the last responder
    const getRoundRobinCharacters = () => {
      // Filter out user persona
      const normalizeRef = (ref?: string) => {
        if (!ref) return '';
        const base = String(ref).trim().toLowerCase();
        return base.endsWith('_implied') ? base.slice(0, -8) : base;
      };
      
      const eligibleCharacters = sessionContext.activeCharacters
        .filter(c => {
          if (!personaName) return true;
          return normalizeRef(c.name) !== normalizeRef(personaName);
        });
      
      // Check if this is a continue round (synthetic input from continueRound)
      const isContinueRound = (userInput || '').startsWith('[System: Continue scene');
      
      if (isContinueRound) {
        // Get the last character who responded in this round
        const lastMessage = this.history[this.history.length - 1];
        let lastResponder: string | null = null;
        
        if (lastMessage) {
          const match = lastMessage.match(/^([^:]+):/);
          if (match) {
            lastResponder = match[1].trim();
          }
        }
        
        if (lastResponder) {
          // Find the index of the last responder in eligible characters
          const lastResponderIndex = eligibleCharacters.findIndex(
            c => normalizeRef(c.name) === normalizeRef(lastResponder!)
          );
          
          if (lastResponderIndex !== -1) {
            // Rotate the array so the next character after last responder is first
            const rotatedChars = [
              ...eligibleCharacters.slice(lastResponderIndex + 1),
              ...eligibleCharacters.slice(0, lastResponderIndex + 1)
            ];
            
            orchestratorLog(`[DIRECTOR] Continue round: rotating order to start after ${lastResponder}`);
            return rotatedChars.map(c => c.name);
          }
        }
        
        // If we couldn't determine last responder, fall through to normal logic
        orchestratorLog(`[DIRECTOR] Continue round: couldn't determine last responder, using normal order`);
      }
      
      // Detect character mentions in user input
      const inputLower = (userInput || '').toLowerCase();
      const mentionedChars: Array<{ char: any; index: number }> = [];
      const unmentionedChars: any[] = [];
      
      for (const char of eligibleCharacters) {
        const nameLower = char.name.toLowerCase();
        const index = inputLower.indexOf(nameLower);
        
        if (index >= 0) {
          mentionedChars.push({ char, index });
        } else {
          unmentionedChars.push(char);
        }
      }
      
      // Sort mentioned characters by order of appearance in input
      mentionedChars.sort((a, b) => a.index - b.index);
      
      // Shuffle unmentioned characters for variety
      for (let i = unmentionedChars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unmentionedChars[i], unmentionedChars[j]] = [unmentionedChars[j], unmentionedChars[i]];
      }
      
      // Combine: mentioned first (in order), then unmentioned (shuffled)
      const orderedChars = [
        ...mentionedChars.map(m => m.char),
        ...unmentionedChars
      ];
      
      // If no one was mentioned, the list is fully shuffled
      const orderingMethod = mentionedChars.length > 0 
        ? `${mentionedChars.length} mentioned, ${unmentionedChars.length} shuffled`
        : `all ${orderedChars.length} shuffled`;
      
      orchestratorLog(`[DIRECTOR] Round-robin ordering: ${orderingMethod}`);
      
      return orderedChars.map(c => c.name);
    };

    orchestratorLog('[DIRECTOR PASS1] mentions -> acting:%s activations:%s deactivations:%s',
      JSON.stringify((directorPlan.actingCharacters || []).map((a: any) => a.name || a.id)),
      JSON.stringify(directorPlan.activations || []),
      JSON.stringify(directorPlan.deactivations || []));
    if (directorAgentEnabled && !directorParsed) {
      orchestratorLog('DirectorAgent failed to parse/repair JSON after', directorRetries, 'attempts:', directorLastError);
      const guidanceMatch = directorOutput.match(/Guidance:\s*(.+?)(?:\n|$)/i);
      const charactersMatch = directorOutput.match(/Characters:\s*(.+?)(?:\n|$)/i);
      if (guidanceMatch) {
        directorPlan = { ...directorPlan, openGuidance: guidanceMatch[1].trim() };
      }
      if (charactersMatch) {
        const charsStr = charactersMatch[1].trim();
        if (charsStr.toLowerCase() !== 'none') {
          directorPlan.actingCharacters = charsStr.split(',').map((name: string) => ({ name: name.trim() })).filter((c: any) => c.name);
        }
      }
    }

    const directorApplication = applyDirectorPlan(directorPlan, sessionContext, characterStates);
    charactersToRespond = directorApplication.charactersToRespond;
    characterStates = directorApplication.updatedStates;

    // Use round-robin fallback when director is disabled or failed to parse
    if (!directorAgentEnabled) {
      charactersToRespond = getRoundRobinCharacters();
      orchestratorLog('[DIRECTOR] Disabled - using round-robin fallback with active characters:', charactersToRespond);
    } else if (directorAgentEnabled && !directorParsed) {
      charactersToRespond = getRoundRobinCharacters();
      orchestratorLog('[DIRECTOR] Parse failed - using round-robin fallback with active characters:', charactersToRespond);
    }

    emitLifecycle('directorPassCompleted', {
      pass: 1,
      orderedActors: directorApplication.orderedActors,
      activations: directorApplication.activations,
      deactivations: directorApplication.deactivations
    });
    audit('directorPassCompleted', {
      pass: 1,
      orderedActors: directorApplication.orderedActors,
      activations: directorApplication.activations,
      deactivations: directorApplication.deactivations,
      parsed: !!directorParsed,
      retries: directorRetries,
      lastError: directorLastError?.message
    });

    roundTimeline.directorPass1 = {
      rawOutput: directorOutput,
      plan: directorPlan,
      orderedActors: directorApplication.orderedActors,
      activations: directorApplication.activations,
      deactivations: directorApplication.deactivations,
      stateUpdates: directorApplication.appliedStateUpdates
    };

    const directiveMap: Record<string, string | undefined> = {};
    for (const actor of directorApplication.orderedActors) {
      if (actor.name) {
        directiveMap[actor.name] = actor.guidance;
      }
    }

    const entrySet = new Set<string>((directorApplication.activations || []).map((a) => a.name || a.id || ''));
    const exitSet = new Set<string>((directorApplication.deactivations || []).map((a) => a.name || a.id || ''));

    const activeCharacterIds = directorApplication.activeCharacterIds;
    if (sceneId && activeCharacterIds.length > 0) {
      SceneService.update(sceneId, { activeCharacters: activeCharacterIds, characterStates });
      this.emitSceneEvent('activeCharactersUpdated', { sceneId, activeCharacters: activeCharacterIds }, sceneId);
    }

    // Refresh resolved active characters for downstream agents
    if (activeCharacterIds.length > 0) {
      const rehydrated = this.rehydrateActiveCharacters(activeCharacterIds, sessionContext.world.id, sessionContext.campaign.id);
      if (rehydrated.length > 0) {
        sessionContext.activeCharacters = rehydrated;
      }
      // Emit resolved active characters for frontend panels
      this.emitSceneEvent('activeCharactersUpdated', { sceneId, activeCharacters: sessionContext.activeCharacters }, sceneId);
    }
    sessionContext.scene.characterStates = characterStates;
    if (context.contextEnvelope) {
      context.contextEnvelope.characterStates = characterStates;
      context.contextEnvelope.directorGuidance = {
        openGuidance: directorPlan.openGuidance,
        actingCharacters: directorApplication.orderedActors,
        activations: directorApplication.activations,
        deactivations: directorApplication.deactivations,
        appliedStateUpdates: directorApplication.appliedStateUpdates
      };
    }

    const directorGuidance = directorPlan.openGuidance || directorOutput;
    orchestratorLog('Active characters passed to Director:', activeCharacters);
    orchestratorLog('Director selected characters:', charactersToRespond);
    orchestratorLog('[DIRECTOR] Audit snapshot:', {
      openGuidance: directorGuidance,
      actingCharacters: directorApplication.orderedActors,
      activations: directorApplication.activations,
      deactivations: directorApplication.deactivations,
      stateUpdates: directorApplication.appliedStateUpdates
    });

    if (!directorGuidance && !charactersToRespond.length) {
      orchestratorLog('Failed to parse DirectorAgent output properly:', directorOutput);
      if (activeCharacters && activeCharacters.length > 0) {
        charactersToRespond = [activeCharacters[0]];
      } else {
        charactersToRespond = [];
      }
    }
    context.directorGuidance = directorGuidance;

    // Step 4: Characters
    let responses: { sender: string; content: string }[] = [];
    
    // Initialize character states if not present
    const userPersonaName = personaName || 'user';
    if (!characterStates[userPersonaName]) {
      const userPersona = context.userPersona;
      const initialState: Record<string, any> = {
        mood: userPersona.personality?.split(',')[0]?.trim() || 'neutral',
        activity: userPersona.occupation || 'interacting',
        location: sessionContext.scene.location || 'unknown',
        position: 'standing'
      };
      const clothing = userPersona.currentOutfit || userPersona.appearance?.aesthetic;
      if (clothing) {
        initialState.clothing = clothing;
      }
      characterStates[userPersonaName] = initialState;
    }
    for (const char of sessionContext.activeCharacters) {
      if (!characterStates[char.name]) {
        const extractedState = this.extractStateFromDescription(char);
        const initialState: Record<string, any> = {
          mood: extractedState.mood || char.personality?.split(',')[0]?.trim() || 'neutral',
          activity: extractedState.activity || char.occupation || 'present',
          location: sessionContext.scene.location || 'unknown',
          position: 'standing'
        };
        const clothing = extractedState.clothing || char.currentOutfit || char.appearance?.aesthetic;
        if (clothing) {
          initialState.clothing = clothing;
        }
        characterStates[char.name] = initialState;
        orchestratorLog(`Initialized character state for ${char.name}:`, characterStates[char.name]);
      }
      // Track per-round flags
      characterStates[char.name].enteredThisRound = entrySet.has(char.name) || entrySet.has(char.id || '');
      characterStates[char.name].exitedThisRound = exitSet.has(char.name) || exitSet.has(char.id || '');
      characterStates[char.name].hasActedThisRound = false;
      if (!characterStates[char.name].intentions && directiveMap[char.name]) {
        characterStates[char.name].intentions = directiveMap[char.name];
      }
    }
    orchestratorLog('Character states after initialization:', Object.keys(characterStates));
    
    // Step 3: World state update
    if (worldAgentEnabled) {
      const worldAgent = this.agents.get('world');
      if (!worldAgent) {
        orchestratorLog('[WORLD] WorldAgent not registered; skipping world update');
      } else {
        // Get messages since last world state update
        const lastMessageNumber = sessionContext.scene.lastWorldStateMessageNumber || 0;
        const recentMessages = this.db.prepare('SELECT message, sender FROM Messages WHERE sceneId = ? AND messageNumber > ? ORDER BY messageNumber').all(sceneId!, lastMessageNumber) as any[];
        const recentEvents = recentMessages.map(m => `${m.sender}: ${m.message}`);
        
        // Get current user persona state from character states
        const userPersonaState = characterStates[personaName || 'user'] || {};
        
        const worldContext = {
          ...context,
          previousWorldState: sessionContext.scene.worldState,
          userPersonaState,
          scene: sessionContext.scene,
          recentEvents,
          trackers: sessionContext.trackers
        };
        
        audit('worldUpdateStarted', { enabled: true });
        emitLifecycle('worldUpdateStarted', { enabled: true });
        orchestratorLog('Calling WorldAgent');
        this.emitAgentStatus('WorldAgent', 'start', sceneId);
        let worldUpdateStr: string = '{}';
        try {
          worldUpdateStr = await worldAgent.run(worldContext);
          orchestratorLog('WorldAgent completed');
        } catch (error) {
          orchestratorLog('[WORLD] Agent call failed:', error);
          worldUpdateStr = '{}';
        }
        this.emitAgentStatus('WorldAgent', 'complete', sceneId);
        // Parse JSON response from WorldAgent (enforced by response_format)
        let worldStateChanged = false;
        let trackersChanged = false;
        let worldParsed: any = null;
        let worldRetries = 0;
        let worldLastError: any = null;
        while (worldRetries < 3) {
          let cleanedOutput = worldUpdateStr.trim();
          if (cleanedOutput.startsWith('```json') && cleanedOutput.endsWith('```')) {
            cleanedOutput = cleanedOutput.slice(7, -3).trim();
          }
          try {
            worldParsed = JSON.parse(cleanedOutput);
            break;
          } catch (e) {
            worldLastError = e;
            // Try jsonrepair
            const repaired = tryJsonRepair(cleanedOutput);
            if (repaired) {
              try {
                worldParsed = JSON.parse(repaired);
                break;
              } catch (e2) {
                worldLastError = e2;
              }
            }
            // Try to extract JSON object from within the string
            const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                worldParsed = JSON.parse(jsonMatch[0]);
                break;
              } catch (innerE) {
                worldLastError = innerE;
              }
            }
          }
          worldRetries++;
        }
        if (worldParsed) {
          // Handle both object and array responses
          if (Array.isArray(worldParsed)) {
            if (worldParsed.length > 0 && typeof worldParsed[0] === 'object' && worldParsed[0] !== null) {
              worldParsed = worldParsed[0];
            } else {
              worldParsed = {};
            }
          }
          if (!worldParsed.unchanged) {
            if (worldParsed.worldState) {
              Object.assign(this.worldState, worldParsed.worldState);
              worldStateChanged = true;
              // Handle user persona state updates from worldState
              if (worldParsed.worldState.userPersonaState && typeof worldParsed.worldState.userPersonaState === 'object') {
                orchestratorLog('[WORLD] Updating user persona state from worldState:', worldParsed.worldState.userPersonaState);
                // Merge provided state fields, avoiding 'default' values
                const userPersonaKey = personaName || 'user';
                if (!characterStates[userPersonaKey]) {
                  characterStates[userPersonaKey] = {};
                }
                for (const [key, value] of Object.entries(worldParsed.worldState.userPersonaState)) {
                  if (value && value !== 'default' && value !== 'Default') {
                    characterStates[userPersonaKey][key] = value;
                  }
                }
                orchestratorLog('[WORLD] User persona state after update:', characterStates[userPersonaKey]);
                // Remove userPersonaState from worldState after processing
                delete this.worldState.userPersonaState;
              }
            }
            // NOTE: WorldAgent should NOT modify character states - those are handled by CharacterAgent only
            if (worldParsed.trackers) {
              // Normalize objectives to array if it's an object
              if (worldParsed.trackers.objectives && typeof worldParsed.trackers.objectives === 'object' && !Array.isArray(worldParsed.trackers.objectives)) {
                worldParsed.trackers.objectives = Object.values(worldParsed.trackers.objectives).map((obj: any) => typeof obj === 'string' ? obj : obj.description || JSON.stringify(obj));
              }
              Object.assign(this.trackers, worldParsed.trackers);
              trackersChanged = true;
            }
          }
        } else {
          orchestratorLog('WorldAgent failed to parse/repair JSON after', worldRetries, 'attempts:', worldLastError);
        }
        
        // Save staged world/trackers updates for end-of-round persistence
        if (worldStateChanged) {
          const currentMaxMessageNumber = this.db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId!) as any;
          const newLastMessageNumber = currentMaxMessageNumber?.maxNum || 0;
          pendingWorldStateUpdate = { lastWorldStateMessageNumber: newLastMessageNumber };
        }
        if (trackersChanged) {
          pendingTrackersUpdate = { campaignId: sessionContext.campaign.id };
        }
        
        audit('worldUpdateCompleted', {
          enabled: true,
          worldStateChanged,
          trackersChanged,
          parsed: !!worldParsed,
          retries: worldRetries,
          lastError: worldLastError?.message
        });
        emitLifecycle('worldUpdateCompleted', {
          enabled: true,
          worldStateChanged,
          trackersChanged
        });

        // Emit updated state to frontend
        this.emitSceneEvent('stateUpdated', { state: this.worldState, trackers: this.trackers, characterStates: characterStates }, sceneId);
        
        context.worldState = this.worldState;
        roundTimeline.worldAgent = { enabled: true, parsed: !!worldParsed };
      }
    } else {
      orchestratorLog('[WORLD] WorldAgent disabled via feature flag; skipping world update (Director owns trackers/world updates)');
      audit('worldUpdateSkipped', { enabled: false });
      emitLifecycle('worldUpdateCompleted', { enabled: false, reason: 'disabled' });
      roundTimeline.worldAgent = { enabled: false, reason: 'disabled' };
    }

    // Track responses from this turn to pass to subsequent characters
    const turnResponses: { character: string; response: string }[] = [];

    for (const charName of charactersToRespond) {
      orchestratorLog(`Processing character: ${charName}`);
      emitLifecycle('characterRunStarted', { character: charName });
      audit('characterRunStarted', { character: charName });
      
      // Ensure character state exists
      if (!characterStates[charName]) {
        orchestratorLog(`Initializing character state for ${charName}`);
        characterStates[charName] = {
          mood: 'neutral',
          activity: 'responding',
          location: sessionContext?.scene?.location || 'unknown',
          position: 'standing'
        };
      }
      
      // Try multiple matching strategies to find the character
      let characterData = sessionContext.activeCharacters.find(c => c.name.toLowerCase() === charName.toLowerCase());
      
      // If not found by exact name match, try substring matching
      if (!characterData && charName) {
        characterData = sessionContext.activeCharacters.find(c => 
          c.name.toLowerCase().includes(charName.toLowerCase()) || 
          charName.toLowerCase().includes(c.name.toLowerCase())
        );
      }
      
      // If still not found, log available characters and skip
      if (!characterData) {
        orchestratorLog(`Character ${charName} not found in active characters. Available: ${JSON.stringify(sessionContext.activeCharacters.map(c => c.name))}`);
        continue;
      }

      const characterAgent = new CharacterAgent(charName, this.configManager, this.env);
      
      // Build current round messages (all responses so far in this round)
      const currentRoundMessages = turnResponses.map(r => `${r.character}: ${r.response}`);
      
      // Build fresh context envelope for character WITHOUT caps (CharacterAgent handles its own token budgeting)
      const characterEnvelope = sceneId
        ? this.buildContextEnvelope(sceneId, 'user', {
            roundNumber: this.currentRoundNumber,
            history: this.history.slice(0, currentRoundStartIndex),
            summarizedHistory: this.sceneSummary ? [this.sceneSummary] : undefined,
            characterSummaries: sessionContext.activeCharacters,
            characterStates: sessionContext.scene.characterStates,
            worldState: sessionContext.scene.worldState,
            trackers: sessionContext.trackers,
            tokenBudget: undefined  // Disable contextBuilder caps - CharacterAgent handles budgeting
          })
        : undefined;
      
      const characterContext: AgentContext = {
        ...context,
        contextEnvelope: characterEnvelope,  // Use fresh uncapped envelope
        character: characterData,
        characterState: characterStates[charName],
        characterDirective: directiveMap[charName],
        entryGuidance: entrySet.has(charName) || entrySet.has(characterData?.id || '') ? 'You are entering this turn; establish presence with decisive action.' : undefined,
        exitGuidance: exitSet.has(charName) || exitSet.has(characterData?.id || '') ? 'You may be exiting after this response; close the beat cleanly.' : undefined,
        roundFlags: {
          enteredThisRound: characterStates[charName].enteredThisRound,
          exitedThisRound: characterStates[charName].exitedThisRound,
          hasActedThisRound: characterStates[charName].hasActedThisRound
        },
        maxCompletionTokens: (characterAgent as any).getProfile().sampler?.max_completion_tokens || 400,
      };
      
      // Update context envelope with current round messages if envelope exists
      if (characterContext.contextEnvelope) {
        characterContext.contextEnvelope.lastRoundMessages = currentRoundMessages;
      }

      // Query memories for character (Phase 3)
      if (sceneId && characterData?.id) {
        try {
          const worldId = SceneService.getWorldIdFromSceneId(sceneId);
          orchestratorLog(`[CHARACTER_MEMORY] Querying memories for ${charName} (id: ${characterData.id}) in world ${worldId}, scene ${sceneId}`);
          const retriever = getMemoryRetriever();
          await retriever.initialize();
          const query = userInput + ' ' + this.history.join(' ').substring(0, 500);
          orchestratorLog(`[CHARACTER_MEMORY] Query text length: ${query.length}`);
          const scope = `world_${worldId}_char_${characterData.id}`;
          const memories = await retriever.retrieve({ scope, query, topK: 5, minSimilarity: 0.5 } as any);
          orchestratorLog(`[CHARACTER_MEMORY] Retrieved ${memories.length} memories for ${charName}`);
          if (memories.length > 0) {
            // Inject raw memories into character context; leave formatted for backwards compatibility
            characterContext.vectorMemoriesRaw = memories;
            characterContext.vectorMemories = retriever.formatMemoriesForPrompt(memories);
            
            // Add memories to context envelope for proper message construction
            if (characterContext.contextEnvelope) {
              if (!characterContext.contextEnvelope.memories) {
                characterContext.contextEnvelope.memories = {};
              }
              // Store as array of memory objects for formatMemories to process
              characterContext.contextEnvelope.memories[charName] = memories;
            }
            
            orchestratorLog(`[CHARACTER] ${charName}: Injected ${memories.length} memories into context and envelope`);
          } else {
            orchestratorLog(`[CHARACTER_MEMORY] No memories found for ${charName}`);
          }
        } catch (error) {
          orchestratorLog(`[CHARACTER] ${charName}: Memory retrieval failed (non-blocking):`, error);
        }
      } else {
        orchestratorLog(`[CHARACTER_MEMORY] Skipping memory query - sceneId: ${sceneId}, worldId: ${this.worldState?.id}, charId: ${characterData?.id}`);
      }

      orchestratorLog(`[CHARACTER] Calling CharacterAgent for "${charName}"`);
      orchestratorLog(`[CHARACTER] Character profile: name=${characterData?.name}, includes lore: ${!!context.formattedLore}`);
      let characterResponse: string | null = null;
      let characterParsed: any = null;
      let characterRetries = 0;
      let characterLastError: any = null;
      this.emitAgentStatus(charName, 'start', sceneId);
      while (characterRetries < 3) {
        if (characterRetries > 0) {
          orchestratorLog(`[CHARACTER] Retry ${characterRetries} for "${charName}"`);
        }
        // Call LLM
        try {
          characterResponse = await characterAgent.run(characterContext);
        } catch (error) {
          orchestratorLog(`[CHARACTER] Agent call failed for "${charName}" (attempt ${characterRetries + 1}):`, error);
          characterLastError = error;
          characterRetries++;
          continue;
        }
        orchestratorLog(`[CHARACTER] CharacterAgent for "${charName}" completed (attempt ${characterRetries + 1})`);
        orchestratorLog(`[CHARACTER] Raw response length: ${characterResponse?.length || 0} chars`);
        orchestratorLog(`[CHARACTER] First 200 chars of response: ${characterResponse?.substring(0, 200) || 'EMPTY'}`);
        
        if (characterResponse) {
          // Strip ```json wrapper if present
          let cleanedResponse = characterResponse.trim();
          if (cleanedResponse.startsWith('```json') && cleanedResponse.endsWith('```')) {
            cleanedResponse = cleanedResponse.slice(7, -3).trim();
          }
          
          // Try direct parse
          try {
            characterParsed = JSON.parse(cleanedResponse);
            // Validate that parsed object has content
            if (characterParsed && characterParsed.response) {
              orchestratorLog(`[CHARACTER] Successfully parsed JSON with content on attempt ${characterRetries + 1}`);
              break;
            } else {
              characterLastError = new Error('Parsed JSON missing "response" field or empty content');
              orchestratorLog(`[CHARACTER] Direct parse succeeded but missing content: ${characterLastError}`);
            }
          } catch (e) {
            characterLastError = e;
            orchestratorLog(`[CHARACTER] Direct parse failed: ${e}`);
            
            // Try jsonrepair
            const repaired = tryJsonRepair(cleanedResponse);
            if (repaired) {
              try {
                characterParsed = JSON.parse(repaired);
                // Validate that repaired JSON has content
                if (characterParsed && characterParsed.response) {
                  orchestratorLog(`[CHARACTER] Successfully repaired and parsed JSON with content on attempt ${characterRetries + 1}`);
                  break;
                } else {
                  characterLastError = new Error('Repaired JSON missing "response" field or empty content');
                  orchestratorLog(`[CHARACTER] Repaired parse succeeded but missing content: ${characterLastError}`);
                }
              } catch (e2) {
                characterLastError = e2;
                orchestratorLog(`[CHARACTER] Repaired parse failed: ${e2}`);
                // If repair failed, loop will retry with fresh LLM call
              }
            } else {
              orchestratorLog(`[CHARACTER] jsonrepair returned null, will retry with fresh LLM call`);
            }
          }
        }
        
        characterRetries++;
      }
      
      // Emit agent complete status AFTER all retries finish
      this.emitAgentStatus(charName, 'complete', sceneId);
      
      if (!characterParsed) {
        orchestratorLog(`[CHARACTER] Failed to parse/repair JSON after ${characterRetries} attempts:`, characterLastError);
        // Treat plain text response as the character's speech
        orchestratorLog(`[CHARACTER] Treating response as plain text: ${characterResponse?.substring(0, 100)}...`);
        characterParsed = { response: characterResponse || '', characterState: null };
      }
      const content = characterParsed.response;
      // Update character state if provided in response
      if (characterParsed.characterState && typeof characterParsed.characterState === 'object') {
        const newState = { ...characterStates[charName] };
        for (const [key, value] of Object.entries(characterParsed.characterState)) {
          if (value && value !== 'default' && value !== 'Default') {
            newState[key] = value;
          }
        }
        // Phase 5 heuristic: mark action flags and intentions
        newState.hasActedThisRound = true;
        if (!newState.intentions && characterContext.characterDirective) {
          newState.intentions = characterContext.characterDirective;
        }
        if (characterContext.roundFlags?.enteredThisRound) newState.enteredThisRound = true;
        if (characterContext.roundFlags?.exitedThisRound) newState.exitedThisRound = true;

        characterStates[charName] = newState;
        // Save updated character state to scene immediately
        SceneService.update(sceneId!, { characterStates });
        this.characterStates = characterStates;
        // Emit state update immediately for this character
        this.emitSceneEvent('stateUpdated', { characterStates }, sceneId);
      }
      const characterSnapshot = characterStates[charName] || {};
      emitLifecycle('characterRunCompleted', {
        character: charName,
        responsePreview: content?.substring(0, 120) || '',
        state: {
          hasActedThisRound: characterSnapshot.hasActedThisRound,
          enteredThisRound: characterSnapshot.enteredThisRound,
          exitedThisRound: characterSnapshot.exitedThisRound,
          intentions: characterSnapshot.intentions
        }
      });
      audit('characterRunCompleted', {
        character: charName,
        responseCaptured: !!content,
        hasActedThisRound: characterSnapshot.hasActedThisRound,
        enteredThisRound: characterSnapshot.enteredThisRound,
        exitedThisRound: characterSnapshot.exitedThisRound
      });
      const response = { sender: charName, content };
      responses.push(response);
      turnResponses.push({ character: charName, response: content }); // Add to turn responses for subsequent characters
      this.history.push(`${charName}: ${content}`);
      // Task 4.4: Track character participation in current round
      this.addActiveCharacter(charName);
      // Emit response immediately if callback provided
      if (onCharacterResponse) {
        onCharacterResponse(response);
      }
    }

    roundTimeline.characterResponses = responses;

    // Final save and emit (in case any updates weren't already saved per-character)
    if (Object.keys(characterStates).length > 0) {
      SceneService.update(sceneId!, { characterStates });
      this.characterStates = characterStates; // Update instance
      // Emit final character states update as safety measure
      this.emitSceneEvent('stateUpdated', { characterStates: this.characterStates }, sceneId);
    }

    // Director reconciliation pass (post-character) runs only after characters have acted/responded
    const anyCharacterActed = Object.values(characterStates || {}).some((state: any) => !!state?.hasActedThisRound);
    const anyResponses = (responses?.length || 0) > 0;
    if (directorAgentEnabled && sceneId && (anyCharacterActed || anyResponses)) {
      const actedThisRound = Object.entries(characterStates)
        .filter(([, state]) => (state as any)?.hasActedThisRound)
        .map(([name]) => name);

      const reconciliationEnvelope = buildReconciliationEnvelope(context.contextEnvelope, turnResponses, actedThisRound);

      const reconciliationContext: AgentContext = {
        ...context,
        history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history,
        contextEnvelope: reconciliationEnvelope,
        characterStates,
        activeCharacters: sessionContext.activeCharacters || [],
        userInput
      };

      audit('directorPassStarted', { pass: 2 });
      emitLifecycle('directorPassStarted', { pass: 2 });
      orchestratorLog('Calling DirectorAgent (reconciliation pass)');
      this.emitAgentStatus('Director', 'start', sceneId);
      let directorReconOutput: string = '{}';
      try {
        directorReconOutput = await directorAgent.run(reconciliationContext);
        orchestratorLog('DirectorAgent reconciliation completed, output length:', directorReconOutput.length);
        orchestratorLog('DirectorAgent reconciliation raw output preview:', directorReconOutput.substring(0, 200) + (directorReconOutput.length > 200 ? '...' : ''));
      } catch (error) {
        orchestratorLog('[DIRECTOR] Agent call failed (pass 2 reconciliation):', error);
        directorReconOutput = '{}';
      }
      this.emitAgentStatus('Director', 'complete', sceneId);

      let directorReconParsed: any = null;
      let directorReconRetries = 0;
      let directorReconLastError: any = null;
      while (directorReconRetries < 3) {
        let cleanedOutput = directorReconOutput.trim();
        if (cleanedOutput.startsWith('```json') && cleanedOutput.endsWith('```')) {
          cleanedOutput = cleanedOutput.slice(7, -3).trim();
        }
        try {
          directorReconParsed = JSON.parse(cleanedOutput);
          break;
        } catch (e) {
          directorReconLastError = e;
          const repaired = tryJsonRepair(cleanedOutput);
          if (repaired) {
            try {
              directorReconParsed = JSON.parse(repaired);
              break;
            } catch (e2) {
              directorReconLastError = e2;
            }
          }
          const jsonMatch = cleanedOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              directorReconParsed = JSON.parse(jsonMatch[0]);
              break;
            } catch (innerE) {
              directorReconLastError = innerE;
            }
          }
        }
        directorReconRetries++;
      }

      let directorReconPlan = directorReconParsed ? normalizeDirectorPlan(directorReconParsed) : normalizeDirectorPlan({ openGuidance: directorReconOutput });
      orchestratorLog('[DIRECTOR PASS2] mentions -> acting:%s activations:%s deactivations:%s remaining:%s newActivations:%s',
        JSON.stringify((directorReconPlan.actingCharacters || []).map((a: any) => a.name || a.id)),
        JSON.stringify(directorReconPlan.activations || []),
        JSON.stringify(directorReconPlan.deactivations || []),
        JSON.stringify(directorReconPlan.remainingActors || []),
        JSON.stringify(directorReconPlan.newActivations || []));
      if (!directorReconParsed) {
        orchestratorLog('DirectorAgent reconciliation failed to parse/repair JSON after', directorReconRetries, 'attempts:', directorReconLastError);
        const guidanceMatch = directorReconOutput.match(/Guidance:\s*(.+?)(?:\n|$)/i);
        const charactersMatch = directorReconOutput.match(/Characters:\s*(.+?)(?:\n|$)/i);
        if (guidanceMatch) {
          directorReconPlan = { ...directorReconPlan, openGuidance: guidanceMatch[1].trim() };
        }
        if (charactersMatch) {
          const charsStr = charactersMatch[1].trim();
          if (charsStr.toLowerCase() !== 'none') {
            directorReconPlan.actingCharacters = charsStr.split(',').map((name: string) => ({ name: name.trim() })).filter((c: any) => c.name);
          }
        }
      }

      const directorReconApplication = applyDirectorPlan(directorReconPlan, sessionContext, characterStates);
      characterStates = directorReconApplication.updatedStates;

      emitLifecycle('directorPassCompleted', {
        pass: 2,
        orderedActors: directorReconApplication.orderedActors,
        activations: directorReconApplication.activations,
        deactivations: directorReconApplication.deactivations
      });
      audit('directorPassCompleted', {
        pass: 2,
        orderedActors: directorReconApplication.orderedActors,
        activations: directorReconApplication.activations,
        deactivations: directorReconApplication.deactivations,
        parsed: !!directorReconParsed,
        retries: directorReconRetries,
        lastError: directorReconLastError?.message
      });

      roundTimeline.directorPass2 = {
        rawOutput: directorReconOutput,
        plan: directorReconPlan,
        orderedActors: directorReconApplication.orderedActors,
        activations: directorReconApplication.activations,
        deactivations: directorReconApplication.deactivations,
        remainingActors: directorReconPlan.remainingActors,
        newActivations: directorReconPlan.newActivations,
        stateUpdates: directorReconApplication.appliedStateUpdates
      };

      const reconActiveIds = directorReconApplication.activeCharacterIds;
      if (sceneId && reconActiveIds.length > 0) {
        SceneService.update(sceneId, { activeCharacters: reconActiveIds, characterStates });
        const rehydrated = this.rehydrateActiveCharacters(reconActiveIds, sessionContext.world.id, sessionContext.campaign.id);
        if (rehydrated.length > 0) {
          sessionContext.activeCharacters = rehydrated;
        }
        this.emitSceneEvent('activeCharactersUpdated', { sceneId, activeCharacters: sessionContext.activeCharacters }, sceneId);
      }
      this.characterStates = characterStates;
      this.emitSceneEvent('stateUpdated', { characterStates: this.characterStates }, sceneId);

      const actedSet = new Set((actedThisRound || []).map((n) => n.toLowerCase()));
      const filteredRemaining = (directorReconPlan.remainingActors || []).filter((n: string) => !actedSet.has(String(n).toLowerCase()));
      const filteredResponses = (directorReconApplication.charactersToRespond || []).filter((n: string) => !actedSet.has(String(n).toLowerCase()));

      const nextActors = filteredRemaining.length > 0 ? filteredRemaining : filteredResponses;

      if (nextActors.length > 0) {
        const followupAllowed = maxDirectorPasses > 2;
        if (followupAllowed) {
          this.pendingCharacterPass = nextActors;
          roundTimeline.followupCharacterPass = { queued: true, actors: nextActors };
          orchestratorLog('[DIRECTOR] Queued follow-up character pass for remaining actors (maxDirectorPasses=%d): %s', maxDirectorPasses, JSON.stringify(nextActors));
          this.emitSceneEvent('remainingActorsQueued', { actors: nextActors }, sceneId);
        } else {
          roundTimeline.followupCharacterPass = { queued: false, actors: nextActors, reason: 'guardrail' };
          orchestratorLog('[DIRECTOR] Remaining actors requested but guardrail reached (maxDirectorPasses=%d): %s', maxDirectorPasses, JSON.stringify(nextActors));
        }
      }
    }

    roundTimeline.roundMetadata = {
      sceneId,
      roundNumber: this.currentRoundNumber,
      summary: this.sceneSummary,
      directorGuidance: directorPlan?.openGuidance,
      actingCharacters: directorApplication?.orderedActors || [],
      activations: directorApplication?.activations || [],
      deactivations: directorApplication?.deactivations || [],
      reconciliation: roundTimeline.directorPass2
        ? {
            orderedActors: roundTimeline.directorPass2.orderedActors,
            activations: roundTimeline.directorPass2.activations,
            deactivations: roundTimeline.directorPass2.deactivations,
            remainingActors: roundTimeline.directorPass2.remainingActors,
            newActivations: roundTimeline.directorPass2.newActivations
          }
        : undefined
    };
    audit('roundMetadataRecorded', roundTimeline.roundMetadata);

    if (sceneId) {
      if (pendingWorldStateUpdate) {
        SceneService.update(sceneId, {
          worldState: this.worldState,
          characterStates,
          lastWorldStateMessageNumber: pendingWorldStateUpdate.lastWorldStateMessageNumber || undefined
        });
      }

      if (pendingTrackersUpdate) {
        this.db.prepare('UPDATE CampaignState SET trackers = ?, updatedAt = CURRENT_TIMESTAMP WHERE campaignId = ?')
          .run(JSON.stringify(this.trackers), pendingTrackersUpdate.campaignId);
      }

      SceneService.updateRoundTimeline(sceneId, this.currentRoundNumber, roundTimeline);
    }

    return { responses, lore: sessionContext.lore };
  }

  private async handleSlashCommand(command: string, args: string[], activeCharacters?: string[], sceneId?: number, personaName: string = 'default'): Promise<{ responses: { sender: string; content: string }[]; lore: string[]; }> {
    switch (command) {
      case 'create':
        const creatorAgent = this.agents.get('creator')!;
        const context: AgentContext = {
          userInput: args.join(' '),
          history: this.history,
          worldState: this.worldState,
          userPersona: this.getPersona(personaName),
          creationRequest: args.join(' '),
        };
        orchestratorLog('Calling CreatorAgent');
        this.emitAgentStatus('Creator', 'start', sceneId);
        let creatorResult: string = '';
        try {
          creatorResult = await creatorAgent.run(context);
          orchestratorLog('CreatorAgent completed');
        } catch (error) {
          orchestratorLog('[CREATOR] Agent call failed:', error);
          creatorResult = 'Creation failed. Please try again with a different description.';
        }
        this.emitAgentStatus('Creator', 'complete', sceneId);
        return { responses: [{ sender: 'Creator', content: creatorResult }], lore: [] };
      case 'image':
        if (!this.configManager.isVisualAgentEnabled()) {
          return { responses: [{ sender: 'System', content: 'Visual agent is disabled in configuration.' }], lore: [] };
        }
        
        // Parse character names from the input (e.g., "/image Annie and Hex embracing")
        const imagePrompt = args.join(' ');
        orchestratorLog(`[/image] Starting image command with prompt: "${imagePrompt}", sceneId: ${sceneId}`);
        
        // Load session context to get world/campaign info
        const imageSessionContext = sceneId ? await this.buildSessionContext(sceneId) : null;
        orchestratorLog(`[/image] Session context loaded: ${imageSessionContext ? 'yes' : 'no'}`);
        
        // Search for ONLY entities explicitly mentioned in the prompt
        const matchedEntities = this.searchForEntities(
          imagePrompt,
          imageSessionContext?.world.id,
          imageSessionContext?.campaign.id
        );
        orchestratorLog(`[/image] Matched ${matchedEntities.length} entities: [${matchedEntities.map((e: any) => e.name).join(', ')}]`);
        
        // If no entities found, pass the raw prompt directly to VisualAgent
        // to generate an SD prompt, then generate the image.
        if (matchedEntities.length === 0) {
          orchestratorLog(`[/image] No characters or personas found; generating image from raw prompt`);
          const visualAgent = this.agents.get('visual')! as any;
          try {
            this.emitAgentStatus('Visual', 'start', sceneId);
            
            // Pass raw prompt to VisualAgent to generate SD prompt
            const visualContext: AgentContext = {
              userInput: imagePrompt,
              imagePrompt: imagePrompt,
              userPersona: this.getPersona(personaName),
            } as any;
            
            // Get SD prompt from VisualAgent
            const sdPrompt = await visualAgent.run(visualContext);
            orchestratorLog(`[/image] Generated SD prompt: ${String(sdPrompt).substring(0, 150)}...`);
            
            // Generate actual image from SD prompt
            const imageUrl = await visualAgent.generateImage(sdPrompt);
            orchestratorLog(`[/image] Image generated: ${imageUrl}`);
            
            this.emitAgentStatus('Visual', 'complete', sceneId);
            
            // Return markdown image tag
            const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
            const md = `![${JSON.stringify(meta)}](${imageUrl})`;
            return { responses: [{ sender: 'Visual', content: md }], lore: imageSessionContext?.lore || [] };
          } catch (err) {
            orchestratorLog('[/image] Image generation failed for open prompt', err);
            this.emitAgentStatus('Visual', 'complete', sceneId);
            return { responses: [{ sender: 'System', content: 'Image generation failed.' }], lore: [] };
          }
        }
        
        // Use the dedicated visual-image template with matched entities
        const visualAgent = this.agents.get('visual')!;
        const visualContext: AgentContext = {
          userInput: imagePrompt,
          imagePrompt: imagePrompt,  // Keep original prompt for template
          matchedEntities: matchedEntities,  // Pass only matched entities to template
          history: this.history,
          worldState: this.worldState,
          userPersona: this.getPersona(personaName),
          activeCharacters: matchedEntities,  // Also keep for compatibility
          narration: '', // Not used for /image
          sceneElements: [],
        } as any;
        
        orchestratorLog(`[/image] Calling VisualAgent with ${matchedEntities.length} matched entities`);
        this.emitAgentStatus('Visual', 'start', sceneId);
        let visualResult: string = '';
        let visualParsed: any = null;
        let visualRetries = 0;
        let visualLastError: any = null;
        while (visualRetries < 3) {
          let visualResponse: string = '';
          try {
            visualResponse = await visualAgent.run(visualContext);
          } catch (error) {
            orchestratorLog('[VISUAL] Agent call failed (attempt ${visualRetries + 1}):', error);
            visualLastError = error;
            visualRetries++;
            continue;
          }

          // If VisualAgent returned a markdown image tag like: ![{...}](url)
          // treat it as a valid response: extract inner JSON if present
          // and set `visualParsed.content` so the orchestrator can return it.
          try {
            const mdMatch = String(visualResponse).match(/!\[([\s\S]*?)\]\((.*?)\)/);
            if (mdMatch) {
              const inner = mdMatch[1];
              try {
                const parsedInner = JSON.parse(inner);
                visualParsed = parsedInner;
                if (!visualParsed.content) visualParsed.content = String(visualResponse);
              } catch (e) {
                // Not JSON inside brackets — return the raw markdown as content
                visualParsed = { content: String(visualResponse) } as any;
              }
              break;
            }
          } catch (e) {
            // ignore and continue to existing JSON-parsing logic
            visualLastError = e;
          }
          try {
            visualParsed = JSON.parse(visualResponse);
            break;
          } catch (e) {
            visualLastError = e;
            const repaired = tryJsonRepair(visualResponse);
            if (repaired) {
              try {
                visualParsed = JSON.parse(repaired);
                break;
              } catch (e2) {
                visualLastError = e2;
              }
            }
            const jsonMatch = visualResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                visualParsed = JSON.parse(jsonMatch[0]);
                break;
              } catch (innerE) {
                visualLastError = innerE;
              }
            }
          }
          visualRetries++;
        }
        if (visualParsed && visualParsed.content) {
          visualResult = visualParsed.content;
        } else if (visualParsed && typeof visualParsed === 'string') {
          visualResult = visualParsed;
        } else {
          visualResult = '';
          orchestratorLog('VisualAgent failed to parse/repair JSON after', visualRetries, 'attempts:', visualLastError);
        }
        orchestratorLog('[/image] VisualAgent completed');
        this.emitAgentStatus('Visual', 'complete', sceneId);
        return { responses: [{ sender: 'Visual', content: visualResult }], lore: imageSessionContext?.lore || [] };
      case 'scenepicture':
        if (!this.configManager.isVisualAgentEnabled()) {
          return { responses: [{ sender: 'System', content: 'Visual agent is disabled in configuration.' }], lore: [] };
        }
        
        // Load full session context for scene details
        const sessionContext = sceneId ? await this.buildSessionContext(sceneId) : null;
        
        // Resolve active characters with full merged data and character states
        const resolvedCharsWithState: any[] = [];
        if (sessionContext?.activeCharacters && Array.isArray(sessionContext.activeCharacters)) {
          resolvedCharsWithState.push(...sessionContext.activeCharacters);
        }

        // Build a context for the narrator using current orchestrator state and active character summaries
        const narratorAgent = this.agents.get('narrator')!;
        
        // Extract user persona state from characterStates if available
        const userPersonaState = sessionContext?.scene.characterStates?.['user'] || 
                                 sessionContext?.scene.characterStates?.['default'] || {};
        
        const narrContext: AgentContext = {
          userInput: 'Describe the scene',
          history: this.history,
          worldState: this.worldState,
          sceneSummary: this.sceneSummary,
          lore: this.getActivatedLore(this.history.join(' ')),
          formattedLore: sessionContext?.formattedLore || '',
          userPersona: this.getPersona(personaName),
          userPersonaState: userPersonaState,
          activeCharacters: resolvedCharsWithState,
          narrationMode: 'scene-picture',
          // Additional scene context
          location: sessionContext?.scene.location,
          timeOfDay: sessionContext?.scene.timeOfDay,
          sceneDescription: sessionContext?.scene.description,
        } as any;
        orchestratorLog('Calling NarratorAgent for /scenepicture with scene-picture mode');
        this.emitAgentStatus('Narrator', 'start', sceneId);
        let narration: string = '';
        try {
          narration = await narratorAgent.run(narrContext);
          orchestratorLog('NarratorAgent completed for /scenepicture');
        } catch (error) {
          orchestratorLog('[NARRATOR] Agent call failed in /scenepicture:', error);
          narration = 'The scene description could not be generated at this time.';
        }
        this.emitAgentStatus('Narrator', 'complete', sceneId);

        // Generate SD prompt for scene picture visualization
        const visAgent = this.agents.get('visual')! as any;
        try {
          this.emitAgentStatus('Visual', 'start', sceneId);
          
          // Create context for visual agent to generate SD prompt
          const visualContext: AgentContext = {
            userInput: 'Generate SD prompt for this scene',
            history: this.history,
            worldState: this.worldState,
            userPersona: this.getPersona(personaName),
            userPersonaState: userPersonaState,
            activeCharacters: resolvedCharsWithState,
            sceneDescription: narration,
            location: sessionContext?.scene.location,
            timeOfDay: sessionContext?.scene.timeOfDay,
            narrationMode: 'scene-picture',
          } as any;
          
          // Call visual agent to generate SD prompt
          let sdPrompt: string = '';
          let imageUrl: string = '';
          try {
            sdPrompt = await visAgent.run(visualContext);
            
            // Generate image from the SD prompt
            imageUrl = await visAgent.generateImage(sdPrompt);
          } catch (error) {
            orchestratorLog('[VISUAL] Agent call failed in /scenepicture:', error);
            throw error; // Re-throw to be caught by outer try-catch
          }
          this.emitAgentStatus('Visual', 'complete', sceneId);
          const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
          const md = `![${JSON.stringify(meta)}](${imageUrl})`;
          return { responses: [{ sender: 'Visual', content: md }], lore: [] };
        } catch (err) {
          orchestratorLog('scenepicture generation failed', err);
          return { responses: [{ sender: 'System', content: 'Scene picture generation failed.' }], lore: [] };
        }
      default:
        return { responses: [{ sender: 'System', content: `Unknown command: /${command}` }], lore: [] };
    }
  }

  // Persistence methods
  saveState(sessionId: string) {
    const state = {
      worldState: this.worldState,
      history: this.history,
      sceneSummary: this.sceneSummary,
    };
    fs.writeFileSync(`session_${sessionId}.json`, JSON.stringify(state, null, 2));
  }

  loadState(sessionId: string) {
    try {
      const data = fs.readFileSync(`session_${sessionId}.json`, 'utf-8');
      const state = JSON.parse(data);
      this.worldState = state.worldState || {};
      this.history = state.history || [];
      this.sceneSummary = state.sceneSummary || '';
    } catch (e) {
      // New session
    }
  }

  clearHistory() {
    this.history = [];
    this.worldState = {};
    this.trackers = { stats: {}, objectives: [], relationships: {} };
    this.characterStates = {};
    this.sceneSummary = '';
  }

  async createCharacter(context: AgentContext): Promise<string> {
    const creatorAgent = this.agents.get('creator')!;
    try {
      return await creatorAgent.run(context);
    } catch (error) {
      orchestratorLog('[CREATOR] Agent call failed in createCharacter:', error);
      throw new Error(`Character creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
