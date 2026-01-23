import { BaseAgent, AgentContext } from './BaseAgent.js';

export class DirectorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('director', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    // Render pre and post director prompts
    const prePrompt = this.renderTemplate('pre_director', context);
    const postPrompt = this.renderTemplate('post_director', context);
    
    // Build message context with split prompts
    const messageContext = this.buildMessageContext(context, prePrompt);
    messageContext.finalSystemPrompt = postPrompt;
    
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}