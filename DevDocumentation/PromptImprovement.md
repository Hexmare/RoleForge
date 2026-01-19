# Integration Instructions for Centralized ChatML Templating in RoleForge

This document provides concise, step-by-step instructions for GitHub Copilot to implement a centralized templating system in RoleForge, inspired by SillyTavern's robust ChatML setup. The goal is to extend the current templating in `BaseAgent.ts` (which uses Nunjucks templates from `llm_templates/` and agent-specific prompts from `prompts/`) to a unified system. This system will build a flexible `messages: ChatMessage[]` array where the main agent prompt can be swapped, while maintaining shared data like history, lore, worldState, vectorMemories, etc. This reduces maintenance by centralizing logic (e.g., merging system prompts, inlining media, token budgeting) and supports multimodal content (text parts, images, videos) and tool calls, similar to SillyTavern.

**Key Changes:**
- Define rich `ChatMessage` with `content` as string or array of parts.
- Create a `ChatCompletion` class in BaseAgent for message preparation (merge prompts, inline data, budget tokens).
- Update `renderLLMTemplate` to use the centralized builder.
- Adapt `callLLM` and agent `run` methods to use the new flow.
- In Orchestrator, prepare shared context and pass to agents.

**Prerequisites:**
- Open the RoleForge project in VS Code or your IDE.
- Ensure all dependencies (e.g., nunjucks, better-sqlite3) are installed via `npm install` in the root.
- No git actions; just edit files as specified.

Follow phases sequentially. Use Copilot suggestions for code completion, but match the exact specs.

## Phase 1: Define Rich ChatML Types

1. Navigate to `backend/src/types/` (create the directory if missing by right-clicking `src/` > New Folder > name "types").
2. Create a new file `chatml.ts` (right-click `types/` > New File > name "chatml.ts").
3. Add the following code to `chatml.ts`:
   ```typescript
   export type ContentPart =
     | { type: 'text'; text: string }
     | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
     | { type: 'video_url'; video_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
     | { type: 'audio_url'; audio_url: { url: string } }
     | { type: 'tool_call_id'; tool_call_id: string; content: string }
     | { type: 'tool_calls'; tool_calls: ToolCall[] };

   export interface ToolCall {
     id: string;
     type: 'function';
     function: {
       name: string;
       description?: string;
       parameters?: Record<string, any>;
       arguments?: any;
     };
     signature?: string;
   }

   export interface ChatMessage {
     role: 'system' | 'user' | 'assistant' | 'tool';
     name?: string;
     content: string | ContentPart[];
     tool_calls?: ToolCall[];
     tool_call_id?: string;
     signature?: string;
     // RoleForge-specific: Add if needed for agents
   }
   ```
4. Save `chatml.ts`.

## Phase 2: Extend BaseAgent with Centralized Message Builder

1. Open `backend/src/agents/BaseAgent.ts`.
2. At the top, after existing imports, add:
   ```typescript
   import { ChatMessage, ContentPart, ToolCall } from '../types/chatml';
   ```
3. Inside the `BaseAgent` class, add a new private method `prepareMessages` (after constructor):
   ```typescript
   protected prepareMessages(mainPrompt: string, context: AgentContext): ChatMessage[] {
     const messages: ChatMessage[] = [];

     // Merge system prompts: main agent prompt + shared data
     let systemContent: ContentPart[] = [{ type: 'text', text: mainPrompt }];

     // Add formattedLore if present
     if (context.formattedLore) {
       systemContent.push({ type: 'text', text: `\nLore:\n${context.formattedLore}` });
     }

     // Add worldState
     if (Object.keys(context.worldState || {}).length > 0) {
       systemContent.push({ type: 'text', text: `\nWorld State:\n${JSON.stringify(context.worldState, null, 2)}` });
     }

     // Add trackers (stats, objectives, relationships)
     if (context.trackers) {
       systemContent.push({ type: 'text', text: `\nTrackers:\n${JSON.stringify(context.trackers, null, 2)}` });
     }

     // Add characterStates
     if (context.characterStates) {
       systemContent.push({ type: 'text', text: `\nCharacter States:\n${JSON.stringify(context.characterStates, null, 2)}` });
     }

     // Add vectorMemories (injected from vector store)
     if (context.vectorMemories) {
       systemContent.push({ type: 'text', text: `\nRelevant Memories:\n${context.vectorMemories}` });
     }

     // Add history as separate messages
     context.history?.forEach((hist: string) => {
       messages.push({ role: 'assistant', content: hist }); // Adjust role based on history source
     });

     // Add sceneSummary
     if (context.sceneSummary) {
       messages.push({ role: 'system', content: context.sceneSummary });
     }

     // Inline media if present (e.g., visualPrompt as image_url)
     if (context.visualPrompt) {
       systemContent.push({ type: 'text', text: `\nVisual Prompt: ${context.visualPrompt}` });
     }
     if (context.narration) {
       systemContent.push({ type: 'text', text: `\nNarration: ${context.narration}` });
     }

     // Token budget: Placeholder - trim history if exceeds (implement estimateTokens if needed)
     // For now, assume under budget

     // System message with merged content
     messages.unshift({ role: 'system', content: systemContent });

     // User input as last message
     if (context.userInput) {
       messages.push({ role: 'user', content: context.userInput });
     }

     return messages;
   }
   ```
