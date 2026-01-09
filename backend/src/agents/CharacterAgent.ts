import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ChatMessage } from '../llm/client';

export class CharacterAgent extends BaseAgent {
  private characterId: string;

  constructor(characterId: string, configManager: any, env: any) {
    super('character', configManager, env);
    this.characterId = characterId;
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('character', context);
    const messages = this.renderLLMTemplate(systemPrompt, context.userInput);
    const response = await this.callLLM(messages);
    return this.cleanResponse(response as string);
  }
}