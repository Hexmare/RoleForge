# Quick Reference: Key Clarifications

## Most Important Findings

### 1. **Fundamental Architecture Difference**
- **SillyTavern (clientOverhaulStories.md)**: Client-side heavy, extension-based, dynamically loaded plugins
- **RoleForge Current**: Server-side, agent-based classes, configuration-driven
- **Implication**: clientOverhaulStories.md is NOT a migration guide; it's inspiration only

### 2. **LLM Client Limitation** ⚠️
- **SillyTavern**: Supports 20+ backends (OpenAI, Claude, Anthropic, KoboldAI, etc.)
- **RoleForge**: Only supports OpenAI-compatible APIs (hardcoded OpenAI SDK)
- **Workaround**: Can run KoboldCPP with OpenAI endpoint, but not native Claude, Cohere, etc.
- **Fix Required**: Implement adapter layer in `client.ts` to support multiple backend types

### 3. **Template System is Incomplete** ⚠️
- **SillyTavern**: Supports multiple template presets (Alpaca, Vicuna, ChatML, etc.) with runtime switching
- **RoleForge**: Only has `chatml.njk` template; runtime switching logic doesn't exist
- **Fix Required**:
  1. Create additional template files (alpaca.njk, vicuna.njk, etc.)
  2. Implement template loading in `BaseAgent.renderLLMTemplate()`
  3. Optionally add UI for template selection

### 4. **No Frontend LLM Configuration UI**
- **SillyTavern**: Full settings UI for backend selection, model picking, template switching, parameter tuning
- **RoleForge**: Zero LLM configuration in frontend; only config.json editing
- **Status**: Low priority but nice-to-have for user experience

### 5. **Error Handling is Minimal** ⚠️
- **SillyTavern**: Fallback chains, retry logic, model switching on failure
- **RoleForge**: Errors thrown, no recovery mechanism
- **Fix Recommended**: Add fallback profile support and retry logic

---

## Feature Status Matrix

| Feature | Implemented | Works Well | Documented | Missing |
|---------|-----------|-----------|-----------|---------|
| OpenAI-compatible API | ✓ | ✓ | ✓ | - |
| KoboldCPP support | ✓ | ✓ | ✓ | - |
| Other backends (Claude, etc.) | ✗ | - | - | ⚠️ |
| Streaming responses | ✓ | ✓ | ✓ | - |
| ChatML template | ✓ | ✓ | ✓ | - |
| Other templates (Alpaca, etc.) | ✗ | - | - | ⚠️ |
| Runtime template switching | ✗ | - | - | ⚠️ |
| Task-specific agents | ✓ | ✓ | ✓ | - |
| Nunjucks prompt templating | ✓ | ✓ | ✓ | - |
| Context trimming by tokens | ✓ | ✓ | ✓ | - |
| JSON response format support | ✓ | ✓ | ✓ | - |
| Parameter merging (profile→agent) | ✓ | ✓ | ✓ | - |
| Dynamic model discovery | ✗ | - | - | - |
| Model fallback chains | ✗ | - | - | - |
| Frontend model selector | ✗ | - | - | - |
| Frontend template picker | ✗ | - | - | - |
| Per-generation param override | ✗ | - | - | - |

---

## Code Organization Comparison

### SillyTavern Pattern
```
public/scripts/extensions/
├── openai/
│   └── index.js          (implements standard interface)
├── kobold/
│   └── index.js
├── claude/
│   └── index.js
└── ...
```
- Each backend = separate extension
- Standard interface: `getSettings()`, `generate()`, `getModelList()`
- Dynamic loading based on user selection

### RoleForge Pattern
```
backend/src/agents/
├── BaseAgent.ts          (abstract base class)
├── CharacterAgent.ts
├── NarratorAgent.ts
├── DirectorAgent.ts
└── ...

backend/src/llm/
└── client.ts             (unified LLM interface)

backend/src/prompts/
├── character.njk
├── narrator.njk
├── director.njk
└── ...
```
- Each agent = separate class extending BaseAgent
- Single LLM client with profile-based configuration
- Task variation through template selection

---

## Configuration Deep Dive

