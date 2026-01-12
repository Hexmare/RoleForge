# Discrepancies & Action Items

## Critical Discrepancies Between clientOverhaulStories.md and RoleForge Implementation

### 1. **Backend Support Mismatch**

**clientOverhaulStories.md Claims**:
> "Supports multiple LLM backends, including local setups like KoboldAI, TextGenerationWebUI (Oobabooga), and cloud services like OpenAI, Claude, OpenRouter, and others."

**RoleForge Reality**:
- ✓ OpenAI (native support)
- ✓ KoboldCPP (via OpenAI-compatible endpoint)
- ✓ Any OpenAI-compatible server
- ✗ Claude (no Anthropic SDK integration)
- ✗ OpenRouter (no native support, but might work if it supports OpenAI endpoint)
- ✗ TextGenerationWebUI (unless using OpenAI endpoint)
- ✗ LLaMA.cpp (native API not supported)

**Action**: Document this limitation and decide whether to implement backend adapters.

---

### 2. **Template System Incompleteness**

**clientOverhaulStories.md Describes**:
```json
{
  "system_prefix": "### Instruction:\n",
  "user_prefix": "### Input:\n",
  "assistant_prefix": "### Response:\n",
  "stop_sequence": ["### Instruction:", "### Input:"]
}
```
> "JSON files in `data/instruct-presets/` (e.g., `alpaca.json`, `vicuna.json`)"
> "Runtime Switching: When a new preset is selected, it updates the template object in memory"

**RoleForge Reality**:
- ✓ Has `profile.template` field in LLMProfile
- ✓ Loads templates as Nunjucks files (`.njk`)
- ✓ Only `chatml.njk` exists
- ✗ No JSON-based preset system
- ✗ No runtime template switching UI
- ✗ No stop_sequence handling
- ✗ renderLLMTemplate() doesn't use profile.template (hardcoded to chatml)

**Bug Found** in [backend/src/agents/BaseAgent.ts](backend/src/agents/BaseAgent.ts):
```typescript
protected renderLLMTemplate(systemPrompt: string, userMessage: string, assistantMessage: string = ''): ChatMessage[] {
  const profile = this.getProfile();
  const templateName = profile.template || 'chatml';  // Reads from profile BUT...
  const templatePath = path.join(..., `${templateName}.njk`);
  // This will fail if profile.template is anything other than 'chatml'
  // because only chatml.njk exists
}
```

**Action**: 
1. Create missing template files (alpaca.njk, vicuna.njk, etc.)
2. Verify path loading works for templates other than chatml
3. Document template format

---

### 3. **Model Switching Mechanism**

**clientOverhaulStories.md Describes**:
> "Model switching: In backend extensions, `getModelList()` fetches available models from the API (e.g., OpenAI's /v1/models). Users select a model, which updates params like max_tokens based on model capabilities."

**RoleForge Reality**:
- ✓ Can configure model in config.json
- ✗ No `/v1/models` API call to discover available models
- ✗ No frontend model selector
- ✗ No automatic parameter adjustment based on model capabilities
- ✗ No runtime model switching

**Action**: If needed, implement:
1. `/api/models` endpoint that queries configured backend
2. Frontend component for model selection
3. Parameter adjustment logic based on model context window

---

### 4. **Error Handling & Fallbacks**

**clientOverhaulStories.md Describes**:
> "Error Handling: Common to all backends, including retries, fallbacks (model fallback if primary fails), and logging."

**RoleForge Reality**:
- ✓ Good error logging
- ✗ No retry mechanism
- ✗ No model/profile fallback chains
- ✗ Errors are thrown and propagate

```typescript
// Current implementation in client.ts
catch (error: any) {
  console.error('LLM API call failed:', {...});
  throw error;  // No fallback
}
```

**Action**: 
1. Add `fallbackProfiles?: string[]` to LLMProfile
2. Implement retry with exponential backoff
3. Try fallback profiles if primary fails

---

### 5. **Task-Specific Handling**

**clientOverhaulStories.md Describes**:
> "Tasks use modular prompt builders. For example, for a summarization task in extensions/summarize/index.js: Override system prompt"
> "Tasks are handled by wrapping the base template with task-specific instructions"