4. Update `renderLLMTemplate` to use `prepareMessages` instead of direct rendering:
   - Replace the body with:
     ```typescript
     protected renderLLMTemplate(mainPrompt: string, context: AgentContext): ChatMessage[] {
       const profile = this.getProfile();
       const messages = this.prepareMessages(mainPrompt, context);

       // If non-ChatML template, flatten content to string
       if (profile.template !== 'chatml') {
         return messages.map(msg => ({
           ...msg,
           content: typeof msg.content === 'string' ? msg.content : this.flattenContent(msg.content as ContentPart[]),
         }));
       }
       return messages;
     }
     ```
5. Add a private flatten method:
   ```typescript
   private flattenContent(parts: ContentPart[]): string {
     return parts.map(part => {
       if (part.type === 'text') return part.text;
       return `[${part.type.toUpperCase()}: ${JSON.stringify(part[part.type as keyof ContentPart])}]`;
     }).join('\n');
   }
   ```
6. Update `callLLM` to pass mainPrompt and context instead of systemPrompt/userMessage/assistantMessage:
   - Change signature to: `protected async callLLM(mainPrompt: string, context: AgentContext): Promise<string>`
   - In body, replace `const messages = this.renderLLMTemplate(systemPrompt, userMessage, assistantMessage);` with `const messages = this.renderLLMTemplate(mainPrompt, context);`
   - Remove `renderRawLLMTemplate` and `callCustomLLM` if not needed, or adapt similarly.
7. Remove or comment out old `renderTemplate` usages in derived agents (Copilot will suggest in Phase 4).
8. Save `BaseAgent.ts`.

## Phase 3: Update Orchestrator to Prepare Shared Context

1. Open `backend/src/agents/Orchestrator.ts`.
2. At the top, add import:
   ```typescript
   import { ChatMessage } from '../types/chatml';
   ```
3. In `processUserInput` (or similar methods like `continueRound`), update context building:
   - Before calling agents, merge shared data into `context: AgentContext`.
   - Example: After loading scene/arc, add:
     ```typescript
     context.vectorMemories = await getMemoryRetriever().retrieveRelevantMemories(context.userInput, sceneId); // Assuming existing retriever
     ```
4. When calling agent.run(context), ensure mainPrompt is loaded from agent's prompt file:
   - In agent calls, load mainPrompt: `const mainPrompt = fs.readFileSync(path.join(__dirname, '..', 'prompts', '${agentName}.njk'), 'utf-8');`
   - But agents will now use centralized builder.
5. In `completeRound` or post-processing, handle tool_calls if present in responses.
6. Save `Orchestrator.ts`.

## Phase 4: Adapt Derived Agents to New Templating

1. For each derived agent (e.g., NarratorAgent.ts, CharacterAgent.ts), open the file.
2. In `run(context: AgentContext)`:
   - Load main prompt: `const mainPrompt = this.renderTemplate('narrator', context);` (keep if needed, but now it's the swappable part).
   - Call `this.callLLM(mainPrompt, context)` instead of old prompt building.
   - Handle rich responses: If response has tool_calls, process (e.g., for visual generation).
3. Remove agent-specific template rendering; rely on centralized `prepareMessages`.
4. For multimodal: In VisualAgent, add image_url to content array.
5. Save all files.

## Phase 5: Testing and Refinement

1. Run the backend: `npm run dev`.
2. Test with sample input: Use curl or frontend to trigger processUserInput.
3. Verify logs: Check for merged system content, flattened for non-chatml.
4. Add token estimation: Implement in `prepareMessages` using `estimateWordsFromTokens`.
5. If errors, debug types in `chatml.ts`.

