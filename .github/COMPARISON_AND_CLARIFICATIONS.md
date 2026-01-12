# RoleForge vs SillyTavern LLM Client: Comparison & Clarifications

## Executive Summary

This document compares the **clientOverhaulStories.md** (SillyTavern LLM Client specification) with RoleForge's actual implementation as documented in **roleforgearchitecture.md** and verified through source code inspection. The analysis identifies areas of alignment, significant differences, and critical clarifications needed.

---

## 1. Architecture Comparison

### SillyTavern Model (clientOverhaulStories.md)

- **Client-Side Heavy**: Browser-based with extensions, frontend makes API calls proxied through server.js
- **Modular Extensions**: Each backend (`openai/`, `kobold/`, `novelai/`) has independent `index.js`
- **Dynamic Frontend Loading**: Extensions loaded dynamically based on user selection
- **Task-Specific Handlers**: Separate extensions for summarization, image captioning, etc.

### RoleForge Actual Implementation

- **Backend-Heavy**: Node.js Express server handles all LLM coordination
- **Agent-Based**: Abstract `BaseAgent` class with specialized agents (CharacterAgent, NarratorAgent, etc.)
- **Unified LLM Client**: Single `llm/client.ts` using OpenAI SDK wrapper
- **Nunjucks Templating**: Task-specific templates in `prompts/` folder
- **Configuration-Driven**: All agent behavior configured via `config.json`

**Clarification**: RoleForge does NOT adopt the client-side extension model from SillyTavern. Instead, it uses server-side agents with configuration-driven behavior. This is a **fundamental architectural difference** that should be documented.

---

## 2. LLM Client Implementation

### SillyTavern Approach (Per clientOverhaulStories.md)

```javascript
// Backend extension pattern
// public/scripts/extensions/openai/index.js
{
  getSettings(): {...},
  loadSettings(): {...},
  generate(): {...},
  getModelList(): {...}
}
```

- Each backend implements a standard interface
- Model switching via `getModelList()` API call
- Parameters configured per backend
- Fallback chains for multi-model support

### RoleForge Actual Implementation

**File**: [backend/src/llm/client.ts](backend/src/llm/client.ts)

```typescript
export async function chatCompletion(
  profile: LLMProfile,
  messages: ChatMessage[],
  options: { stream?: boolean } = {}
): Promise<string | AsyncIterable<string>>
```

**Key Observations**:
1. **Single Function API**: `chatCompletion()` takes a `LLMProfile` object
2. **Profile Structure** (from `configManager.ts`):
   ```typescript
   interface LLMProfile {
     type: 'openai';
     apiKey?: string;
     baseURL: string;
     model?: string;
     template?: string;  // e.g., 'chatml'
     sampler?: SamplerSettings;
     format?: string;    // e.g., 'json'
   }
   ```