### What DOES Work
```json
{
  "profiles": {
    "openai": {
      "baseURL": "http://localhost:5001/v1",
      "model": "koboldcpp/...",
      "template": "chatml",
      "sampler": {
        "temperature": 0.8,
        "maxContextTokens": 2048
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
- ✓ Profile-based configuration
- ✓ Agent-level overrides
- ✓ Hierarchical merging
- ✓ Per-agent temperature, tokens, penalties

### What DOESN'T Work
```json
{
  "templates": ["alpaca", "vicuna", "llama2"],  // NOT parsed
  "fallbackProfiles": ["openai", "backup"],     // NOT implemented
  "backends": ["claude", "anthropic"]           // NOT supported
}
```
- ✗ Template switching requires code change
- ✗ No fallback mechanism
- ✗ No non-OpenAI backends

---

## Quick Start for Clarifications

### If someone asks about templating...
- "RoleForge uses Nunjucks templates for prompts (better than JSON), but only supports ChatML format."
- "To support Alpaca/Vicuna/Llama2 templates, create `.njk` files and implement selector logic."

### If someone asks about backends...
- "RoleForge currently only supports OpenAI-compatible APIs (works with KoboldCPP)."
- "Claude, Anthropic, and other backends would require adapter layer refactoring."

### If someone asks about configuration UI...
- "All config is in config.json; no frontend UI yet."
- "Could follow ComfyUI modal pattern if needed."

### If someone asks about error handling...
- "Errors are logged and thrown; no automatic fallback."
- "Could implement profile fallback chains with moderate effort."

---

## Recommended Next Steps

### Priority 1: Template System (Easy, High Value)
1. Create `alpaca.njk`, `vicuna.njk`, `llama2.njk` templates
2. Update `BaseAgent.renderLLMTemplate()` to load from profile.template
3. Document template structure

**Effort**: 2-4 hours  
**Benefit**: Unlock fine-tuned model support

### Priority 2: Error Handling (Medium, Medium Value)
1. Add `fallbackProfiles` to LLMProfile interface
2. Implement retry logic with exponential backoff
3. Fall through to next profile on failure

**Effort**: 4-6 hours  
**Benefit**: Robustness and reliability

### Priority 3: Backend Adapters (Hard, Low-Medium Value)
1. Create adapter interface for backend types
2. Implement Claude adapter (use Anthropic SDK)
3. Implement OpenRouter adapter
4. Route through adapters in client.ts

**Effort**: 1-2 days  
**Benefit**: Flexibility and feature parity

---

## Files to Reference

### Key Documents
- [COMPARISON_AND_CLARIFICATIONS.md](.github/COMPARISON_AND_CLARIFICATIONS.md) - Full detailed comparison
- [roleforgearchitecture.md](.github/roleforgearchitecture.md) - Current architecture
- [clientOverhaulStories.md](.github/clientOverhaulStories.md) - SillyTavern inspiration (NOT spec)

### Key Code Files
- [backend/src/llm/client.ts](backend/src/llm/client.ts) - LLM interface (single backend supported)
- [backend/src/agents/BaseAgent.ts](backend/src/agents/BaseAgent.ts) - Agent base with template rendering
- [backend/src/llm_templates/chatml.njk](backend/src/llm_templates/chatml.njk) - Only template (ChatML)
- [backend/config.json](backend/config.json) - Configuration structure
- [backend/src/configManager.ts](backend/src/configManager.ts) - Config loading and profile merging

---

## Decision Matrix

### Decision: Should we add Claude/Anthropic support?

| Option | Pros | Cons | Timeline |
|--------|------|------|----------|
| **Not needed** | Simple, focused | Limits user choice | - |
| **Later** | Priority flexibility | Technical debt | When requested |
| **Now** | Complete feature set | Effort required | 2-3 days |

### Decision: Should templates be switchable at runtime?

| Option | Pros | Cons | Timeline |
|--------|------|------|----------|
| **Config only** | Simple, current state | Requires restart | - |
| **Via config reload** | No code change needed | Only per-profile | 1 hour |
| **Via frontend UI** | User-friendly | Requires UI | 4-6 hours |

### Decision: Should we implement frontend LLM config?

| Option | Pros | Cons | Timeline |
|--------|------|------|----------|
| **No** | Simple, config-driven | Poor UX | - |
| **Partial** | Model selector only | Doesn't solve all needs | 2-3 hours |
| **Full** | Parity with SillyTavern | Significant effort | 1-2 weeks |

