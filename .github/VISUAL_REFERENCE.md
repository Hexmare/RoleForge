# Visual Reference: RoleForge vs SillyTavern LLM Client

## Architecture Comparison Diagram

### SillyTavern Model (clientOverhaulStories.md)
```
┌─────────────────────────────────────────────────────┐
│                    Browser/Frontend                 │
│  ┌───────────────────────────────────────────────┐  │
│  │  User Interface                               │  │
│  │  - Backend selector dropdown                  │  │
│  │  - Model picker                               │  │
│  │  - Template preset selector                   │  │
│  │  - Parameter sliders                          │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│              Node.js Proxy Server (server.js)       │
│  Handles CORS, proxies requests                     │
└─────────────────┬──────────────────────────────────┘
                  │
      ┌───────────┼───────────┬──────────────┐
      ▼           ▼           ▼              ▼
┌──────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐
│ OpenAI   │ │KoboldAI │ │Claude  │ │OpenRouter│
│Extension │ │Extension│ │Ext.    │ │Extension │
│          │ │         │ │        │ │          │
│getSettings
│generate()│ │generate()
│getModels │ │getModels()
│          │ │getModels()
│          │ │
└──────────┘ └─────────┘ └────────┘ └──────────┘
```

### RoleForge Current Model
```
┌─────────────────────────────────────────────────────┐
│              React Frontend                         │
│  - Chat interface                                   │
│  - Character/World managers                         │
│  ✗ NO LLM config UI                                │
└─────────────────┬──────────────────────────────────┘
                  │
       Socket.io (Real-time)
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│          Node.js Express Server                     │
│  ┌─────────────────────────────────────────────┐   │
│  │          Orchestrator.ts                     │   │
│  │  - Coordinates agents                        │   │
│  │  - Manages context/history                   │   │
│  └─────────────────────────────────────────────┘   │
│           ▼                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ Character   │ Narrator │ Director │ World   │   │
│  │ Agent       │ Agent    │ Agent    │ Agent   │   │
│  │ (BaseAgent extends)                        │   │
│  └─────────────────────────────────────────────┘   │
│           ▼                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │  LLM Client (client.ts)                     │   │
│  │  - OpenAI SDK wrapper                       │   │
│  │  - ✗ NO other backends                      │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────┬──────────────────────────────────┘
                  │
          ┌───────┴────────┐
          ▼                ▼
    ┌──────────────┐  ┌──────────────┐
    │ OpenAI API   │  │KoboldCPP     │
    │ (native)     │  │(OpenAI compat)
    │              │  │              │
    └──────────────┘  └──────────────┘
```

---

## Feature Comparison Matrix

```
FEATURE                          SILLY TAVERN      ROLEFORGE         STATUS
─────────────────────────────────────────────────────────────────────────────
Backend Types                    20+               1 (OpenAI-compat) ✗
└─ OpenAI                        ✓                 ✓                 ✓
└─ Claude/Anthropic              ✓                 ✗                 ✗
└─ KoboldAI/CPP                  ✓                 ✓ (via endpoint)  ✓
└─ OpenRouter                    ✓                 ✗ (workaround)    ✗

Template Types                   Multiple JSON     Multiple .njk     ⚠️
└─ ChatML                        ✓                 ✓                 ✓
└─ Alpaca                        ✓                 ✗ (code ready)    ⚠️
└─ Vicuna                        ✓                 ✗ (code ready)    ⚠️
└─ Llama2                        ✓                 ✗ (code ready)    ⚠️

Runtime Switching                UI Dropdown       Config reload     ✗
Model Discovery                  API (/v1/models)  ✗                 ✗
Frontend Config UI               Full              ✗                 ✗

Task Agents                      Extensions        Classes           ✓
Prompt Templating                Manual builder    Nunjucks (better) ✓
Context Trimming                 Implicit          Smart trimming    ✓
Streaming                        Browser           Via Socket.io     ✓
JSON Responses                   Supported         Supported         ✓
Error Fallback                   Chains            ✗                 ✗
Retry Logic                      ✓                 ✗                 ✗
```

---

## Configuration Hierarchy

### SillyTavern (Not explicit in spec, inferred)
```
Extension Defaults
       ▲
       └─── User Settings (UI)
            └─── Per-Generation Overrides
```

