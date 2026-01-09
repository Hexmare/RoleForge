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
import Database from 'better-sqlite3';
import { Server } from 'socket.io';

export class Orchestrator {
  private configManager: ConfigManager;
  private env: nunjucks.Environment;
  private db: Database.Database;
  private io?: Server;
  private agents: Map<string, BaseAgent> = new Map();
  private worldState: Record<string, any> = {};
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

  // Build a rich SessionContext for a given sceneId
  async buildSessionContext(sceneId: number) {
    const sceneRow = this.db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!sceneRow) return null;

    const arcRow = this.db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any;
    const campaignRow = this.db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
    const worldRow = this.db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;

    // Lore entries for world
    const loreRows = this.db.prepare('SELECT key, content, tags FROM LoreEntries WHERE worldId = ?').all(worldRow.id || -1) as any[];
    const loreEntries = loreRows.map(r => ({ key: r.key, content: r.content, tags: JSON.parse(r.tags || '[]') }));

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

    // Determine active characters: prefer scene.notes.activeCharacters if present, otherwise infer from recent messages
    let activeCharacters: string[] = [];
    try {
      const notes = sceneRow.notes ? JSON.parse(sceneRow.notes) : null;
      if (notes && Array.isArray(notes.activeCharacters) && notes.activeCharacters.length) {
        activeCharacters = notes.activeCharacters;
      } else {
        const rows = this.db.prepare("SELECT DISTINCT sender FROM Messages WHERE sceneId = ? ORDER BY timestamp DESC LIMIT 50").all(sceneId) as any[];
        activeCharacters = rows.map(r => r.sender).filter((s: string) => !!s && !s.startsWith('user:') && s.toLowerCase() !== 'system').slice(0, 10);
      }
    } catch (e) {
      activeCharacters = [];
    }

    // Resolve merged character objects where possible
    const activeCharactersResolved: any[] = [];
    for (const name of activeCharacters) {
      // try slug heuristic then fallback to characters table
      const slugGuess = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const merged = CharacterService.getMergedCharacter({ worldId: worldRow.id, campaignId: campaignRow.id, characterSlug: slugGuess });
      if (merged) {
        activeCharactersResolved.push(merged);
      } else {
        const charRow = this.db.prepare('SELECT * FROM characters WHERE name = ?').get(name) as any;
        if (charRow) {
          charRow.alternate_greetings = JSON.parse(charRow.alternate_greetings || '[]');
          charRow.tags = JSON.parse(charRow.tags || '[]');
          charRow.extensions = JSON.parse(charRow.extensions || '{}');
          charRow.character_book = JSON.parse(charRow.character_book || '{}');
          activeCharactersResolved.push(charRow);
        }
      }
    }

