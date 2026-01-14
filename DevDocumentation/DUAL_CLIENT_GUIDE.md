# Dual-Client LLM Architecture Guide

## Overview

RoleForge now supports a **dual-client LLM architecture** that enables flexible routing between two different LLM integration approaches:

1. **OpenAI Client** (`openai` type) - Uses OpenAI SDK with ChatMessage[] array format
2. **Custom Client** (`custom` type) - Uses axios with raw template-rendered strings

This architecture fixes a critical bug where template selection was non-functional because the parser was hardcoded to ChatML format. With the dual-client system, each profile type has its own rendering and communication pipeline.

## Architecture Overview

```
Profile Selection (config.json)
    ↓
LLMProfile.type: 'openai' | 'custom'
    ├─ 'openai' type
    │   ├─ renderLLMTemplate() → ChatMessage[] (parses ChatML format)
    │   ├─ callLLM(ChatMessage[]) → OpenAI SDK
    │   └─ chatCompletion()
    │
    └─ 'custom' type
        ├─ renderRawLLMTemplate() → raw string (no parsing)
        ├─ callCustomLLM(system, user, assistant)
        ├─ customLLMRequest(profile, renderedPrompt)
        └─ axios POST to baseURL/completions
```

## Configuring Profiles

### Example: OpenAI Profile (ChatML Format)

```json
{
  "profiles": {
    "openai-gpt4": {
      "type": "openai",
      "apiKey": "sk-xxx",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4",
      "template": "chatml",
      "sampler": {
        "temperature": 0.7,
        "topP": 0.9,
        "max_completion_tokens": 512
      }
    }
  }
}
```

### Example: Custom Profile (Alpaca Format)

```json
{
  "profiles": {
    "local-alpaca": {
      "type": "custom",
      "baseURL": "http://localhost:8000",
      "model": "alpaca-7b",
      "template": "alpaca",
      "sampler": {
        "temperature": 0.8,
        "topP": 0.95,
        "max_completion_tokens": 256
      }
    },
    "local-vicuna": {
      "type": "custom",
      "baseURL": "http://localhost:8000",
      "model": "vicuna-7b",
      "template": "vicuna"
    },
    "local-llama2": {
      "type": "custom",
      "baseURL": "http://localhost:5000",
      "model": "llama2-7b",
      "template": "llama2",
      "apiKey": "optional-bearer-token"
    }
  }
}
```

## Available Templates

### ChatML Format
- **Template File**: `backend/src/llm_templates/chatml.njk`
- **Use With**: `type: 'openai'`
- **Format**:
  ```
  <|im_start|>system
  Your system message<|im_end|>
  <|im_start|>user
  User message<|im_end|>
  <|im_start|>assistant
  Assistant response<|im_end|>
  ```
- **Models**: GPT-3.5, GPT-4, Claude, Mistral, etc.

### Alpaca Format
- **Template File**: `backend/src/llm_templates/alpaca.njk`
- **Use With**: `type: 'custom'`
- **Format**:
  ```
  Below is an instruction that describes a task. Write a response that appropriately completes the request.

  ### Instruction:
  Your system message

  ### Input:
  User message

  ### Response:
  Assistant response
  ```
- **Models**: Alpaca 7B/13B, OpenAssistant, etc.

### Vicuna Format
- **Template File**: `backend/src/llm_templates/vicuna.njk`
- **Use With**: `type: 'custom'`
- **Format**:
  ```
  Your system message

  USER: User message
  ASSISTANT: Assistant response
  ```
- **Models**: Vicuna 7B/13B/33B, etc.

### Llama2 Format
- **Template File**: `backend/src/llm_templates/llama2.njk`
- **Use With**: `type: 'custom'`
- **Format**:
  ```
  <s>[INST] <<SYS>>
  Your system message
  <</SYS>>

  User message [/INST] Assistant response </s>
  ```
- **Models**: Llama2-Chat 7B/13B/70B, etc.

## Using Custom LLM Endpoints

### With ollama

```bash
# Run ollama with the model
ollama run alpaca

# In config.json
{
  "profiles": {
    "ollama-alpaca": {
      "type": "custom",
      "baseURL": "http://localhost:11434/api",
      "model": "alpaca",
      "template": "alpaca"
    }
  }
}
```

### With vLLM

```bash
# Start vLLM server
python -m vllm.entrypoints.openai.api_server --model alpaca-7b

# In config.json
{
  "profiles": {
    "vllm-alpaca": {
      "type": "custom",
      "baseURL": "http://localhost:8000/v1",
      "model": "alpaca-7b",
      "template": "alpaca"
    }
  }
}
```

