import { BaseAgent, AgentContext } from './BaseAgent.js';
import { ChatMessage } from '../llm/client';

export class NarratorAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('narrator', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    // Choose template based on narration mode
    const templateName = context.narrationMode === 'scene-picture' ? 'narrator-scene-picture' : 'narrator';
    const systemPrompt = this.renderTemplate(templateName, context);
    const messages = this.renderLLMTemplate(systemPrompt, context.userInput);
    const response = await this.callLLM(messages);
    return this.cleanResponse(response as string);
  }
}