3. **No Backend Extensions**: Hardcoded OpenAI SDK usage for all backends (as long as they're OpenAI-compatible)
4. **No Dynamic Model Listing**: Models are configured statically in `config.json`
5. **Streaming Support**: Already implemented via OpenAI SDK's async iteration

**Clarification**: RoleForge currently does NOT support:
- Dynamic model listing from backend APIs
- Multiple backend types (only OpenAI-compatible)
- Runtime backend switching without configuration change
- Backend-specific parameter mapping

**Recommendation**: If multi-backend support is needed, this would require either:
- Option A: Refactor `chatCompletion()` into a plugin system (similar to SillyTavern)
- Option B: Add switch logic in `chatCompletion()` for different backend types (KoboldCPP-specific APIs, etc.)

---

## 3. Template System

### SillyTavern Model (clientOverhaulStories.md)

- **Instruct Mode Presets**: JSON files in `data/instruct-presets/` (e.g., `alpaca.json`, `vicuna.json`)
- **Preset Structure**:
  ```json
  {
    "system_prefix": "### Instruction:\n",
    "user_prefix": "### Input:\n",
    "assistant_prefix": "### Response:\n",
    "stop_sequence": ["### Instruction:", "### Input:"]
  }
  ```
- **Runtime Switching**: Users select preset, template rebuilds prompts
- **Flexible Wrapping**: Same content wrapped in different formats per model

### RoleForge Actual Implementation

**LLM Templates**: [backend/src/llm_templates/](backend/src/llm_templates/)
- Currently: **Only `chatml.njk`**
- Format:
  ```njk
  <|im_start|>system
  {{system_prompt}}<|im_end|>
  <|im_start|>user
  {{user_message}}<|im_end|>
  <|im_start|>assistant
  {{assistant_message}}<|im_end|>
  ```

**Profile Configuration** (from `config.json`):
```json
"profiles": {
  "openai": {
    "template": "chatml",
    "sampler": {...}
  }
}
```

**Critical Issue**: 
- ✗ No preset system like SillyTavern
- ✗ Only one template (`chatml.njk`) exists
- ✗ Template cannot be switched at runtime without code restart
- ✓ `profile.template` field exists but no switching logic implemented
- ✓ Nunjucks allows dynamic content injection

**Clarification**: To support SillyTavern's model-specific templating, RoleForge would need:

1. **Create template files** for different model types (Alpaca, Vicuna, etc.):
   ```
   llm_templates/
   ├── chatml.njk
   ├── alpaca.njk
   ├── vicuna.njk
   ├── llama2.njk
   └── ...
   ```

2. **Implement template switching logic** in `BaseAgent.renderLLMTemplate()`:
   ```typescript
   protected renderLLMTemplate(...) {
     const profile = this.getProfile();
     const templateName = profile.template || 'chatml';
     // Load ${templateName}.njk instead of hardcoded path
   }
   ```

3. **Extend `config.json` agent configs** for per-agent templates:
   ```json
   "agents": {
     "character": {
       "template": "alpaca"  // Override default
     }
   }
   ```

---

## 4. Prompt Components & Composition

### SillyTavern Components (Per clientOverhaulStories.md)

- Main Prompt (system)
- Character Card
- World Info (Lorebooks)
- Chat History
- User Input
- Gaslight (Instruct Template)
- NSFW/Jailbreak Prompt
- Author's Note

**Composition Logic**:
```javascript
function buildPrompt(chatHistory, systemPrompt, template) {
  let prompt = template.system_prefix + systemPrompt + template.system_suffix;
  for (let msg of chatHistory) {
    // Wrap with template prefix/suffix
  }
}
```

### RoleForge Actual Implementation

**Agent Prompts** (in `prompts/` folder):
- `character.njk` - Character system prompt
- `narrator.njk` - Scene description
- `director.njk` - Character selection logic
- `world.njk` - State updates
- `summarize.njk` - History condensing
- `visual.njk` / `visual-image.njk` / `visual-scene-picture.njk` - Image generation
- `creator.njk` - Character/persona creation

**Prompt Assembly** (in each agent's `run()` method):
1. `renderTemplate(taskName, context)` - Builds task-specific system prompt
2. `renderLLMTemplate(systemPrompt, userMessage)` - Wraps in LLM format

**Context Passed** (AgentContext interface):
```typescript
{
  userInput: string;
  history: string[];        // Pre-formatted messages
  worldState: Record<string, any>;
  lore?: string[];
  formattedLore?: string;   // Pre-injected lore
  character?: any;
  characterState?: any;
  activeCharacters?: any[];
  // ... more fields
}
```

**Critical Differences**:

| Aspect | SillyTavern | RoleForge |
|--------|-----------|----------|
| **Lore Injection** | Dynamic World Info + keyword matching | Pre-matched in `getLoreContext()` before passing to agent |
| **Chat History** | Built per-request in `buildPrompt()` | Pre-formatted into `history[]` by Orchestrator |
| **Template Switching** | Runtime via UI dropdown | Configuration-based (requires restart) |
| **System Prompt** | Constructed in PromptManager.js | Task-specific `.njk` files |
| **Task Variation** | Extensions override system prompt | Task-specific `.njk` files with different content |

**Clarification**: 
- RoleForge pre-processes context into AgentContext before calling agents
- This means **lore matching and history formatting happen in Orchestrator**, not in agents
- Task-specific behavior is achieved through **different template files**, not through agent-specific extension methods

---

## 5. Task-Specific Prompt Incorporation

### SillyTavern Model (Per clientOverhaulStories.md)

```javascript
// extensions/summarize/index.js
// Override system prompt for summarization task
const systemPrompt = "You are a summarizer. Summarize concisely.";
useTemplate = getTemplateWithOverride(systemPrompt);
```

- Tasks handled via custom extensions
- System prompt overridden per task
- Same template wrapped around different content

### RoleForge Actual Implementation

**Task = Separate Template File**:
- Summarization: `prompts/summarize.njk`
- Character dialogue: `prompts/character.njk`
- Scene narration: `prompts/narrator.njk`
- Visual prompts: `prompts/visual.njk`, `prompts/visual-image.njk`

**Example Task Handling** (from `NarratorAgent.ts`):
```typescript
async run(context: AgentContext): Promise<string> {
  const templateName = context.narrationMode === 'scene-picture' 
    ? 'narrator-scene-picture' 
    : 'narrator';
  const systemPrompt = this.renderTemplate(templateName, context);
  const messages = this.renderLLMTemplate(systemPrompt, context.userInput);
  // Call LLM...
}
```

**Clarification**: 
- RoleForge uses **template files** to define task-specific prompts
- SillyTavern uses **extensions with system prompt overrides**
- Functionally similar but structurally different
- RoleForge's approach is simpler and more maintainable for TypeScript

---

## 6. Model Switching & Configuration

### SillyTavern (Per clientOverhaulStories.md)

```javascript
// Backend extensions provide dynamic model listing
async function getModelList() {
  const response = await fetch('/v1/models');  // OpenAI-compatible
  return response.data.data;  // List of available models
}

// UI: Users select model → updates params dynamically
```

### RoleForge Actual Implementation

**Static Configuration** (in `config.json`):
```json
"profiles": {
  "openai": {
    "model": "koboldcpp/mistralai_Ministral-3-14B-Reasoning-2512-Q5_K_M",
    "baseURL": "http://192.168.88.88:5001/v1"
  }
}
```

**Runtime Model Selection**:
- ✗ No dynamic model listing
- ✗ No UI for model selection
- ✓ Easy to change in config.json (requires server restart)
- ✓ Profile-based switching without restart (just edit config.json and reload)

**No Frontend UI for**:
- Model selection dropdown
- Dynamic model discovery
- Per-model parameter tuning

**Clarification**: 
- RoleForge treats models as **static configuration**
- SillyTavern treats models as **dynamic backend discovery**
- To match SillyTavern, would need:
  1. `/api/models` endpoint that queries backend
  2. Frontend model picker component
  3. Dynamic parameter adjustment based on model capabilities

---

## 7. Parameter Management

### SillyTavern (Per clientOverhaulStories.md)

- Per-backend parameters configured
- Model-aware defaults (max_tokens based on model)
- User can override per generation
- Fallback chains for unavailable models

### RoleForge Actual Implementation

**Sampler Settings** (in LLMProfile):
```typescript
interface SamplerSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  max_completion_tokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  maxContextTokens?: number;  // Token budget for context
  forceJson?: boolean;
  logitBias?: Record<string, number>;
  n?: number;
}
```

**Configuration Levels**:
1. **Profile defaults** (in `config.json` `profiles`)
2. **Agent overrides** (in `config.json` `agents`)
3. **Runtime merging** (in `BaseAgent.getProfile()`)

**Example**:
```json
{
  "profiles": {
    "openai": {
      "sampler": {
        "temperature": 0.8,
        "max_completion_tokens": 512
      }
    }
  },
  "agents": {
    "character": {
      "sampler": {
        "max_completion_tokens": 400  // Overrides profile
      }
    }
  }
}
```

**From client.ts**:
```typescript
const formatOptions = profile.format ? profile.format : {};
const baseOptions = {
  model,
  messages: trimmedMessages,
  ...samplerOptions,
  ...formatOptions,
};
```

**Clarification**: 
- RoleForge already supports **hierarchical parameter merging** (profile → agent override)
- No dynamic per-generation tuning (would require frontend UI)
- Parameter structure is similar to SillyTavern but simpler

---

## 8. Frontend Integration

### SillyTavern (Per clientOverhaulStories.md)

- Settings dropdown for backend selection
- Model picker (dynamic from `/v1/models`)
- Preset dropdown for template switching
- Advanced formatting options for fine-tuning

### RoleForge Actual Implementation

**Current Frontend**:
- ✗ No LLM backend selector
- ✗ No model picker
- ✗ No template preset selector
- ✗ No parameter tuning UI
- ✓ Character manager
- ✓ World/scene editor
- ✓ Chat interface
- ✓ ComfyUI config modal (for image generation)

**ComfyUI Config Modal** (existing pattern):
- Shows available models from ComfyUI API
- User can select model
- Persists in config

**Clarification**: 
- RoleForge has NO frontend UI for LLM configuration
- This is a **significant gap** compared to SillyTavern
- Could be added following the ComfyUI modal pattern

---

## 9. Streaming & Real-Time Support

### SillyTavern (Per clientOverhaulStories.md)

- Token-by-token streaming
- Browser receives chunks in real-time
- Partial message display

### RoleForge Actual Implementation

**Streaming Support** (in `client.ts`):
```typescript
if (options.stream) {
  const stream = await client.chat.completions.create({
    ...baseOptions,
    stream: true,
  });
  return (async function* () {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;  // Async generator
      }
    }
  })();
}
```

**Socket.io Integration** (in `server.ts`):
- Receives streaming chunks from `client.ts`
- Emits `aiResponse` events in real-time
- Frontend displays as chunks arrive

**Clarification**: 
- ✓ RoleForge already supports streaming via OpenAI SDK
- ✓ Real-time delivery via Socket.io
- ✓ Functionally similar to SillyTavern
- Implementation is server-side (OpenAI SDK) vs client-side (SillyTavern)

---

## 10. Error Handling & Fallbacks

### SillyTavern (Per clientOverhaulStories.md)

- Common error handling across backends
- Model fallback chains
- Retry logic

### RoleForge Actual Implementation

**Current Error Handling** (in `client.ts`):
```typescript
catch (error: any) {
  console.error('LLM API call failed:', {
    profile: profile.baseURL,
    model,
    error: error.message,
    status: error.status,
    response: error.response?.data
  });
  throw error;
}
```

**Observations**:
- ✗ Errors are thrown, not handled
- ✗ No fallback logic to alternate profile/model
- ✗ No retry mechanism
- ✓ Good logging detail

**Clarification**: 
- RoleForge lacks **fallback chains** that SillyTavern has
- Could be added by:
  1. Adding `fallbackProfiles?: string[]` to LLMProfile
  2. Implementing retry logic in `chatCompletion()`
  3. Wrapping in higher-level orchestrator error handling

---

## 11. JSON Response Format Support

### SillyTavern (Per clientOverhaulStories.md)

- Mentioned but not deeply detailed
- Tasks may request JSON output

### RoleForge Actual Implementation

**JSON Format Support**:
```typescript
// From configManager.ts
interface LLMProfile {
  format?: string;  // Response format, e.g., 'json'
}

// From config.json
"profiles": {
  "openai": {
    "format": "json"  // If supported by model
  }
}

// From client.ts
const formatOptions = profile.format ? profile.format : {};
const baseOptions = {
  ...formatOptions,
};
```

**Agent Usage** (e.g., character.njk):
```
CRITICAL: Output ONLY valid JSON on a single line with NO markdown code blocks:
{"response": "...", "characterState": {...}}
```

**Clarification**: 
- RoleForge supports JSON responses via `profile.format`
- OpenAI SDK handles `response_format: { type: 'json_object' }`
- Agents validate and parse JSON from responses
- **No structural schema validation** (agent templates hardcode expected structure)

---

## 12. Context Trimming & Token Management

### SillyTavern (Per clientOverhaulStories.md)

- Implied but not explicitly detailed
- Context budgets likely enforced

### RoleForge Actual Implementation

**Token-Based Context Trimming** (in `client.ts`):
```typescript
function trimMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  // Keeps system + current user + as much history as fits
  const baseTokens = estimateTokens(systemMessage) + estimateTokens(currentUserMessage);
  // Adds history messages from most recent first until budget exhausted
}
```

**Config Support**:
```json
"sampler": {
  "maxContextTokens": 2048
}
```

**Token Counting** (from `tokenCounter.ts`):
- Uses BPE-based estimation
- Not exact but close for OpenAI models

**Clarification**: 
- ✓ RoleForge implements intelligent context trimming
- ✓ Prioritizes system + current user message
- ✓ Fills remaining budget with history (most recent first)
- ✓ Better than naive truncation

---

## 13. Multiple Backend Support

### SillyTavern (Per clientOverhaulStories.md)

- Supports 20+ backends:
  - Local: KoboldAI, TextGenerationWebUI, LLaMA.cpp
  - Cloud: OpenAI, Claude, OpenRouter, etc.
- Each backend has separate extension
- Backends can have different APIs

### RoleForge Actual Implementation

**Current Support**:
- ✓ OpenAI-compatible (via OpenAI SDK)
- ✓ KoboldCPP (runs with OpenAI-compatible endpoint)
- ✗ Claude
- ✗ OpenRouter
- ✗ Cohere, Anthropic native APIs
- ✗ TextGenerationWebUI (unless running OpenAI endpoint)
- ✗ Native Ollama support

**Limitation**: 
- Only supports OpenAI SDK
- Works with OpenAI-compatible servers (KoboldCPP with OpenAI endpoint)
- Does NOT support backends with different APIs

**Configuration Workaround**:
```json
"profiles": {
  "kobold": {
    "baseURL": "http://localhost:5001/v1",
    "model": "koboldcpp/..."
  }
}
```

**Clarification**: 
- RoleForge currently does NOT match SillyTavern's backend flexibility
- Would require architecture change to support backend-specific APIs
- Possible solutions:
  1. Add adapter layer for each backend type
  2. Use `profile.type` to dispatch to backend-specific client
  3. Implement wrapper translators (e.g., Claude API → OpenAI format)

---

## 14. Prompt Preprocessing & Macro Support

### SillyTavern (Per clientOverhaulStories.md)

- Macros 2.0 with nested variables ({{char}}, {{user}})
- Property expansions ({{char.name}}, {{char.personality}})
- Dynamic text insertion

### RoleForge Actual Implementation

**Nunjucks Templating** (in prompts):
```njk
You are {{ character.name }}, a {{ character.species }} {{ character.race }}.
Current state: {{ JSON.stringify(characterState, null, 2) }}
```

**Built-in Context Variables**:
- `character.*` fields
- `userPersona.*` fields
- `worldState`
- `history[]`
- `formattedLore`
- Custom functions: `estimateWordsFromTokens()`

**Clarification**: 
- ✓ Nunjucks is MORE powerful than SillyTavern's macro system
- ✓ Supports conditionals, loops, filters
- ✓ Already implemented and working
- ✓ Context variables properly passed through AgentContext

---

## 15. Code Organization & Extensibility

### SillyTavern (Per clientOverhaulStories.md)

```
public/scripts/
├── extensions/
│   ├── openai/index.js
│   ├── kobold/index.js
│   └── ...
├── PromptManager.js
├── Instruct.js
└── ...
```

### RoleForge Actual Implementation

```
backend/src/
├── agents/
│   ├── BaseAgent.ts
│   ├── CharacterAgent.ts
│   ├── DirectorAgent.ts
│   ├── NarratorAgent.ts
│   ├── WorldAgent.ts
│   ├── SummarizeAgent.ts
│   ├── VisualAgent.ts
│   ├── CreatorAgent.ts
│   └── Orchestrator.ts
├── llm/
│   └── client.ts
├── prompts/
│   ├── character.njk
│   ├── narrator.njk
│   ├── director.njk
│   └── ...
├── llm_templates/
│   └── chatml.njk
└── configManager.ts
```

**Extensibility Differences**:

| Aspect | SillyTavern | RoleForge |
|--------|-----------|----------|
| **Adding Backend** | Create `extensions/backend/index.js` | Modify `client.ts` switch logic |
| **Adding Agent** | Create new extension | Extend BaseAgent + add template + config entry |
| **Adding Template** | Add JSON preset | Add `.njk` file + profile reference |
| **Task Variant** | Extension override | Template file variation |

**Clarification**: 
- RoleForge is TypeScript-based (SillyTavern is JS-based)
- RoleForge uses **agent classes** vs SillyTavern's **extension modules**
- RoleForge is **backend-organized** vs SillyTavern's **frontend-organized**
- Both are extensible, but for different concerns

---

## 16. Critical Gaps & Recommendations

### Gaps in RoleForge vs SillyTavern

| Feature | Status | Priority | Effort |
|---------|--------|----------|--------|
| Multiple backend support | ✗ Not implemented | Medium | High |
| Dynamic model discovery | ✗ Not implemented | Low | Medium |
| Runtime template switching | ✗ Not implemented | Low | Low |
| Frontend LLM config UI | ✗ Not implemented | Low | Medium |
| Model fallback chains | ✗ Not implemented | Low | Medium |
| Retry logic with backoff | ✗ Not implemented | Low | Low |
| Per-generation param override | ✗ Not implemented | Low | Medium |
| Backend-specific parameter mapping | ✗ Not implemented | Medium | High |

### Recommendations

**Phase 1 (Essential for Feature Parity)**:
1. Create template preset system (Alpaca, Vicuna, etc.)
2. Implement runtime template switching
3. Add backend-specific adapter pattern to `client.ts`

**Phase 2 (Nice-to-Have)**:
1. Frontend LLM configuration UI
2. Dynamic model listing endpoint
3. Fallback chain configuration

**Phase 3 (Polish)**:
1. Per-generation parameter override
2. Retry logic with exponential backoff
3. Model capability detection

---

## 17. Architecture Decision Points

### Decision 1: Backend Extension Model vs Agent-Based

**Current**: Agent-based (per agent class with Nunjucks template)  
**SillyTavern**: Extension-based (per backend plugin)

**Trade-offs**:
| Aspect | Agent-Based (RoleForge) | Extension-Based (SillyTavern) |
|--------|------------------------|------------------------------|
| Type safety | ✓ TypeScript enforced | ✗ Dynamic JavaScript |
| Centralized logic | ✓ Orchestrator coordinates | ✗ Each extension isolated |
| Learning curve | ✓ Clearer API surface | ✗ Pattern consistency harder |
| Backend flexibility | ✗ OpenAI-compatible only | ✓ Supports many APIs |
| Code reuse | ✓ Agents share base class | ✗ Duplication across extensions |

**Recommendation**: Keep agent-based model (good fit for TypeScript), but add **adapter layer** for backend variety.

---

### Decision 2: Task Definition via Templates vs Extensions

**Current**: Template-based (prompt files define task)  
**SillyTavern**: Extension-based (code defines task)

**Trade-offs**:
| Aspect | Template-Based (RoleForge) | Extension-Based (SillyTavern) |
|--------|---------------------------|------------------------------|
| Editability | ✓ No recompile needed | ✗ Requires code edit + restart |
| Complexity | ✓ Declarative | ✗ Imperative logic harder to follow |
| Reusability | ✓ Shared template includes | ✗ Logic scattered |
| Debugging | ✓ Clear prompt visibility | ✗ Hidden in code |
| Performance | ✓ Cached after compilation | ✓ Equally good |

**Recommendation**: Stick with template-based approach; superior for prompt engineering.

---

## 18. Configuration File Structure Alignment

### Current `config.json` Structure

```json
{
  "defaultProfile": "openai",
  "profiles": {
    "openai": {
      "type": "openai",
      "baseURL": "...",
      "model": "...",
      "template": "chatml",
      "sampler": { "temperature": 0.8, ... }
    }
  },
  "agents": {
    "character": {
      "llmProfile": "default",
      "sampler": { "max_completion_tokens": 400 }
    }
  },
  "comfyui": { ... },
  "features": { ... }
}
```

### Recommended Extensions

**For Multi-Backend Support**:
```json
{
  "profiles": {
    "openai": {
      "type": "openai",
      "adapter": "openai",
      "baseURL": "...",
      "format": { "type": "json_object" }
    },
    "claude": {
      "type": "claude",
      "adapter": "anthropic",
      "apiKey": "...",
      "model": "claude-3-sonnet"
    }
  }
}
```

**For Template Presets**:
```json
{
  "templates": {
    "chatml": "chatml.njk",
    "alpaca": "alpaca.njk",
    "vicuna": "vicuna.njk"
  },
  "profiles": {
    "openai": {
      "template": "chatml"
    }
  }
}
```

---

## 19. Summary Table: Feature Comparison

| Feature | SillyTavern | RoleForge Current | RoleForge Potential |
|---------|-----------|-------------------|-------------------|
| **Backend Types** | 20+ | 1 (OpenAI-compat) | 3-5 (with adapters) |
| **Model Switching** | Dynamic UI + API | Static config | Dynamic API endpoint |
| **Template System** | JSON presets | Nunjucks templates | JSON + Nunjucks hybrid |
| **Runtime Template Switch** | Yes (UI) | No | Yes (easy to add) |
| **Task Agents** | Extensions | Classes | Classes + Orchestrator |
| **Prompt Components** | Modular builder | Pre-processed context | Same + composition API |
| **Streaming** | Browser to UI | Server to client | Same quality |
| **Error Fallback** | Model chains | Exception throw | Configurable chains |
| **Parameter Tuning** | Per-generation UI | Config only | Config + API override |
| **Token Management** | Implicit | Explicit trimming | Best-in-class |
| **TypeScript Support** | No | Yes | Yes |
| **Frontend Config** | Full UI | None | Can build on pattern |

---

## 20. Actionable Clarifications Needed

### From Product Team

1. **Backend Priority**: Do we need Claude, Anthropic, or other non-OpenAI backends? (Affects architecture significantly)
2. **Model Discovery**: Should users select models from UI or edit config manually?
3. **Template Customization**: Should templates be editable from UI or remain config-only?
4. **Task Definition**: Is template-based approach sufficient or do we need code-based flexibility?

### From Development Team

1. **Adapter Layer**: If multi-backend support needed, implement adapter pattern in Phase 5A/5B
2. **Frontend Config**: Plan UI components following ComfyUI modal pattern
3. **Template Presets**: Create preset system document if runtime switching needed
4. **Error Handling**: Define fallback strategy in Orchestrator

---

## Conclusion

**RoleForge has fundamentally different architecture from SillyTavern** but achieves similar functionality through different means:

- **SillyTavern**: Frontend-driven, extension-based, dynamically loaded plugins
- **RoleForge**: Backend-driven, agent-based, configuration-managed

Both approaches are valid. RoleForge's approach is:
- ✓ Type-safe (TypeScript)
- ✓ Centralized (Orchestrator coordinates)
- ✓ Prompt-engineer-friendly (Nunjucks templates)
- ✗ Backend-limited (OpenAI SDK only)
- ✗ UI-sparse (no configuration interface)

**Key decisions needed**:
1. Accept OpenAI-compatible limitation or implement backend adapters
2. Accept config-file approach or build frontend UI
3. Keep template-based tasks or allow code-based extensions

These architectural differences should be **documented explicitly** to avoid treating clientOverhaulStories.md as a migration spec—it's inspiration, not a specification.
