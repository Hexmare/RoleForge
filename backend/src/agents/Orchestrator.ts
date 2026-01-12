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
import CharacterService from '../services/CharacterService.js';
import SceneService from '../services/SceneService.js';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import LorebookService from '../services/LorebookService.js';
import { matchLoreEntries } from '../utils/loreMatcher.js';

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

  constructor(configManager: ConfigManager, env: nunjucks.Environment, db: Database.Database, io?: Server) {
    this.configManager = configManager;
    this.env = env;
    this.db = db;
    this.io = io;

    // Initialize agents
    this.agents.set('narrator', new NarratorAgent(configManager, env));
    this.agents.set('director', new DirectorAgent(configManager, env));
    this.agents.set('world', new WorldAgent(configManager, env));
    this.agents.set('summarize', new SummarizeAgent(configManager, env));
    this.agents.set('visual', new VisualAgent(configManager, env));
    this.agents.set('creator', new CreatorAgent(configManager, env));
  }

  private emitAgentStatus(agentName: string, status: 'start' | 'complete', sceneId?: number) {
    if (this.io && sceneId) {
      this.io.to(`scene-${sceneId}`).emit('agentStatus', { agent: agentName, status });
    }
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
      const value = this.getNestedValue(context, key.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
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

  async processUserInput(userInput: string, personaName: string = 'default', activeCharacters?: string[], sceneId?: number): Promise<{ responses: { sender: string; content: string }[], lore: string[] }> {
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
      const summary = await summarizeAgent.run(context);
      console.log('SummarizeAgent completed');
      this.emitAgentStatus('Summarize', 'complete', sceneId);
      this.sceneSummary = summary;
      // Truncate history
      this.history = this.history.slice(-5);
    }

    // Step 2: Director guidance and character selection
    const directorAgent = this.agents.get('director')!;
    const directorContext = { 
      ...context, 
      activeCharacters: activeCharacters || [],
      activeCharacterNames: sessionContext.activeCharacters.map(c => c.name).join(', '),
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
    try {
      // Strip ```json wrapper if present
      let cleanedOutput = directorOutput.trim();
      if (cleanedOutput.startsWith('```json') && cleanedOutput.endsWith('```')) {
        cleanedOutput = cleanedOutput.slice(7, -3).trim(); // remove ```json and ```
      }
      // Try direct JSON parsing
      let directorJson = JSON.parse(cleanedOutput);
      
      // Check if we got a valid response object/array
      if (Array.isArray(directorJson)) {
        // If it's an array, check if first element is a valid object
        if (directorJson.length > 0 && typeof directorJson[0] === 'object' && directorJson[0] !== null) {
          directorJson = directorJson[0];
        } else {
          // Array of numbers or invalid - treat as parse failure
          throw new Error('Invalid array response');
        }
      } else if (typeof directorJson !== 'object' || directorJson === null) {
        // Not an object or array - treat as parse failure
        throw new Error('Invalid response type');
      }
      
      directorGuidance = directorJson.guidance || '';
        charactersToRespond = Array.isArray(directorJson.characters) ? directorJson.characters : [];
    } catch (e) {
      console.warn('DirectorAgent returned invalid JSON, trying extraction:', directorOutput, e);
      // Fallback: try to extract JSON from response if direct parsing fails
      try {
        let directorJson = JSON.parse(this.extractFirstJson(directorOutput) || directorOutput);
        // Handle both object and array responses
        if (Array.isArray(directorJson)) {
          directorJson = directorJson[0] || {};
        }
        directorGuidance = directorJson.guidance || '';
        charactersToRespond = Array.isArray(directorJson.characters) ? directorJson.characters : [];
      } catch (fallbackError) {
        console.warn('DirectorAgent JSON extraction also failed:', fallbackError);
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
        charactersToRespond = []; // No characters to respond
      }
    }
    context.directorGuidance = directorGuidance;

    // Step 4: Characters
    let responses: { sender: string; content: string }[] = [];
    
    // Initialize character states if not present
    const characterStates = { ...sessionContext.scene.characterStates };
    const userPersonaName = personaName || 'user';
    if (!characterStates[userPersonaName]) {
      characterStates[userPersonaName] = {
        clothingWorn: 'default',
        mood: 'neutral',
        activity: 'interacting',
        location: sessionContext.scene.location || 'unknown',
        position: 'standing'
      };
    }
    for (const char of sessionContext.activeCharacters) {
      if (!characterStates[char.name]) {
        characterStates[char.name] = {
          clothingWorn: char.outfit || 'default',
          mood: 'neutral',
          activity: 'present',
          location: sessionContext.scene.location || 'unknown',
          position: 'standing'
        };
        console.log(`Initialized character state for ${char.name}`);
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
    
    const worldContext = {
      ...context,
      previousWorldState: sessionContext.scene.worldState,
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
    try {
      // Strip ```json wrapper if present
      let cleanedOutput = worldUpdateStr.trim();
      if (cleanedOutput.startsWith('```json') && cleanedOutput.endsWith('```')) {
        cleanedOutput = cleanedOutput.slice(7, -3).trim(); // remove ```json and ```
      }
      let worldUpdate = JSON.parse(cleanedOutput);
      
      // Handle both object and array responses
      if (Array.isArray(worldUpdate)) {
        // If it's an array, check if first element is a valid object
        if (worldUpdate.length > 0 && typeof worldUpdate[0] === 'object' && worldUpdate[0] !== null) {
          worldUpdate = worldUpdate[0];
        } else {
          // Array of invalid data - treat as parse failure
          throw new Error('Invalid array response from WorldAgent');
        }
      } else if (typeof worldUpdate !== 'object' || worldUpdate === null) {
        // Not an object or array - treat as parse failure
        throw new Error('Invalid response type from WorldAgent');
      }
      
      // Check if we got a valid response object
      if (!worldUpdate.unchanged) {
        if (worldUpdate.worldState) {
          Object.assign(this.worldState, worldUpdate.worldState);
          worldStateChanged = true;
        }
        if (worldUpdate.characterStates) {
          Object.assign(characterStates, worldUpdate.characterStates);
        }
        if (worldUpdate.trackers) {
          // Normalize objectives to array if it's an object
          if (worldUpdate.trackers.objectives && typeof worldUpdate.trackers.objectives === 'object' && !Array.isArray(worldUpdate.trackers.objectives)) {
            worldUpdate.trackers.objectives = Object.values(worldUpdate.trackers.objectives).map((obj: any) => typeof obj === 'string' ? obj : obj.description || JSON.stringify(obj));
          }
          Object.assign(this.trackers, worldUpdate.trackers);
          trackersChanged = true;
        }
      }
    } catch (e) {
      console.warn('WorldAgent returned invalid JSON:', worldUpdateStr, e);
      // Fallback: try to extract JSON from response if direct parsing fails
      const jsonStr = this.extractFirstJson(worldUpdateStr);
      if (jsonStr) {
        try {
          let worldUpdate = JSON.parse(jsonStr);
          // Handle both object and array responses
          if (Array.isArray(worldUpdate)) {
            worldUpdate = worldUpdate[0] || {};
          }
          if (!worldUpdate.unchanged) {
            if (worldUpdate.worldState) {
              Object.assign(this.worldState, worldUpdate.worldState);
              worldStateChanged = true;
            }
            if (worldUpdate.characterStates) {
              Object.assign(characterStates, worldUpdate.characterStates);
            }
            if (worldUpdate.trackers) {
              // Normalize objectives to array if it's an object
              if (worldUpdate.trackers.objectives && typeof worldUpdate.trackers.objectives === 'object' && !Array.isArray(worldUpdate.trackers.objectives)) {
                worldUpdate.trackers.objectives = Object.values(worldUpdate.trackers.objectives).map((obj: any) => typeof obj === 'string' ? obj : obj.description || JSON.stringify(obj));
              }
              Object.assign(this.trackers, worldUpdate.trackers);
              trackersChanged = true;
            }
          }
        } catch (fallbackError) {
          console.warn('WorldAgent JSON extraction also failed:', fallbackError);
        }
      } else {
        console.warn('No JSON found in WorldAgent response:', worldUpdateStr);
      }
    }
    
    // Save updated world state to scene if it changed
    if (worldStateChanged) {
      const currentMaxMessageNumber = this.db.prepare('SELECT MAX(messageNumber) as maxNum FROM Messages WHERE sceneId = ?').get(sceneId!) as any;
      const newLastMessageNumber = currentMaxMessageNumber?.maxNum || 0;
      SceneService.update(sceneId!, {
        worldState: this.worldState,
        lastWorldStateMessageNumber: newLastMessageNumber
      });
    }
    
    // Save updated trackers to campaign if they changed
    if (trackersChanged) {
      this.db.prepare('UPDATE CampaignState SET trackers = ?, updatedAt = CURRENT_TIMESTAMP WHERE campaignId = ?').run(JSON.stringify(this.trackers), sessionContext.campaign.id);
    }
    
    // Emit updated state to frontend
    this.io?.to(`scene-${sceneId}`).emit('stateUpdated', { state: this.worldState, trackers: this.trackers, characterStates });
    
    context.worldState = this.worldState;

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
      const characterContext: AgentContext = {
        ...context,
        history: this.sceneSummary ? [`[SCENE SUMMARY]\n${this.sceneSummary}\n\n[MESSAGES]\n${this.history.slice(0, -1).join('\n')}`] : this.history.slice(0, -1), // Exclude the current user input from history
        character: characterData,
        characterState: characterStates[charName],
        maxCompletionTokens: (characterAgent as any).getProfile().sampler?.max_completion_tokens || 400,
      };
      console.log(`[CHARACTER] Calling CharacterAgent for "${charName}"`);
      console.log(`[CHARACTER] Character profile: name=${characterData?.name}, includes lore: ${!!context.formattedLore}`);
      this.emitAgentStatus(charName, 'start', sceneId);
      const characterResponse = await characterAgent.run(characterContext);
      console.log(`[CHARACTER] CharacterAgent for "${charName}" completed`);
      console.log(`[CHARACTER] Raw response length: ${characterResponse?.length || 0} chars`);
      console.log(`[CHARACTER] First 200 chars of response: ${characterResponse?.substring(0, 200) || 'EMPTY'}`);
      this.emitAgentStatus(charName, 'complete', sceneId);
      if (characterResponse) {
        // Strip ```json wrapper if present
        let cleanedResponse = characterResponse.trim();
        console.log(`[CHARACTER] Attempting JSON parse on response...`);
        if (cleanedResponse.startsWith('```json') && cleanedResponse.endsWith('```')) {
          console.log(`[CHARACTER] Stripping \`\`\`json wrapper`);
          cleanedResponse = cleanedResponse.slice(7, -3).trim();
          console.log(`[CHARACTER] After stripping: ${cleanedResponse.substring(0, 100)}...`);
        }
        let parsed;
        try {
          console.log(`[CHARACTER] Parsing JSON...`);
          parsed = JSON.parse(cleanedResponse);
          console.log(`[CHARACTER] JSON parse SUCCESS. Keys: ${Object.keys(parsed).join(', ')}`);
        } catch (e) {
          // If direct parsing fails, try to extract JSON object
          console.warn(`[CHARACTER] JSON parse FAILED: ${e instanceof Error ? e.message : e}`);
          console.log(`[CHARACTER] Attempting JSON extraction...`);
          
          // Try to find JSON object in response
          const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[0]);
              console.log(`[CHARACTER] JSON extraction SUCCESS. Keys: ${Object.keys(parsed).join(', ')}`);
            } catch (innerE) {
              console.warn(`[CHARACTER] JSON extraction also failed: ${innerE instanceof Error ? innerE.message : innerE}`);
              console.log(`[CHARACTER] Treating response as plain text`);
              parsed = { response: cleanedResponse, characterState: null };
            }
          } else {
            // If parsing fails, treat as plain text
            console.log(`[CHARACTER] No JSON object found. Treating response as plain text`);
            parsed = { response: cleanedResponse, characterState: null };
          }
        }
        const content = parsed.response;
        console.log(`[CHARACTER] Extracted content length: ${content?.length || 0} chars`);
        responses.push({ sender: charName, content });
        this.history.push(`${charName}: ${content}`);
      }
    }

    // Save updated character states to scene
    SceneService.update(sceneId!, { characterStates });
    this.characterStates = characterStates; // Update instance
    // Emit character states update
    this.io?.to(`scene-${sceneId}`).emit('stateUpdated', { characterStates: this.characterStates });

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
        const visualResult = await visualAgent.run(visualContext);
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