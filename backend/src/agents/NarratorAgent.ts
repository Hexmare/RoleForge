import { BaseAgent, AgentContext } from './BaseAgent.js';

export class NarratorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('narrator', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    // Choose template based on narration mode
    const templateName = context.narrationMode === 'scene-picture' ? 'narrator-scene-picture' : 'narrator';
    const systemPrompt = this.renderTemplate(templateName, context);
    const messageContext = this.buildMessageContext(context, systemPrompt);
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }
}