### With Text Generation WebUI (oobabooga)

```bash
# Server runs on localhost:5000 by default

# In config.json
{
  "profiles": {
    "textgen-alpaca": {
      "type": "custom",
      "baseURL": "http://localhost:5000",
      "model": "alpaca-7b",
      "template": "alpaca"
    }
  }
}
```

### With Kobold.cpp

```bash
# Start KoboldCPP
./koboldcpp.exe --port 5001

# In config.json
{
  "profiles": {
    "kobold": {
      "type": "custom",
      "baseURL": "http://localhost:5001",
      "model": "default",
      "template": "alpaca"
    }
  }
}
```

## Agent Implementation Guide

### For Agents Using OpenAI Profiles

The standard `callLLM()` method works as-is:

```typescript
class CharacterAgent extends BaseAgent {
  async run(context: AgentContext): Promise<string> {
    const systemPrompt = "You are a character...";
    const userMessage = context.userInput;
    
    // Internally:
    // 1. renderLLMTemplate() converts to ChatMessage[]
    // 2. callLLM() routes to OpenAI SDK
    const messages = this.renderLLMTemplate(systemPrompt, userMessage);
    const response = await this.callLLM(messages);
    
    return this.cleanResponse(response);
  }
}
```

### For Agents Using Custom Profiles

Use the new `callCustomLLM()` method:

```typescript
class CharacterAgent extends BaseAgent {
  async run(context: AgentContext): Promise<string> {
    const profile = this.getProfile();
    
    if (profile.type === 'custom') {
      // For custom profiles, use the new method
      const systemPrompt = "You are a character...";
      const userMessage = context.userInput;
      
      // This method:
      // 1. renderRawLLMTemplate() returns raw rendered string
      // 2. Uses customLLMRequest() with axios
      const response = await this.callCustomLLM(systemPrompt, userMessage);
      return this.cleanResponse(response);
    } else {
      // For openai profiles, use standard method
      const systemPrompt = "You are a character...";
      const userMessage = context.userInput;
      
      const messages = this.renderLLMTemplate(systemPrompt, userMessage);
      const response = await this.callLLM(messages);
      
      return this.cleanResponse(response);
    }
  }
}
```

### Profile-Aware Pattern

```typescript
async run(context: AgentContext): Promise<string> {
  const profile = this.getProfile();
  const systemPrompt = this.buildSystemPrompt(context);
  const userMessage = context.userInput;
  
  let response: string;
  
  if (profile.type === 'custom') {
    response = await this.callCustomLLM(systemPrompt, userMessage);
  } else {
    // type === 'openai'
    const messages = this.renderLLMTemplate(systemPrompt, userMessage);
    response = await this.callLLM(messages);
  }
  
  return this.cleanResponse(response);
}
```

## Agent-Specific Implementation Status

### Completed ✅
- BaseAgent: Core methods implemented
  - `renderLLMTemplate()` - Renders ChatML for OpenAI
  - `renderRawLLMTemplate()` - Renders raw for custom
  - `callLLM(messages)` - Routes OpenAI SDK
  - `callCustomLLM(system, user, assistant)` - Routes custom

### Agents Ready for Dual-Client
The following agents inherit from BaseAgent and can use both profile types by checking `profile.type`:
- CharacterAgent
- NarratorAgent
- DirectorAgent
- WorldAgent
- SummarizeAgent
- VisualAgent
- CreatorAgent

**Action Required**: Update each agent's `run()` method to handle both profile types using the pattern above.

## Sampler Settings

Both client types support sampler configuration:

```typescript
sampler?: {
  temperature?: number;           // 0.0-2.0, default 0.7
  topP?: number;                  // 0.0-1.0, default 0.9
  topK?: number;                  // Filter to top-k tokens
  max_completion_tokens?: number; // Max output length
  frequencyPenalty?: number;      // Penalize repeated tokens
  presencePenalty?: number;       // Penalize token presence
  stop?: string[];                // Stop sequences
  maxContextTokens?: number;      // Max context window
}
```

### OpenAI Client
- Passes sampler to OpenAI SDK
- Supported: temperature, topP, frequency_penalty, presence_penalty, max_tokens, stop

