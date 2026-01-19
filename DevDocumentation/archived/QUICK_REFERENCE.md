# Dual-Client LLM Architecture - Quick Reference

## Profile Types

| Type | Client | Use Case | Example |
|------|--------|----------|---------|
| `'openai'` | OpenAI SDK | ChatGPT, Claude, Mistral | `gpt-4`, `claude-opus` |
| `'custom'` | Axios | Local LLMs, any LLM API | `alpaca`, `llama2`, `vicuna` |

## Template Selection

| Template | Format | Use With | Models |
|----------|--------|----------|--------|
| `chatml` | ChatML delimiters | `type: 'openai'` | GPT-4, Claude, Mistral |
| `alpaca` | ### markers | `type: 'custom'` | Alpaca 7B/13B |
| `vicuna` | USER:/ASSISTANT: | `type: 'custom'` | Vicuna 7B/13B/33B |
| `llama2` | [INST] tags | `type: 'custom'` | Llama2 Chat 7B/13B/70B |

## Config Quick Setup

### OpenAI (gpt-4)
```json
{
  "type": "openai",
  "baseURL": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4",
  "template": "chatml"
}
```

### Local Alpaca (ollama)
```json
{
  "type": "custom",
  "baseURL": "http://localhost:11434/api",
  "model": "alpaca",
  "template": "alpaca"
}
```

### Local Llama2 (vLLM)
```json
{
  "type": "custom",
  "baseURL": "http://localhost:8000/v1",
  "model": "llama2-7b-chat",
  "template": "llama2"
}
```

## Common Endpoints

| Server | Base URL | Model |
|--------|----------|-------|
| ollama | `http://localhost:11434/api` | Model name from `ollama list` |
| vLLM | `http://localhost:8000/v1` | Full model path (e.g., `llama2-7b`) |
| TextGen WebUI | `http://localhost:5000` | Model name from dropdown |
| KoboldCPP | `http://localhost:5001` | `default` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4`, `gpt-3.5-turbo` |

## Agent Implementation

### Check Profile Type
```typescript
const profile = this.getProfile();
if (profile.type === 'custom') {
  // Use custom client
  response = await this.callCustomLLM(systemPrompt, userMessage);
} else {
  // Use OpenAI SDK
  const messages = this.renderLLMTemplate(systemPrompt, userMessage);
  response = await this.callLLM(messages);
}
```

## Sampler Settings

```json
"sampler": {
  "temperature": 0.7,           // 0.0-2.0
  "topP": 0.9,                  // 0.0-1.0
  "max_completion_tokens": 512, // output length
  "frequencyPenalty": 0.0,      // 0.0-2.0
  "presencePenalty": 0.0,       // 0.0-2.0
  "stop": ["###", "END"]        // stop sequences
}
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `callLLM() called with 'custom' profile type` | Using wrong method | Use `callCustomLLM()` for custom profiles |
| Template file not found | Invalid template name | Use: `chatml`, `alpaca`, `vicuna`, `llama2` |
| Empty response | Wrong endpoint format | Check API docs, may need different field names |
| Bearer token not sent | Missing apiKey | Add `"apiKey": "your-token"` to profile |

## Testing

```bash
# Run tests
npm run test -- dual-client.test.ts

# Expected: All tests pass ✅
```

## Files Reference

| File | Purpose |
|------|---------|
| [backend/src/llm/customClient.ts](backend/src/llm/customClient.ts) | Axios-based custom LLM client |
| [backend/src/agents/BaseAgent.ts](backend/src/agents/BaseAgent.ts) | Core agent with dual routing |
| [backend/src/llm_templates/](backend/src/llm_templates/) | LLM prompt templates |
| [DUAL_CLIENT_GUIDE.md](DUAL_CLIENT_GUIDE.md) | Complete implementation guide |
| [backend/config.example.json](backend/config.example.json) | Example configuration |

## Architecture at a Glance

```
Profile (config.json)
    ↓
profile.type === ?
    ├─ 'openai'  → renderLLMTemplate() → callLLM() → OpenAI SDK
    └─ 'custom'  → renderRawLLMTemplate() → callCustomLLM() → axios
```

## Key Methods

| Method | Input | Output | Use For |
|--------|-------|--------|---------|
| `renderLLMTemplate()` | system, user, assistant | `ChatMessage[]` | OpenAI profiles |
| `renderRawLLMTemplate()` | system, user, assistant | `string` | Custom profiles |
| `callLLM()` | `ChatMessage[]` | `string` | OpenAI profiles |
| `callCustomLLM()` | system, user, assistant | `string` | Custom profiles |
| `customLLMRequest()` | profile, renderedPrompt | `string` | Direct custom client use |

## Next Steps

1. Choose LLM: OpenAI API or local model?
2. Select profile type: `'openai'` or `'custom'`?
3. Pick template: `chatml`, `alpaca`, `vicuna`, or `llama2`?
4. Add to config.json under `"profiles"`
5. Set as `defaultProfile` or per-agent in `"agents"`
6. Update agents to check `profile.type` in their `run()` method
7. Test with `npm run test -- dual-client.test.ts`

## Pro Tips

💡 **Mix and match**: Have both OpenAI and local LLMs configured - switch anytime
💡 **Per-agent profiles**: Different agents can use different profiles (agent overrides in config)
💡 **Sampler tuning**: Each profile can have different temperature/topP for different agents
💡 **Fallbacks**: Use `fallbackProfiles` array to automatically retry on failure
💡 **Bearer tokens**: Some custom endpoints need `apiKey` with Bearer auth

## Common Configurations

### Development (Local + OpenAI)
```json
{
  "defaultProfile": "openai-gpt4",
  "profiles": {
    "openai-gpt4": { "type": "openai", ... },
    "local-alpaca": { "type": "custom", ... }
  }
}
```

### Production (Multiple Local Models)
```json
{
  "defaultProfile": "local-llama2",
  "profiles": {
    "local-llama2": { "type": "custom", "model": "llama2-7b" },
    "local-alpaca": { "type": "custom", "model": "alpaca-7b" }
  }
}
```

### Mixed (Local Fallback)
```json
{
  "profiles": {
    "openai-primary": {
      "type": "openai",
      "fallbackProfiles": ["local-alpaca"]
    },
    "local-alpaca": { "type": "custom" }
  }
}
```
