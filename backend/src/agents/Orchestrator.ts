import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ConfigManager } from '../configManager.js';
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';

import { NarratorAgent } from './NarratorAgent.js';
import { CharacterAgent } from './CharacterAgent.js';
import { DirectorAgent } from './DirectorAgent.js';
import { WorldAgent } from './WorldAgent.js';
import { SummarizeAgent } from './SummarizeAgent.js';
import { VisualAgent } from './VisualAgent.js';
import { CreatorAgent } from './CreatorAgent.js';
import { VectorizationAgent } from './VectorizationAgent.js';
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

  private emitAgentStatus(agentName: string, status: 'start' | 'complete', sceneId?: number) {
    if (this.io && sceneId) {
      this.io.to(`scene-${sceneId}`).emit('agentStatus', { agent: agentName, status });
    }
  }

  // Task 4.1: Initialize round state from database
  async initializeRoundState(sceneId: number): Promise<void> {
    const scene = this.db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneId) as any;
    this.currentRoundNumber = scene?.currentRoundNumber || 1;
    this.roundActiveCharacters = [];
    console.log(`[ORCHESTRATOR] Round initialized: scene=${sceneId}, roundNumber=${this.currentRoundNumber}`);
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

  // Task 4.2: Complete the current round
  // Completes previous round, advances round number, creates new round record
  async completeRound(sceneId: number, activeCharacters?: string[]): Promise<number> {
    try {
      const charsToPass = activeCharacters || this.roundActiveCharacters;
      
      // 1. Persist round metadata to database (completes previous, advances number, creates new)
      const nextRoundNumber = SceneService.completeRound(sceneId, charsToPass);
      console.log(`[ORCHESTRATOR] Round completed. Previous: ${this.currentRoundNumber}, Next: ${nextRoundNumber}`);

      // Task 4.4: Emit Socket.io event for roundCompleted
      if (this.io) {
        this.io.to(`scene-${sceneId}`).emit('roundCompleted', {
          sceneId,
          roundNumber: this.currentRoundNumber,
          nextRoundNumber: nextRoundNumber,
          activeCharacters: charsToPass,
          timestamp: new Date().toISOString()
        });
      }

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
            console.warn(`[ORCHESTRATOR] VectorizationAgent failed for round ${this.currentRoundNumber}:`, err);
          });
        }
      }

      // 4. Increment round for next cycle in Orchestrator state (database already done)
      this.currentRoundNumber++;
      this.roundActiveCharacters = [];
      
      return nextRoundNumber;
    } catch (error) {
      console.error(`[ORCHESTRATOR] Failed to complete round ${this.currentRoundNumber}:`, error);
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
      console.log(`[ORCHESTRATOR] Continuing round ${currentRoundNumber} for scene ${sceneId}`);
      
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
      console.log(`[ORCHESTRATOR] Active character UUIDs for round ${currentRoundNumber}: ${JSON.stringify(activeCharacterUUIDs)}`);

      // REUSE THE EXACT SAME processUserInput PATH
      // This ensures all agent status messages, parsing, world updates, and frontend notifications happen
      await this.processUserInput(
        syntheticUserInput,
        'system', // Use 'system' as persona
        activeCharacterUUIDs, // Pass active character UUIDs
        sceneId, // Pass scene ID for round tracking
        (response: { sender: string; content: string }) => {
          console.log(`[CONTINUE_ROUND] Callback received response from ${response.sender}`);
          // Log character response with current round number
          MessageService.logMessage(sceneId, response.sender, response.content, {}, 'continue-round', this.currentRoundNumber);
          this.addActiveCharacter(response.sender);
          
          // Emit to frontend immediately
          if (this.io) {
            console.log(`[CONTINUE_ROUND] Emitting characterResponse for ${response.sender} to scene-${sceneId}`);
            this.io.to(`scene-${sceneId}`).emit('characterResponse', response);
          } else {
            console.warn(`[CONTINUE_ROUND] No Socket.io instance available to emit`);
          }
        }
      );

      // Complete the round
      await this.completeRound(sceneId, activeCharacterUUIDs);
    } catch (error) {
      console.error(`[ORCHESTRATOR] Failed to continue round:`, error);
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
          state.clothingWorn = match[1].trim();
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
      console.error('Failed to reload agent', agentName, e);
      return false;
    }
  }

  // Get an agent instance
  public getAgent(agentName: string): BaseAgent | undefined {
    return this.agents.get(agentName);
  }

  // Build a rich SessionContext for a given sceneId
  async buildSessionContext(sceneId: number) {
    console.log(`\n========== [LORE ENGINE] Building SessionContext for Scene ${sceneId} ==========`);
    const sceneRow = this.db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!sceneRow) return null;

    const arcRow = this.db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any;
    const campaignRow = this.db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
    const worldRow = this.db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;

    // Get active lorebooks for world and campaign
    console.log(`[LORE] Building session context for scene ${sceneId}`);
    console.log(`[LORE] World: ${worldRow.name} (${worldRow.id}), Campaign: ${campaignRow.name} (${campaignRow.id})`);
    
    const activeLorebooks = LorebookService.getActiveLorebooks(worldRow.id, campaignRow.id);
    console.log(`[LORE] Active lorebooks count: ${activeLorebooks.length}`);
    activeLorebooks.forEach((lb: any) => {
      console.log(`[LORE]   - Lorebook: "${lb.name}" (uuid: ${lb.uuid}, entries: ${(lb.entries || []).length})`);
    });
    
    const allEntries: any[] = [];
    for (const lb of activeLorebooks) {
      allEntries.push(...(lb.entries || []));
    }
    console.log(`[LORE] Total entries available: ${allEntries.length}`);

    // Get lore context for matching
    const loreContext = SceneService.getLoreContext(sceneId, 4); // scanDepth 4
    console.log(`[LORE] Lore context keys: ${loreContext ? Object.keys(loreContext).join(', ') : 'none'}`);
    
    let matchedLore: string[] = [];
    let formattedLore = '';
    if (loreContext && allEntries.length > 0) {
      console.log(`[LORE] Matching entries against context...`);
      const result = matchLoreEntries(allEntries, loreContext, 4, 2048); // tokenBudget 2048
      console.log(`[LORE] Match results: ${result.selectedEntries.length} selected out of ${allEntries.length} available entries`);
      result.selectedEntries.forEach((entry: any, idx: number) => {
        console.log(`[LORE]   SELECTED ${idx + 1}: "${entry.key}" (position: ${entry.insertion_position})`);
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
      console.log(`[LORE] Formatted lore sections: ${Object.keys(groupedByPosition).join(', ')}`);
      console.log(`[LORE] Total formatted lore length: ${formattedLore.length} chars`);
    } else {
      console.log(`[LORE] No lore context or entries found. loreContext: ${!!loreContext}, entries: ${allEntries.length}`);
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

    // Parse active characters UUIDs
    const activeCharacters = sceneRow.activeCharacters ? JSON.parse(sceneRow.activeCharacters) : [];
    console.log(`[ORCHESTRATOR] Scene ${sceneId}: activeCharacters in DB = ${JSON.stringify(activeCharacters)}`);

    // Resolve merged character objects where possible
    const activeCharactersResolved: any[] = [];
    const characterStates = sceneRow.characterStates ? JSON.parse(sceneRow.characterStates) : {};
    for (const item of activeCharacters) {
      const merged = CharacterService.getMergedCharacter({ characterId: item, worldId: worldRow.id, campaignId: campaignRow.id });
      if (merged) {
        console.log(`[ORCHESTRATOR] Found merged character for ${item}: ${merged.name}`);
        // Apply current character state if available
        const currentState = characterStates[merged.id] || characterStates[merged.name];
        if (currentState) {
          Object.assign(merged, currentState);
        }
        activeCharactersResolved.push(merged);
      } else {
        console.log(`[ORCHESTRATOR] No merged character found for ${item}`);
      }
    }
    console.log(`[ORCHESTRATOR] Scene ${sceneId}: resolved ${activeCharactersResolved.length} characters`);

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
      trackers: campaignState.trackers || { stats: {}, objectives: [], relationships: {} },
      locationMap: (sceneRow.locationRelationships ? JSON.parse(sceneRow.locationRelationships) : {}),
      lore: matchedLore,
      formattedLore: formattedLore
    };

    // Seed orchestrator worldState from scene-level world state, falling back to campaign dynamic facts
    this.worldState = sessionContext.scene.worldState || sessionContext.worldState.dynamicFacts || {};
    this.trackers = sessionContext.trackers;
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
        console.log(`[searchForEntities] Found ${entity.type}: ${entity.name}`);
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

    // Load scene summary from database if sceneId is provided
    if (sceneId && !this.sceneSummary) {
      const sceneRow = this.db.prepare('SELECT summary FROM Scenes WHERE id = ?').get(sceneId) as any;
      if (sceneRow?.summary) {
        this.sceneSummary = sceneRow.summary;
      }
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
            minSimilarity: 0.3,
            includeMultiCharacter: true,
          } as any);
          if (memories.length > 0) {
            // Provide raw memories for template rendering and keep formatted string for compatibility
            context.vectorMemoriesRaw = memories;
            context.vectorMemories = retriever.formatMemoriesForPrompt(memories);
            console.log(`[NARRATOR] Injected ${memories.length} memories into context`);
          }
        } catch (error) {
          console.warn('[NARRATOR] Memory retrieval failed (non-blocking):', error);
        }
      }

      // Call only NarratorAgent for scene description
      const narratorAgent = this.agents.get('narrator')!;
      console.log('Calling NarratorAgent');
      this.emitAgentStatus('Narrator', 'start', sceneId);
      const narration = await narratorAgent.run(context);
      console.log('NarratorAgent completed');
      this.emitAgentStatus('Narrator', 'complete', sceneId);
      this.history.push(`Narrator: ${narration}`);
      return { responses: [{ sender: 'Narrator', content: narration }], lore: [] };
    }

    // Normal interaction flow
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

    // Prepare base context
    let context: AgentContext = {
      userInput,
      history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history,
      worldState: this.worldState,
      lore: this.getActivatedLore(userInput + ' ' + this.history.join(' ')),
      formattedLore: sessionContext.formattedLore,
      userPersona: this.getPersona(personaName),
    };

    // Step 1: Summarize if history too long (simple check: > 10 messages)
    if (this.history.length > 10) {
      const summarizeAgent = this.agents.get('summarize')!;
      console.log('Calling SummarizeAgent');
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
        console.warn('SummarizeAgent failed to parse/repair JSON after', summarizeRetries, 'attempts:', summarizeLastError);
      }
      console.log('SummarizeAgent completed');
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
    const directorContext = { 
      ...context, 
      activeCharacters: activeCharacters || [],
      activeCharacterNames: activeCharacterNamesStr,
      history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history
    };
    console.log('Calling DirectorAgent');
    this.emitAgentStatus('Director', 'start', sceneId);
    const directorOutput = await directorAgent.run(directorContext);
    console.log('DirectorAgent completed, output length:', directorOutput.length);
    console.log('DirectorAgent raw output preview:', directorOutput.substring(0, 200) + (directorOutput.length > 200 ? '...' : ''));
    this.emitAgentStatus('Director', 'complete', sceneId);
    // Parse output: JSON {"guidance": "...", "characters": [...]}
    let directorGuidance = '';
    let charactersToRespond: string[] = [];
    let directorParsed: any = null;
    let directorRetries = 0;
    let directorLastError: any = null;
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
        // Try jsonrepair
        const repaired = tryJsonRepair(cleanedOutput);
        if (repaired) {
          try {
            directorParsed = JSON.parse(repaired);
            break;
          } catch (e2) {
            directorLastError = e2;
          }
        }
        // Try to extract JSON object from within the string
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
    if (directorParsed) {
      // Check if we got a valid response object/array
      if (Array.isArray(directorParsed)) {
        if (directorParsed.length > 0 && typeof directorParsed[0] === 'object' && directorParsed[0] !== null) {
          directorParsed = directorParsed[0];
        } else {
          directorParsed = {};
        }
      }
      directorGuidance = directorParsed.guidance || '';
      charactersToRespond = Array.isArray(directorParsed.characters) ? directorParsed.characters : [];
    } else {
      console.warn('DirectorAgent failed to parse/repair JSON after', directorRetries, 'attempts:', directorLastError);
      // Fallback: try old format
      const guidanceMatch = directorOutput.match(/Guidance:\s*(.+?)(?:\n|$)/i);
      const charactersMatch = directorOutput.match(/Characters:\s*(.+?)(?:\n|$)/i);
      if (guidanceMatch) {
        directorGuidance = guidanceMatch[1].trim();
      }
      if (charactersMatch) {
        const charsStr = charactersMatch[1].trim();
        if (charsStr.toLowerCase() !== 'none') {
          charactersToRespond = charsStr.split(',').map(c => c.trim()).filter(c => c);
        }
      }
    }
    console.log('Active characters passed to Director:', activeCharacters);
    console.log('Director selected characters:', charactersToRespond);
    // Fallback if parsing fails
    if (!directorGuidance && !charactersToRespond.length) {
      console.warn('Failed to parse DirectorAgent output properly:', directorOutput);
      directorGuidance = directorOutput; // Use as guidance
      // Default to first active character if available, otherwise skip character responses
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
    const characterStates = { ...sessionContext.scene.characterStates };
    const userPersonaName = personaName || 'user';
    if (!characterStates[userPersonaName]) {
      const userPersona = context.userPersona;
      characterStates[userPersonaName] = {
        clothingWorn: userPersona.currentOutfit || userPersona.appearance?.aesthetic || 'casual attire',
        mood: userPersona.personality?.split(',')[0]?.trim() || 'neutral',
        activity: userPersona.occupation || 'interacting',
        location: sessionContext.scene.location || 'unknown',
        position: 'standing'
      };
    }
    for (const char of sessionContext.activeCharacters) {
      if (!characterStates[char.name]) {
        const extractedState = this.extractStateFromDescription(char);
        characterStates[char.name] = {
          clothingWorn: extractedState.clothingWorn || char.currentOutfit || char.appearance?.aesthetic || 'casual attire',
          mood: extractedState.mood || char.personality?.split(',')[0]?.trim() || 'neutral',
          activity: extractedState.activity || char.occupation || 'present',
          location: sessionContext.scene.location || 'unknown',
          position: 'standing'
        };
        console.log(`Initialized character state for ${char.name}:`, characterStates[char.name]);
      }
    }
    console.log('Character states after initialization:', Object.keys(characterStates));
    
    // Parse user actions for outfit updates
    if (userInput.includes('takes off his shirt') || userInput.includes('takes his shirt off')) {
      if (characterStates['Hex']) {
        characterStates['Hex'].clothingWorn = 'pants, shoes, socks';
      }
    }
    if (userInput.includes('takes off his pants') || userInput.includes('takes his pants off') || userInput.includes('leaving him in his underwear')) {
      if (characterStates['Hex']) {
        characterStates['Hex'].clothingWorn = 'underwear, shoes, socks';
      }
    }
    
    // Step 3: World state update
    const worldAgent = this.agents.get('world')!;
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
    
    console.log('Calling WorldAgent');
    this.emitAgentStatus('WorldAgent', 'start', sceneId);
    const worldUpdateStr = await worldAgent.run(worldContext);
    console.log('WorldAgent completed');
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
            console.log('[WORLD] Updating user persona state from worldState:', worldParsed.worldState.userPersonaState);
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
            console.log('[WORLD] User persona state after update:', characterStates[userPersonaKey]);
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
      console.warn('WorldAgent failed to parse/repair JSON after', worldRetries, 'attempts:', worldLastError);
    }
    
    // Save updated world state to scene if it changed
    if (worldStateChanged) {
      const currentMaxMessageNumber = this.db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId!) as any;
      const newLastMessageNumber = currentMaxMessageNumber?.maxNum || 0;
      SceneService.update(sceneId!, {
        worldState: this.worldState,
        characterStates: characterStates,
        lastWorldStateMessageNumber: newLastMessageNumber
      });
    }
    
    // Save updated trackers to campaign if they changed
    if (trackersChanged) {
      this.db.prepare('UPDATE CampaignState SET trackers = ?, updatedAt = CURRENT_TIMESTAMP WHERE campaignId = ?').run(JSON.stringify(this.trackers), sessionContext.campaign.id);
    }
    
    // Emit updated state to frontend
    this.io?.to(`scene-${sceneId}`).emit('stateUpdated', { state: this.worldState, trackers: this.trackers, characterStates: characterStates });
    
    context.worldState = this.worldState;

    // Track responses from this turn to pass to subsequent characters
    const turnResponses: { character: string; response: string }[] = [];

    for (const charName of charactersToRespond) {
      console.log(`Processing character: ${charName}`);
      
      // Ensure character state exists
      if (!characterStates[charName]) {
        console.log(`Initializing character state for ${charName}`);
        characterStates[charName] = {
          clothingWorn: 'default',
          mood: 'neutral',
          activity: 'responding',
          location: sessionContext?.scene?.location || 'unknown',
          position: 'standing'
        };
      }
      
      const characterData = sessionContext.activeCharacters.find(c => c.name.toLowerCase() === charName.toLowerCase());
      if (!characterData) {
        console.warn(`Character ${charName} not found in active characters`);
        continue;
      }

      const characterAgent = new CharacterAgent(charName, this.configManager, this.env);
      
      // Build history with all messages from this round (user message + any previous character responses)
      let historyToPass = this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.join('\n')}`] : this.history;
      if (turnResponses.length > 0) {
        const previousResponses = '\n\n[Other Characters in this turn:]\n' + turnResponses.map(r => `${r.character}: ${r.response}`).join('\n');
        if (Array.isArray(historyToPass)) {
          historyToPass = [...historyToPass, previousResponses];
        } else {
          historyToPass = [historyToPass, previousResponses];
        }
      }
      
      const characterContext: AgentContext = {
        ...context,
        history: historyToPass,
        character: characterData,
        characterState: characterStates[charName],
        maxCompletionTokens: (characterAgent as any).getProfile().sampler?.max_completion_tokens || 400,
      };

      // Query memories for character (Phase 3)
      if (sceneId && characterData?.id) {
        try {
          const worldId = SceneService.getWorldIdFromSceneId(sceneId);
          console.log(`[CHARACTER_MEMORY] Querying memories for ${charName} (id: ${characterData.id}) in world ${worldId}, scene ${sceneId}`);
          const retriever = getMemoryRetriever();
          await retriever.initialize();
          const query = userInput + ' ' + this.history.join(' ').substring(0, 500);
          console.log(`[CHARACTER_MEMORY] Query text length: ${query.length}`);
          const scope = `world_${worldId}_char_${characterData.id}`;
          const memories = await retriever.retrieve({ scope, query, topK: 5, minSimilarity: 0.3 } as any);
          console.log(`[CHARACTER_MEMORY] Retrieved ${memories.length} memories for ${charName}`);
          if (memories.length > 0) {
            // Inject raw memories into character context; leave formatted for backwards compatibility
            characterContext.vectorMemoriesRaw = memories;
            characterContext.vectorMemories = retriever.formatMemoriesForPrompt(memories);
            console.log(`[CHARACTER] ${charName}: Injected ${memories.length} memories into context`);
          } else {
            console.log(`[CHARACTER_MEMORY] No memories found for ${charName}`);
          }
        } catch (error) {
          console.warn(`[CHARACTER] ${charName}: Memory retrieval failed (non-blocking):`, error);
        }
      } else {
        console.log(`[CHARACTER_MEMORY] Skipping memory query - sceneId: ${sceneId}, worldId: ${this.worldState?.id}, charId: ${characterData?.id}`);
      }

      console.log(`[CHARACTER] Calling CharacterAgent for "${charName}"`);
      console.log(`[CHARACTER] Character profile: name=${characterData?.name}, includes lore: ${!!context.formattedLore}`);
      let characterResponse: string | null = null;
      let characterParsed: any = null;
      let characterRetries = 0;
      let characterLastError: any = null;
      this.emitAgentStatus(charName, 'start', sceneId);
      while (characterRetries < 3) {
        if (characterRetries > 0) {
          console.warn(`[CHARACTER] Retry ${characterRetries} for "${charName}"`);
        }
        // Call LLM
        characterResponse = await characterAgent.run(characterContext);
        console.log(`[CHARACTER] CharacterAgent for "${charName}" completed (attempt ${characterRetries + 1})`);
        console.log(`[CHARACTER] Raw response length: ${characterResponse?.length || 0} chars`);
        console.log(`[CHARACTER] First 200 chars of response: ${characterResponse?.substring(0, 200) || 'EMPTY'}`);
        this.emitAgentStatus(charName, 'complete', sceneId);
        
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
              console.log(`[CHARACTER] Successfully parsed JSON with content on attempt ${characterRetries + 1}`);
              break;
            } else {
              characterLastError = new Error('Parsed JSON missing "response" field or empty content');
              console.log(`[CHARACTER] Direct parse succeeded but missing content: ${characterLastError}`);
            }
          } catch (e) {
            characterLastError = e;
            console.log(`[CHARACTER] Direct parse failed: ${e}`);
            
            // Try jsonrepair
            const repaired = tryJsonRepair(cleanedResponse);
            if (repaired) {
              try {
                characterParsed = JSON.parse(repaired);
                // Validate that repaired JSON has content
                if (characterParsed && characterParsed.response) {
                  console.log(`[CHARACTER] Successfully repaired and parsed JSON with content on attempt ${characterRetries + 1}`);
                  break;
                } else {
                  characterLastError = new Error('Repaired JSON missing "response" field or empty content');
                  console.log(`[CHARACTER] Repaired parse succeeded but missing content: ${characterLastError}`);
                }
              } catch (e2) {
                characterLastError = e2;
                console.log(`[CHARACTER] Repaired parse failed: ${e2}`);
                // If repair failed, loop will retry with fresh LLM call
              }
            } else {
              console.log(`[CHARACTER] jsonrepair returned null, will retry with fresh LLM call`);
            }
          }
        }
        
        characterRetries++;
      }
      
      if (!characterParsed) {
        console.warn(`[CHARACTER] Failed to parse/repair JSON after ${characterRetries} attempts:`, characterLastError);
        // Treat plain text response as the character's speech
        console.log(`[CHARACTER] Treating response as plain text: ${characterResponse?.substring(0, 100)}...`);
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
        characterStates[charName] = newState;
        // Save updated character state to scene immediately
        SceneService.update(sceneId!, { characterStates });
        this.characterStates = characterStates;
        // Emit state update immediately for this character
        this.io?.to(`scene-${sceneId}`).emit('stateUpdated', { characterStates });
      }
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

    // Final save and emit (in case any updates weren't already saved per-character)
    if (Object.keys(characterStates).length > 0) {
      SceneService.update(sceneId!, { characterStates });
      this.characterStates = characterStates; // Update instance
      // Emit final character states update as safety measure
      this.io?.to(`scene-${sceneId}`).emit('stateUpdated', { characterStates: this.characterStates });
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
        console.log('Calling CreatorAgent');
        this.emitAgentStatus('Creator', 'start', sceneId);
        const creatorResult = await creatorAgent.run(context);
        console.log('CreatorAgent completed');
        this.emitAgentStatus('Creator', 'complete', sceneId);
        return { responses: [{ sender: 'Creator', content: creatorResult }], lore: [] };
      case 'image':
        if (!this.configManager.isVisualAgentEnabled()) {
          return { responses: [{ sender: 'System', content: 'Visual agent is disabled in configuration.' }], lore: [] };
        }
        
        // Parse character names from the input (e.g., "/image Annie and Hex embracing")
        const imagePrompt = args.join(' ');
        console.log(`[/image] Starting image command with prompt: "${imagePrompt}", sceneId: ${sceneId}`);
        
        // Load session context to get world/campaign info
        const imageSessionContext = sceneId ? await this.buildSessionContext(sceneId) : null;
        console.log(`[/image] Session context loaded: ${imageSessionContext ? 'yes' : 'no'}`);
        
        // Search for ONLY entities explicitly mentioned in the prompt
        const matchedEntities = this.searchForEntities(
          imagePrompt,
          imageSessionContext?.world.id,
          imageSessionContext?.campaign.id
        );
        console.log(`[/image] Matched ${matchedEntities.length} entities: [${matchedEntities.map((e: any) => e.name).join(', ')}]`);
        
        // If no entities found, pass the raw prompt directly to VisualAgent
        // to generate an SD prompt, then generate the image.
        if (matchedEntities.length === 0) {
          console.log(`[/image] No characters or personas found; generating image from raw prompt`);
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
            console.log(`[/image] Generated SD prompt: ${String(sdPrompt).substring(0, 150)}...`);
            
            // Generate actual image from SD prompt
            const imageUrl = await visualAgent.generateImage(sdPrompt);
            console.log(`[/image] Image generated: ${imageUrl}`);
            
            this.emitAgentStatus('Visual', 'complete', sceneId);
            
            // Return markdown image tag
            const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
            const md = `![${JSON.stringify(meta)}](${imageUrl})`;
            return { responses: [{ sender: 'Visual', content: md }], lore: imageSessionContext?.lore || [] };
          } catch (err) {
            console.error('[/image] Image generation failed for open prompt', err);
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
        
        console.log(`[/image] Calling VisualAgent with ${matchedEntities.length} matched entities`);
        this.emitAgentStatus('Visual', 'start', sceneId);
        let visualResult: string = '';
        let visualParsed: any = null;
        let visualRetries = 0;
        let visualLastError: any = null;
        while (visualRetries < 3) {
          const visualResponse = await visualAgent.run(visualContext);

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
          console.warn('VisualAgent failed to parse/repair JSON after', visualRetries, 'attempts:', visualLastError);
        }
        console.log('[/image] VisualAgent completed');
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
        console.log('Calling NarratorAgent for /scenepicture with scene-picture mode');
        this.emitAgentStatus('Narrator', 'start', sceneId);
        const narration = await narratorAgent.run(narrContext);
        console.log('NarratorAgent completed for /scenepicture');
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
          const sdPrompt = await visAgent.run(visualContext);
          
          // Generate image from the SD prompt
          const imageUrl = await visAgent.generateImage(sdPrompt);
          this.emitAgentStatus('Visual', 'complete', sceneId);
          const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
          const md = `![${JSON.stringify(meta)}](${imageUrl})`;
          return { responses: [{ sender: 'Visual', content: md }], lore: [] };
        } catch (err) {
          console.error('scenepicture generation failed', err);
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
    return await creatorAgent.run(context);
  }
}