### Custom Client
- Passes sampler directly in axios POST body
- Field names follow common LLM API conventions:
  - `temperature` → `temperature`
  - `topP` → `top_p`
  - `max_completion_tokens` → `max_tokens`
  - `frequencyPenalty` → `frequency_penalty`
  - `presencePenalty` → `presence_penalty`

## Testing

Run the comprehensive test suite:

```bash
npm run test -- dual-client.test.ts
```

Test coverage includes:
- ✅ Template rendering for all formats (ChatML, Alpaca, Vicuna, Llama2)
- ✅ Custom axios client with sampler settings
- ✅ Response format handling (choices[], result, message.content)
- ✅ Bearer token authentication
- ✅ Error handling
- ✅ Profile type routing
- ✅ Template format integrity (no mixing of delimiters)

## Troubleshooting

### "callLLM() called with 'custom' profile type"

**Cause**: Agent is using `callLLM()` with a custom profile.

**Fix**: Update agent to use `callCustomLLM()` for custom profiles:
```typescript
if (profile.type === 'custom') {
  response = await this.callCustomLLM(systemPrompt, userMessage);
} else {
  response = await this.callLLM(this.renderLLMTemplate(systemPrompt, userMessage));
}
```

### "Template file not found"

**Cause**: Profile specifies a non-existent template.

**Fix**: Verify template name matches one of:
- `chatml` (for OpenAI)
- `alpaca` (for custom)
- `vicuna` (for custom)
- `llama2` (for custom)

Or check file exists at `backend/src/llm_templates/{templateName}.njk`

### Custom endpoint returns empty response

**Cause**: Endpoint expects different field names or response structure.

**Fix**: Check the LLM server's API documentation. The custom client supports:
- `response.data.choices[0].text` (completions format)
- `response.data.choices[0].message.content` (chat format)
- `response.data.result` (raw result field)

If none match, update `customClient.ts` response handling.

### Bearer token not included

**Cause**: `apiKey` not set in profile, or endpoint doesn't expect Bearer.

**Fix**: Add `apiKey` to profile:
```json
{
  "type": "custom",
  "apiKey": "your-token-here",
  "baseURL": "http://..."
}
```

Or remove `apiKey` if endpoint doesn't need it.

## Migration Path

If you have existing agents using only OpenAI:

1. **No changes required** for OpenAI profiles
   - Existing code continues to work
   - `callLLM()` and `renderLLMTemplate()` unchanged

2. **To add custom profile support** to an agent:
   - Add profile type check in `run()` method
   - Route to `callCustomLLM()` for `type: 'custom'`
   - Keep existing path for `type: 'openai'`

3. **In config.json**, add new profiles:
   ```json
   {
     "defaultProfile": "openai-gpt4",
     "profiles": {
       "openai-gpt4": { "type": "openai", ... },
       "local-alpaca": { "type": "custom", ... }
     }
   }
   ```

4. **Switch profiles** via LLM Config UI or directly in config.json

## Key Implementation Details

### Profile Type Routing (BaseAgent.callLLM)
```typescript
protected async callLLM(messages: ChatMessage[]): Promise<string> {
  const profile = this.getProfile();
  
  if (profile.type === 'custom') {
    throw new Error(`callLLM() called with 'custom' profile type...`);
  }
  
  // For 'openai' type
  return await chatCompletion(profile, messages);
}
```

### Custom Rendering (BaseAgent.renderRawLLMTemplate)
```typescript
protected renderRawLLMTemplate(system, user, assistant): string {
  const profile = this.getProfile();
  const templateName = profile.template || 'chatml';
  const template = fs.readFileSync(templatePath, 'utf-8');
  
  // Returns raw rendered string, no parsing
  return this.env.renderString(template, {
    system_prompt: system,
    user_message: user,
    assistant_message: assistant
  });
}
```

### Custom LLM Request (customClient.customLLMRequest)
```typescript
export async function customLLMRequest(
  profile: LLMProfile,
  renderedPrompt: string
): Promise<string> {
  const response = await axios.post(`${profile.baseURL}/completions`, {
    prompt: renderedPrompt,
    model: profile.model,
    temperature: profile.sampler?.temperature,
    // ... other sampler settings
  });
  
  // Handle various response formats
  return response.data.choices[0].text || response.data.result || '';
}
```

## Future Enhancements

- [ ] Vector embedding-based lore injection for custom profiles
- [ ] Streaming response support for custom clients
- [ ] Multi-turn conversation context management
- [ ] Model-specific sampler range validation
- [ ] Response quality scoring for fallback retry logic
- [ ] Template validation and hot-reloading
