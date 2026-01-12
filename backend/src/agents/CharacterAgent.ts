import { BaseAgent, AgentContext } from './BaseAgent.js';

export class CharacterAgent extends BaseAgent {
  private characterId: string;

  constructor(characterId: string, configManager: any, env: any) {
    super('character', configManager, env);
    this.characterId = characterId;
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('character', context);
    const response = await this.callLLM(systemPrompt, context.userInput);
    return this.cleanResponse(response as string);
  }
}