### RoleForge
```
┌─────────────────────────────────────────┐
│      Default Sampler Settings           │
│   (built into sampler definitions)      │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│   Global Profile (config.json)          │
│   profiles.default.sampler              │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│   Agent Override (config.json)          │
│   agents.character.sampler              │
│   (merges with profile sampler)         │
└──────────────────┬──────────────────────┘
                   ▼
          Final Settings Used
    (profile + agent override)
```

---

## Template System Comparison

### SillyTavern JSON Preset
```json
{
  "name": "alpaca",
  "system_prefix": "### Instruction:\n",
  "system_suffix": "\n",
  "user_prefix": "### Input:\n",
  "user_suffix": "\n",
  "assistant_prefix": "### Response:\n",
  "assistant_suffix": "\n",
  "stop_sequence": ["### Instruction:", "### Input:"]
}
```
Runtime: User selects → Wraps all messages with prefixes/suffixes

### RoleForge Nunjucks Template
```njk
<|im_start|>system
{{system_prompt}}<|im_end|>
<|im_start|>user
{{user_message}}<|im_end|>
<|im_start|>assistant
{{assistant_message}}<|im_end|>
```
Runtime: Profile specifies template name → Loads `.njk` file → Renders

**Difference**: 
- SillyTavern: Data-driven (JSON structure wrapped procedurally)
- RoleForge: Template-driven (Nunjucks renders directly)

Both approaches are valid; RoleForge is more declarative.

---

## Context Building Process

### SillyTavern (Inferred from spec)
```
User Input
    ▼
PromptManager.buildPrompt()
    │
    ├─ Add system prompt
    ├─ Add World Info (triggered by keywords)
    ├─ Add character card
    ├─ Add chat history (wrapped per template)
    ├─ Add user input
    ├─ Add author's note (if configured)
    └─ Add jailbreak (if configured)
    ▼
Trim by token budget (if max context set)
    ▼
Apply template wrapping (template.system_prefix, etc.)
    ▼
Send to backend
```

### RoleForge
```
User Input
    ▼
Orchestrator.processUserInput()
    │
    ├─ Format history into history[]
    ├─ Call LorebookService.getLoreContext()
    ├─ Match lore entries (keyword matching)
    ├─ Build AgentContext object
    │   {history, formattedLore, character, worldState, ...}
    │
    └─ Call DirectorAgent
         │
         ├─ Call renderTemplate('director', context)
         │   └─ Renders director.njk with context
         │
         ├─ Call renderLLMTemplate(systemPrompt, userMessage)
         │   └─ Loads llm_templates/{profile.template}.njk
         │   └─ Renders with {{system_prompt}}, {{user_message}}
         │
         └─ Call chatCompletion(profile, messages)
              │
              ├─ Trim messages to maxContextTokens
              └─ Send to LLM API
```

---

## Error Handling Flow

### SillyTavern (Implied)
```
Try Primary Model
    ▼
  Fail?
    ├─ YES: Log error
    │       Try Fallback Model 1
    │           ▼
    │         Fail?
    │           ├─ YES: Try Fallback Model 2
    │           │       ...
    │           └─ NO: Success ✓
    │
    └─ NO: Success ✓
```

### RoleForge Current
```
Try LLM API
    ▼
  Error?
    ├─ YES: Log error
    │       throw error ✗
    │       (Orchestrator catches, emits error event)
    │
    └─ NO: Success ✓
```

**Issue**: No recovery mechanism

---

## Template File Organization

### SillyTavern
```
data/
├─ instruct-presets/
│  ├─ alpaca.json
│  ├─ vicuna.json
│  ├─ llama2.json
│  ├─ chatml.json
│  └─ ...
```
**Selection**: User picks from dropdown → loads JSON → applies at runtime

### RoleForge Current
```
backend/src/
├─ llm_templates/
│  └─ chatml.njk          (ONLY ONE!)
└─ prompts/
   ├─ character.njk       (task-specific)
   ├─ narrator.njk        (task-specific)
   ├─ director.njk        (task-specific)
   └─ ...
```
**Selection**: Profile specifies `template: "chatml"` → loads chatml.njk → renders

**Missing**:
```
backend/src/llm_templates/
├─ chatml.njk
├─ alpaca.njk           ← NEEDED
├─ vicuna.njk           ← NEEDED
├─ llama2.njk           ← NEEDED
└─ ...
```

---

## Backend Selector Flow

### SillyTavern
```
User clicks backend dropdown
    ▼
Select "Claude"
    ▼
Load extensions/claude/index.js dynamically
    ▼
Call getSettings() → get default params
    ▼
Call getModelList() → query Anthropic API
    ▼
Display available models
    ▼
User selects model
    ▼
generate(prompt, model) is called
```