**RoleForge Reality**:
- ✓ Different agents for different tasks (CharacterAgent, NarratorAgent, etc.)
- ✓ Different prompt templates per task (character.njk, narrator.njk, etc.)
- ✓ Per-task configuration in config.json agents section
- ✗ Not "extensions" but agent classes
- ✗ System prompt not "wrapped" but entirely replaced per task

**Status**: ✓ Functionally equivalent, just implemented differently (better for TypeScript)

---

### 6. **Prompt Component Assembly**

**clientOverhaulStories.md Describes**:
> "The PromptManager builds the full prompt by iterating through chat history and wrapping each message with the appropriate prefix/suffix"

**RoleForge Reality**:
- History formatting done in **Orchestrator.processUserInput()** before calling agents
- History passed to agent as pre-formatted strings in `context.history[]`
- Agent templates use `{% for msg in history %}{{ msg }}{% endfor %}`
- No dynamic wrapping; static template structure

**Status**: ✓ Functionally equivalent but organization differs (better separation of concerns in RoleForge)

---

### 7. **Streaming Implementation**

**clientOverhaulStories.md Context**:
> "Streaming: Supports token-by-token streaming for real-time chat updates"

**RoleForge Reality**:
- ✓ Streaming supported via OpenAI SDK async generator
- ✓ Real-time delivery via Socket.io events
- ✓ Works same as SillyTavern functionally
- Difference: Server-side streaming vs client-side (both valid)

**Status**: ✓ No discrepancy

---

### 8. **Frontend Configuration UI**

**clientOverhaulStories.md Implies**:
- Backend selector dropdown
- Model picker
- Template/preset selector
- Parameter tuning interface

**RoleForge Reality**:
- ✗ Zero frontend UI for LLM configuration
- ✓ Config.json approach is valid alternative
- ✓ ComfyUI modal shows UI is possible if needed

**Action**: Document that this is intentional design choice (config-file driven) or implement UI if user-facing configuration needed.

---

## Detailed Action Items

### **Must-Fix** (Blocks Functionality)

#### 1. Fix renderLLMTemplate() to actually use profile.template ⚠️

**File**: [backend/src/agents/BaseAgent.ts](backend/src/agents/BaseAgent.ts) line 185

**Issue**: Code reads `profile.template` but only `chatml.njk` exists. Selecting other templates will fail.

**Fix**:
```typescript
protected renderLLMTemplate(systemPrompt: string, userMessage: string, assistantMessage: string = ''): ChatMessage[] {
  const profile = this.getProfile();
  const templateName = profile.template || 'chatml';
  const templatePath = path.join(dirname(fileURLToPath(import.meta.url)), '..', 'llm_templates', `${templateName}.njk`);
  
  if (!fs.existsSync(templatePath)) {
    console.warn(`Template ${templateName}.njk not found, falling back to chatml`);
    // Add fallback logic
  }
  
  const template = fs.readFileSync(templatePath, 'utf-8');
  // ... rest of code
}
```

**Effort**: 30 minutes  
**Priority**: HIGH (potential runtime crash)

---

#### 2. Create missing template files

**Files Needed**:
- `backend/src/llm_templates/alpaca.njk`
- `backend/src/llm_templates/vicuna.njk`
- `backend/src/llm_templates/llama2.njk` (optional)

**Reference**: ChatML template format in chatml.njk

**Example for Alpaca**:
```njk
### Instruction:
{{system_prompt}}
### Input:
{{user_message}}
### Response:
{{assistant_message}}
```

**Effort**: 1-2 hours  
**Priority**: MEDIUM (enables fine-tuned model support)

---

#### 3. Document the template architecture

**What to Document**:
1. How templates work (placeholders, rendering)
2. How to create new templates
3. Template list and their use cases
4. Relationship between profile.template and file selection

**Effort**: 1 hour  
**Priority**: MEDIUM

---

### **Should-Fix** (Improves Robustness)

#### 4. Implement error fallback mechanism

**File**: [backend/src/llm/client.ts](backend/src/llm/client.ts)

