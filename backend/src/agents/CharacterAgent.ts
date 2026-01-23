import { BaseAgent, AgentContext } from './BaseAgent.js';

export class CharacterAgent extends BaseAgent {
  private characterId: string;

  constructor(characterId: string, configManager: any, env: any) {
    super('character', configManager, env);
    this.characterId = characterId;
  }

  async run(context: AgentContext): Promise<string> {
    // Render pre and post character prompts
    const prePrompt = this.renderTemplate('pre_character', context);
    const postPrompt = this.renderTemplate('post_character', context);
    
    // Build message context with split prompts
    const messageContext = this.buildMessageContext(context, prePrompt);
    messageContext.finalSystemPrompt = postPrompt;
    
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}