### RoleForge Current
```
Edit config.json
    ▼
Set defaultProfile: "openai"
    ▼
Set profiles.openai.baseURL: "..."
    ▼
Server reads config.json on startup
    ▼
Hardcoded OpenAI SDK used
    ▼
Only OpenAI-compatible backends work
```

**No Dynamic Discovery**: Would need `/api/models` endpoint

---

## Critical Issues Visualization

### Issue 1: Missing Template Files
```
config.json says:
  "template": "alpaca"
       ▼
BaseAgent.renderLLMTemplate() tries:
  llm_templates/alpaca.njk
       ▼
File NOT FOUND ✗
       ▼
Runtime Error
```

**Fix**: Create alpaca.njk, vicuna.njk, etc.

### Issue 2: No Error Recovery
```
LLM API Call Fails
       ▼
console.error('...')
       ▼
throw error ✗
       ▼
User sees error, no retry
       ▼
Session breaks
```

**Fix**: Implement fallback profiles, retry logic

### Issue 3: No Backend Support
```
Want to use Claude:
       ▼
Configure baseURL to Claude API
       ▼
OpenAI SDK can't handle Claude API format
       ▼
LLM call fails ✗
```

**Fix**: Implement backend adapter pattern (significant effort)

---

## Feature Implementation Roadmap

```
Current (NOW)
├─ ✓ OpenAI-compatible
├─ ✓ ChatML template
├─ ✓ Streaming
├─ ✓ Token trimming
└─ ✓ Agent system

Phase 1 (2-3 hours) 🚀
├─ ✓ Create template files
├─ ✓ Fix template loading
├─ ✓ Document templates
└─ ✓ Add error handling

Phase 2 (3-4 hours)
├─ □ Retry logic
├─ □ Fallback chains
└─ □ Error tests

Phase 3 (1-2 weeks)
├─ □ Frontend config UI
├─ □ Model discovery
└─ □ Parameter UI

Phase 4 (2-3 days, optional)
├─ □ Backend adapters
├─ □ Claude support
└─ □ OpenRouter support
```

---

## Decision Tree

```
Do we need Claude/Anthropic support?
    │
    ├─ NO
    │   └─ Document OpenAI-only limitation
    │       └─ Fix templates (2-3 hours)
    │           └─ DONE
    │
    └─ YES
        ├─ Now? → Implement adapters (2-3 days)
        │
        └─ Later? → Add to roadmap, fix templates first
```

```
Should templates be UI-switchable?
    │
    ├─ NO (current)
    │   └─ Keep config-file approach
    │       └─ Document it
    │
    └─ YES
        ├─ Via config reload? (1 hour)
        │
        └─ Via UI? (4-6 hours)
            └─ Create LLMConfigModal component
```

---

## Code Diff: Where Changes Needed

```
CRITICAL CHANGES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: backend/src/agents/BaseAgent.ts
Line: 185

Current:
  const templateName = profile.template || 'chatml';
  const templatePath = path.join(..., `${templateName}.njk`);
  
Issue: Only chatml.njk exists; others fail silently or crash

Fix: Add file existence check + fallback

─────────────────────────────────────────────────────

Files Needed: backend/src/llm_templates/
  ✓ chatml.njk        (EXISTS)
  ✗ alpaca.njk        (NEEDED)
  ✗ vicuna.njk        (NEEDED)
  ✗ llama2.njk        (OPTIONAL)

─────────────────────────────────────────────────────

File: backend/src/llm/client.ts
Line: ~125 (catch block)

Current:
  catch (error) {
    console.error(...);
    throw error;  // No recovery
  }

Fix: Implement fallback profile retry

─────────────────────────────────────────────────────

Optional: backend/src/llm/client.ts
Add backend adapter pattern:
  - Create backends/openai.ts
  - Create backends/anthropic.ts
  - Route through adapters in client.ts
```

---

## Success Criteria Checklist

After implementing fixes:

- [ ] Templates can be switched via profile.template
- [ ] Other templates (Alpaca, Vicuna) work correctly
- [ ] Error with primary backend triggers fallback
- [ ] Retry logic implements exponential backoff
- [ ] All tests pass
- [ ] Documentation complete
- [ ] No breaking changes

---

End of Visual Reference  
See README_LLM_ANALYSIS.md for document navigation