    const sessionContext = {
      world: { id: worldRow.id, slug: worldRow.slug, name: worldRow.name, description: worldRow.description, loreEntries },
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
        locationRelationships: sceneRow.locationRelationships ? JSON.parse(sceneRow.locationRelationships) : null
      },
      activeCharacters: activeCharactersResolved,
      worldState: { elapsedMinutes: campaignState.elapsedMinutes, dynamicFacts: campaignState.dynamicFacts },
      trackers: campaignState.trackers || { stats: {}, objectives: [], relationships: {} },
      locationMap: (sceneRow.locationRelationships ? JSON.parse(sceneRow.locationRelationships) : {})
    };

    // Seed orchestrator worldState from campaign dynamic facts
    this.worldState = sessionContext.worldState.dynamicFacts || {};

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
    const character = this.db.prepare('SELECT * FROM characters WHERE name = ?').get(name) as any;
    if (character) {
      character.alternate_greetings = JSON.parse(character.alternate_greetings || '[]');
      character.tags = JSON.parse(character.tags || '[]');
      character.extensions = JSON.parse(character.extensions || '{}');
      character.character_book = JSON.parse(character.character_book || '{}');
      return character;
    }
    return null;
  }

  private getPersona(name: string): any {
    const persona = this.db.prepare('SELECT * FROM personas WHERE name = ?').get(name) as any;
    if (persona) {
      persona.details = JSON.parse(persona.details || '{}');
      return persona;
    }
    return { name: 'Default', description: 'A user in the story.', details: {} };
  }

  private extractFirstJson(text: string): string | null {
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

  async processUserInput(userInput: string, personaName: string = 'default', activeCharacters?: string[], sceneId?: number): Promise<{ sender: string; content: string }[]> {
    const slashCmd = this.parseSlashCommand(userInput);
    if (slashCmd) {
      return this.handleSlashCommand(slashCmd.command, slashCmd.args, activeCharacters, sceneId);
    }

    // Check if user is requesting a scene description
    if (this.isSceneDescriptionRequest(userInput)) {
      // Add user input to history
      this.history.push(`User: ${userInput}`);

      // Prepare context
      const context: AgentContext = {
        userInput,
        history: this.history,
        worldState: this.worldState,
        sceneSummary: this.sceneSummary,
        lore: this.getActivatedLore(userInput + ' ' + this.history.join(' ')),
        userPersona: this.getPersona(personaName),
      };

      // Call only NarratorAgent for scene description
      const narratorAgent = this.agents.get('narrator')!;
      console.log('Calling NarratorAgent');
      this.emitAgentStatus('Narrator', 'start', sceneId);
      const narration = await narratorAgent.run(context);
      console.log('NarratorAgent completed');
      this.emitAgentStatus('Narrator', 'complete', sceneId);
      this.history.push(`Narrator: ${narration}`);
      return [{ sender: 'Narrator', content: narration }];
    }

    // Normal interaction flow
    // Add user input to history
    this.history.push(`User: ${userInput}`);

    // Prepare base context
    let context: AgentContext = {
      userInput,
      history: this.history,
      worldState: this.worldState,
      sceneSummary: this.sceneSummary,
      lore: this.getActivatedLore(userInput + ' ' + this.history.join(' ')),
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
    const directorContext = { ...context, activeCharacters: activeCharacters || [] };
    console.log('Calling DirectorAgent');
    this.emitAgentStatus('Director', 'start', sceneId);
    const directorOutput = await directorAgent.run(directorContext);
    console.log('DirectorAgent completed');
    this.emitAgentStatus('Director', 'complete', sceneId);
    // Parse output: JSON {"guidance": "...", "characters": [...]}
    let directorGuidance = '';
    let charactersToRespond: string[] = [];
    try {
      const directorJson = JSON.parse(this.extractFirstJson(directorOutput) || directorOutput);
      directorGuidance = directorJson.guidance || '';
      charactersToRespond = Array.isArray(directorJson.characters) ? directorJson.characters.filter((c: string) => c && (!activeCharacters || activeCharacters.includes(c))) : [];
    } catch (e) {
      console.warn('Failed to parse DirectorAgent JSON output:', directorOutput);
      // Fallback: try old format
      const guidanceMatch = directorOutput.match(/Guidance:\s*(.+?)(?:\n|$)/i);
      const charactersMatch = directorOutput.match(/Characters:\s*(.+?)(?:\n|$)/i);
      if (guidanceMatch) {
        directorGuidance = guidanceMatch[1].trim();
      }
      if (charactersMatch) {
        const charsStr = charactersMatch[1].trim();
        if (charsStr.toLowerCase() !== 'none') {
          charactersToRespond = charsStr.split(',').map(c => c.trim()).filter(c => c && (!activeCharacters || activeCharacters.includes(c)));
        }
      }
    }
    console.log('Active characters passed to Director:', activeCharacters);
    console.log('Director selected characters:', charactersToRespond);
    // Fallback if parsing fails
    if (!directorGuidance && !charactersToRespond.length) {
      console.warn('Failed to parse DirectorAgent output:', directorOutput);
      directorGuidance = directorOutput; // Use as guidance
      // Default to Alice if no characters specified
      charactersToRespond = ['Alice'];
    }
    context.directorGuidance = directorGuidance;

    // Step 3: World state update
    const worldAgent = this.agents.get('world')!;
    console.log('Calling WorldAgent');
    this.emitAgentStatus('WorldAgent', 'start', sceneId);
    const worldUpdateStr = await worldAgent.run(context);
    console.log('WorldAgent completed');
    this.emitAgentStatus('WorldAgent', 'complete', sceneId);
    // Extract JSON from response
    const jsonStr = this.extractFirstJson(worldUpdateStr);
    if (jsonStr) {
      try {
        const worldUpdate = JSON.parse(jsonStr);
        if (!worldUpdate.unchanged) {
          Object.assign(this.worldState, worldUpdate);
        }
      } catch (e) {
        console.warn('WorldAgent returned invalid JSON:', worldUpdateStr);
      }
    } else {
      console.warn('No JSON found in WorldAgent response:', worldUpdateStr);
    }
    context.worldState = this.worldState;

    // Step 4: Characters
    let responses: { sender: string; content: string }[] = [];
    for (const charName of charactersToRespond) {
      const characterData = this.getCharacterByName(charName);
      if (!characterData) {
        console.warn(`Character ${charName} not found`);
        continue;
      }

      const characterAgent = new CharacterAgent(charName, this.configManager, this.env);
      const characterContext: AgentContext = {
        ...context,
        history: this.history.slice(0, -1), // Exclude the current user input from history
        character: characterData,
      };
      console.log(`Calling CharacterAgent for ${charName}`);
      this.emitAgentStatus(charName, 'start', sceneId);
      const characterResponse = await characterAgent.run(characterContext);
      console.log(`CharacterAgent for ${charName} completed`);
      this.emitAgentStatus(charName, 'complete', sceneId);
      if (characterResponse) {
        responses.push({ sender: charName, content: characterResponse });
        this.history.push(`${charName}: ${characterResponse}`);
      }
    }

    return responses;
  }

  private async handleSlashCommand(command: string, args: string[], activeCharacters?: string[], sceneId?: number): Promise<{ sender: string; content: string }[]> {
    switch (command) {
      case 'create':
        const creatorAgent = this.agents.get('creator')!;
        const context: AgentContext = {
          userInput: args.join(' '),
          history: this.history,
          worldState: this.worldState,
          creationRequest: args.join(' '),
        };
        console.log('Calling CreatorAgent');
        this.emitAgentStatus('Creator', 'start', sceneId);
        const creatorResult = await creatorAgent.run(context);
        console.log('CreatorAgent completed');
        this.emitAgentStatus('Creator', 'complete', sceneId);
        return [{ sender: 'Creator', content: creatorResult }];
      case 'image':
        if (!this.configManager.isVisualAgentEnabled()) {
          return [{ sender: 'System', content: 'Visual agent is disabled in configuration.' }];
        }
        const visualAgent = this.agents.get('visual')!;
        const visualContext: AgentContext = {
          userInput: args.join(' '),
          history: this.history,
          worldState: this.worldState,
          narration: args.join(' '),
          sceneElements: [], // No specific elements for /image command
        };
        console.log('Calling VisualAgent for /image');
        this.emitAgentStatus('Visual', 'start', sceneId);
        const visualResult = await visualAgent.run(visualContext);
        console.log('VisualAgent completed for /image');
        this.emitAgentStatus('Visual', 'complete', sceneId);
        return [{ sender: 'Visual', content: visualResult }];
      case 'scenepicture':
        if (!this.configManager.isVisualAgentEnabled()) {
          return [{ sender: 'System', content: 'Visual agent is disabled in configuration.' }];
        }
        // Resolve active characters (names -> descriptions)
        const resolvedChars: { name: string; description: string }[] = [];
        if (activeCharacters && Array.isArray(activeCharacters) && activeCharacters.length) {
          for (const nm of activeCharacters) {
            let desc = '';
            const charRow = this.getCharacterByName(nm);
            if (charRow) {
              desc = charRow.description || charRow.personality || '';
              resolvedChars.push({ name: charRow.name || nm, description: desc });
              continue;
            }
            const slugGuess = String(nm).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const merged = CharacterService.getMergedCharacter({ characterSlug: slugGuess });
            if (merged) {
              desc = merged.description || merged.personality || '';
              resolvedChars.push({ name: merged.name || nm, description: desc });
            } else {
              resolvedChars.push({ name: nm, description: '' });
            }
          }
        }

        // Build a context for the narrator using current orchestrator state and active character summaries
        const narratorAgent = this.agents.get('narrator')!;
        const narrContext: AgentContext = {
          userInput: 'Describe the scene',
          history: this.history,
          worldState: this.worldState,
          sceneSummary: this.sceneSummary,
          lore: this.getActivatedLore(this.history.join(' ')),
          userPersona: this.getPersona('default'),
          activeCharacters: resolvedChars
        } as any;
        console.log('Calling NarratorAgent for /scenepicture');
        this.emitAgentStatus('Narrator', 'start', sceneId);
        const narration = await narratorAgent.run(narrContext);
        console.log('NarratorAgent completed for /scenepicture');
        this.emitAgentStatus('Narrator', 'complete', sceneId);

        // Append character info to prompt for visual agent
        let promptForImage = narration;
        if (resolvedChars.length) {
          // Escape any double-quotes/backslashes in character descriptions to keep JSON safe
          const escapeForJson = (s: any) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const charsText = resolvedChars.map(c => `- ${c.name}: ${escapeForJson(c.description || 'no description')}`).join('\n');
          promptForImage = `${narration}\n\nCharacters:\n${charsText}`;
        }

        // Generate image from narration+characters
        const visAgent = this.agents.get('visual')! as any;
        try {
          this.emitAgentStatus('Visual', 'start', sceneId);
          const imageUrl = await visAgent.generateFromPrompt(promptForImage);
          this.emitAgentStatus('Visual', 'complete', sceneId);
          const meta = { prompt: promptForImage, urls: [imageUrl], current: 0 };
          const md = `![${JSON.stringify(meta)}](${imageUrl})`;
          return [{ sender: 'Visual', content: md }];
        } catch (err) {
          console.error('scenepicture generation failed', err);
          return [{ sender: 'System', content: 'Scene picture generation failed.' }];
        }
      default:
        return [{ sender: 'System', content: `Unknown command: /${command}` }];
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
    this.sceneSummary = '';
  }
}