import { BaseAgent, AgentContext } from './BaseAgent.js';
import { countTokens } from '../utils/tokenCounter.js';

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
    
    // Apply token budgeting
    const budgetedContext = this.applyTokenBudget(context, prePrompt, postPrompt);
    
    // Build message context with split prompts
    const messageContext = this.buildMessageContext(budgetedContext, prePrompt);
    messageContext.finalSystemPrompt = postPrompt;
    
    const response = await this.callLLMWithContext(messageContext);
    return this.cleanResponse(response as string);
  }

  /**
   * Applies intelligent token budgeting to ensure we don't exceed context limits.
   * Budgeting strategy:
   * - Calculate available tokens: (maxContextTokens - max_completion_tokens) * 0.9
   * - Fixed: pre + post prompts (measured)
   * - Memories + Lore: max 25% of remaining
   * - Chat History: remaining 75%
   * - Guaranteed: current round + last round always included
   */
  private applyTokenBudget(context: AgentContext, prePrompt: string, postPrompt: string): AgentContext {
    const profile = this.getProfile();
    const fullConfig = this.configManager.getConfig();
    const agentConfig = fullConfig.agents?.[this.agentName];
    
    // Get token limits
    const maxContextTokens = profile.sampler?.maxContextTokens || 4096;
    const maxCompletionTokens = agentConfig?.sampler?.max_completion_tokens || profile.sampler?.max_completion_tokens || 512;
    
    // Calculate available budget (90% of available context)
    const availableTokens = Math.floor((maxContextTokens - maxCompletionTokens) * 0.9);
    
    // Measure fixed costs (pre + post prompts) - these are NEVER trimmed
    const preTokens = countTokens(prePrompt);
    const postTokens = countTokens(postPrompt);
    const fixedCost = preTokens + postTokens;
    
    // Calculate remaining budget for dynamic content (memories, lore, history)
    const remainingBudget = Math.max(0, availableTokens - fixedCost);
    
    // If fixed prompts exceed budget, log warning but don't trim them
    if (fixedCost > availableTokens) {
      console.warn(`[CHARACTER_BUDGET] ${this.characterId}: Fixed prompts (${fixedCost} tokens) exceed available budget (${availableTokens} tokens). Consider reducing prompt size.`);
      // Allow dynamic content with minimal allocation
      const emergencyBudget = Math.floor(maxContextTokens * 0.1);
      console.warn(`[CHARACTER_BUDGET] ${this.characterId}: Using emergency budget of ${emergencyBudget} tokens for dynamic content`);
    }
    
    // Allocate budgets
    const memoryLoreBudget = Math.floor(remainingBudget * 0.25); // 25% for memories + lore
    const historyBudget = remainingBudget - memoryLoreBudget;     // 75% for history
    
    console.log(`[CHARACTER_BUDGET] ${this.characterId}: Available=${availableTokens}, Fixed=${fixedCost}, Memory/Lore=${memoryLoreBudget}, History=${historyBudget}`);
    
    // Build budgeted context
    const budgetedContext = { ...context };
    const envelope = context.contextEnvelope;
    
    if (envelope) {
      const budgetedEnvelope = { ...envelope };
      
      // Trim memories to fit budget (trimMemories handles measurement internally)
      if (envelope.memories) {
        const halfMemoryLoreBudget = Math.floor(memoryLoreBudget / 2);
        budgetedEnvelope.memories = this.trimMemories(envelope.memories, halfMemoryLoreBudget);
      }
      
      // Trim lore to fit budget
      if (envelope.lore && Array.isArray(envelope.lore)) {
        const halfMemoryLoreBudget = Math.floor(memoryLoreBudget / 2);
        budgetedEnvelope.lore = this.trimArrayAtBoundaries(envelope.lore, halfMemoryLoreBudget);
      }
      
      // Budget history (75% allocation)
      // Always include current round and last round (guaranteed minimum)
      const currentRoundMessages = envelope.lastRoundMessages || [];
      const currentRoundTokens = currentRoundMessages.reduce((sum, m) => sum + countTokens(m), 0);
      
      const historyMessages = envelope.history || context.history || [];
      const lastRoundSize = Math.min(10, historyMessages.length); // Assume last ~10 messages are last round
      const lastRoundMessages = historyMessages.slice(-lastRoundSize);
      const lastRoundTokens = lastRoundMessages.reduce((sum, m) => sum + countTokens(m), 0);
      
      const guaranteedTokens = currentRoundTokens + lastRoundTokens;
      const remainingHistoryBudget = Math.max(0, historyBudget - guaranteedTokens);
      
      // Trim older history to fit budget
      if (historyMessages.length > lastRoundSize) {
        const olderMessages = historyMessages.slice(0, -lastRoundSize);
        const trimmedOlder = this.trimArrayAtBoundaries(olderMessages, remainingHistoryBudget);
        budgetedEnvelope.history = [...trimmedOlder, ...lastRoundMessages];
        
        console.log(`[CHARACTER_BUDGET] History: kept last ${lastRoundSize} msgs (${lastRoundTokens} tokens), trimmed older ${olderMessages.length} msgs to ${trimmedOlder.length} msgs`);
      }
      
      budgetedContext.contextEnvelope = budgetedEnvelope;
    }
    
    return budgetedContext;
  }

  /**
   * Trim an array of strings to fit within token budget.
   * Only includes complete entries - never partial entries.
   */
  private trimArrayAtBoundaries(array: string[], tokenBudget: number): string[] {
    const result: string[] = [];
    let currentTokens = 0;
    
    for (const item of array) {
      const itemTokens = countTokens(item);
      // Only add if the COMPLETE item fits
      if (currentTokens + itemTokens <= tokenBudget) {
        result.push(item);
        currentTokens += itemTokens;
      } else {
        // Stop - don't add partial items
        break;
      }
    }
    
    console.log(`[CHARACTER_BUDGET] Trimmed array: kept ${result.length}/${array.length} items (${currentTokens}/${tokenBudget} tokens)`);
    return result;
  }

  /**
   * Trim memories object to fit within token budget.
   * Priority: 1) Relevance/similarity score (highest first), 2) Recency (newest first)
   * ONLY includes complete memories - never partial/truncated entries.
   */
  private trimMemories(memories: Record<string, any[]>, tokenBudget: number): Record<string, any[]> {
    // Collect all memories with metadata for sorting
    interface MemoryWithMeta {
      key: string;
      memory: any;
      memStr: string;
      tokens: number;
      similarity: number;
      timestamp: number;
    }
    
    const allMemories: MemoryWithMeta[] = [];
    
    for (const [key, memArray] of Object.entries(memories)) {
      if (key === '__loreOverride') continue;
      
      for (const mem of memArray) {
        // Extract clean text for token counting
        let memStr = '';
        if (typeof mem === 'string') {
          memStr = mem;
        } else if (mem && typeof mem === 'object') {
          memStr = mem.text || mem.metadata?.text || mem.content || JSON.stringify(mem);
        }
        
        const tokens = countTokens(memStr);
        
        // Extract similarity score (relevance) - memory objects typically have a similarity/score field
        const similarity = (typeof mem === 'object' && mem !== null) 
          ? (mem.similarity || mem.score || mem.relevance || 0) 
          : 0;
        
        // Extract timestamp - use current time if not available
        const timestamp = (typeof mem === 'object' && mem !== null)
          ? (mem.timestamp || mem.createdAt || Date.now())
          : Date.now();
        
        allMemories.push({
          key,
          memory: mem,
          memStr,
          tokens,
          similarity,
          timestamp
        });
      }
    }
    
    // Sort by: 1) Similarity (descending - higher is better), 2) Timestamp (descending - newer is better)
    allMemories.sort((a, b) => {
      if (Math.abs(a.similarity - b.similarity) > 0.01) {
        return b.similarity - a.similarity; // Higher similarity first
      }
      return b.timestamp - a.timestamp; // Newer first as tiebreaker
    });
    
    console.log(`[CHARACTER_BUDGET] Memory sorting: ${allMemories.length} memories, top similarity: ${allMemories[0]?.similarity.toFixed(3) || 'N/A'}`);
    
    // Take COMPLETE memories in priority order until budget exhausted
    const result: Record<string, any[]> = {};
    let currentTokens = 0;
    let keptCount = 0;
    
    for (const item of allMemories) {
      // Only add if the COMPLETE memory fits
      if (currentTokens + item.tokens <= tokenBudget) {
        if (!result[item.key]) {
          result[item.key] = [];
        }
        result[item.key].push(item.memory);
        currentTokens += item.tokens;
        keptCount++;
      } else {
        // Budget exhausted - stop adding memories
        console.log(`[CHARACTER_BUDGET] Memory budget exhausted: would need ${currentTokens + item.tokens} tokens but only have ${tokenBudget}`);
        break; // Budget exhausted
      }
    }
    
    // Preserve __loreOverride if present
    if (memories.__loreOverride) {
      result.__loreOverride = memories.__loreOverride;
    }
    
    console.log(`[CHARACTER_BUDGET] Kept ${keptCount}/${allMemories.length} complete memories (${currentTokens}/${tokenBudget} tokens)`);
    
    return result;
  }
}