**Change Required**:
1. Add `fallbackProfiles?: string[]` to LLMProfile interface
2. Modify chatCompletion() to try fallback on error
3. Add retry count tracking

**Effort**: 2-3 hours  
**Priority**: MEDIUM

---

#### 5. Add stop_sequence support

**File**: [backend/src/llm/client.ts](backend/src/llm/client.ts)

**Issue**: `profile.sampler.stop` is defined but may not be used correctly in all cases

**Verify**:
```typescript
stop: profile.sampler.stop,  // Does this work for all template types?
```

**Effort**: 1 hour (verify), 2 hours (if fixes needed)  
**Priority**: LOW

---

### **Nice-to-Have** (Polish)

#### 6. Add frontend LLM configuration UI

**Location**: New component `frontend/src/components/LLMConfigModal.tsx`

**Features**:
- Profile selector
- Model selector (if /api/models implemented)
- Template selector
- Parameter sliders

**Pattern**: Follow ComfyConfigModal structure

**Effort**: 8-16 hours  
**Priority**: LOW

---

#### 7. Implement backend adapter system

**File**: Refactor [backend/src/llm/client.ts](backend/src/llm/client.ts)

**Why**: Support Claude, Anthropic, etc.

**Approach**:
```typescript
// Create adapters/
interface BackendAdapter {
  chatCompletion(config: any, messages: ChatMessage[]): Promise<...>
}

// adapters/openai.ts
// adapters/anthropic.ts
// adapters/openrouter.ts

// client.ts
const adapter = getAdapter(profile.type);
return adapter.chatCompletion(profile, messages);
```

**Effort**: 2-3 days  
**Priority**: LOW (unless requested)

---

## Testing Checklist

### Template Testing
- [ ] Test with profile.template = 'chatml' (existing)
- [ ] Create alpaca.njk and test with profile.template = 'alpaca'
- [ ] Verify non-existent template gracefully falls back to chatml
- [ ] Verify stop sequences from template are respected

### Configuration Testing
- [ ] Create multiple profiles with different templates
- [ ] Verify agent overrides still work
- [ ] Test template reload without server restart (if implemented)

### Backend Testing
- [ ] Test with OpenAI API
- [ ] Test with KoboldCPP endpoint
- [ ] Verify error handling (API down, auth fail, etc.)

---

## Documentation Needs

### In README or ARCHITECTURE
1. Current backend support matrix
2. Template architecture and how to add new templates
3. Configuration hierarchy (profile → agent → sampler)
4. Streaming implementation overview
5. Limitations vs SillyTavern (backend variety, UI, etc.)

### In New Files
1. TEMPLATE_GUIDE.md - How to create/modify templates
2. BACKEND_SUPPORT.md - Current and planned backend support
3. ERROR_HANDLING.md - How errors are handled (current) and should be handled (planned)

---

## Decision Required From Team

### Q1: Should RoleForge support non-OpenAI backends?
- **A1a**: No (current) → Document as limitation
- **A1b**: Yes, immediately → Start adapter implementation now
- **A1c**: Yes, later → Add to roadmap

### Q2: Should templates be switchable via UI?
- **A2a**: No (current) → Document as config-only
- **A2b**: Yes, via config reload → Add 1-hour feature
- **A2c**: Yes, full UI → Plan 4-6 hour feature

### Q3: Should we implement per-generation parameter override?
- **A3a**: No (current) → Document as not supported
- **A3b**: Yes → Plan API endpoint + UI feature

### Q4: Should error fallback chains be implemented?
- **A4a**: No (not needed for current use cases)
- **A4b**: Yes, for robustness → Prioritize fix

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| **Must-Fix Issues** | 3 | Ready to implement |
| **Should-Fix Issues** | 2 | Planned |
| **Nice-to-Have Features** | 2 | Backlog |
| **Documentation Gaps** | 5 | Needs writing |
| **Decisions Needed** | 4 | Awaiting team input |

**Time to Fix All Must-Fixes**: ~2-3 hours  
**Time to Complete Should-Fixes**: ~3-4 hours  
**Time to Polish with Nice-to-Haves**: ~1-2 weeks
