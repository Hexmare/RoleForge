# LLM Configuration UI Guide

## Overview

The LLM Configuration UI provides a graphical interface for managing LLM backend connections, profiles, sampler settings, and agent-to-profile mappings without editing JSON files directly.

## Accessing the UI

Click the **🤖** (robot) icon in the top navigation bar to open the LLM Configuration modal.

## Features

### 1. Profile Management Tab

Manage all LLM backend profiles (OpenAI-compatible, Kobold, etc.).

**Default Profile Selector:**
- Select which profile agents use by default
- Agents can override this per-agent

**Add New Profile:**
- Profile name (e.g., "openai", "local-mistral")
- Profiles appear as expandable cards below

**Profile Card (Expandable):**
- **Base URL**: API endpoint (e.g., http://localhost:5001/v1)
- **Model**: Model name/identifier
- **API Key**: Optional; leave empty for local backends
- **Template**: Message format (chatml, alpaca, vicuna, llama2)

**Sampler Settings (within each profile):**
- Temperature: 0-2 (higher = more creative)
- Top P: 0-1 (nucleus sampling)
- Max Completion Tokens: Max response length
- Max Context Tokens: Context window size
- Frequency Penalty: Penalize repeated tokens
- Presence Penalty: Penalize new tokens
- Stop Sequences: Strings where generation stops

**Fallback Profiles:**
- Comma-separated list of profile names to try if this profile fails
- Provides automatic failover capability

**Delete Profile:**
- Remove profile from configuration

### 2. Agent Mapping Tab

Assign LLM profiles to individual agents and configure per-agent sampler overrides.

**Available Agents:**
- narrator
- character
- director
- world
- summarize
- visual
- creator

**For Each Agent:**
- **Profile Dropdown**: Select which profile this agent uses (defaults to "default")
- **Sampler Overrides**: Optional per-agent customizations
  - Leave fields empty to use profile defaults
  - Supported overrides:
    - max_completion_tokens
    - temperature

## API Endpoints

All configuration changes are persisted via REST API:

```
GET  /api/llm/config              → Retrieve full configuration
POST /api/llm/config              → Update entire configuration
GET  /api/llm/profiles            → List all profiles
POST /api/llm/profiles            → Create new profile
PUT  /api/llm/profiles/:name      → Update existing profile
DELETE /api/llm/profiles/:name    → Delete profile
GET  /api/llm/templates           → List available templates
```

## Configuration Persistence

- All changes are saved to `backend/config.json`
- Config manager reloads automatically after each save
- Changes take effect immediately for new chat interactions

## Example Workflow

1. **Open LLM Config UI**: Click 🤖 button
2. **Navigate to Profiles Tab**
3. **Add New Profile**:
   - Name: "mistral-local"
   - Base URL: "http://192.168.88.88:5001/v1"
   - Model: "mistralai/Mistral-7B-Instruct-v0.2"
   - Template: "chatml"
4. **Set Sampler Settings**:
   - Temperature: 0.7
   - Top P: 0.9
   - Max Tokens: 512
5. **Switch to Agent Mapping Tab**
6. **Assign Profile to Agent**:
   - narrator: "mistral-local"
   - character: "mistral-local"
7. **Save**: Click "Save Configuration" button
8. **Verify**: Check backend logs for successful reload

## Troubleshooting

**Profile appears but backend not responding:**
- Check Base URL format (should be http://host:port/v1 for OpenAI-compatible)
- Verify backend is running (e.g., KoboldCPP, Ollama)
- Test connection manually: `curl http://host:port/v1/models`

**Changes not taking effect:**
- Ensure "Save Configuration" button was clicked
- Check browser console for API errors
- Verify backend logs for config reload confirmation

**Can't select profile for agent:**
- Ensure at least one profile exists
- Default profile must be set to a valid profile name

## File Structure

**Frontend Component:**
```
frontend/src/components/LLMConfigModal.tsx
  - Main modal container with tabs
  - ProfileCard subcomponent for profile management
  - SamplerForm subcomponent for settings
  - SamplerOverrides subcomponent for per-agent tuning
```

**Backend API:**
```
backend/src/server.ts (lines 1037-1180)
  - GET/POST /api/llm/config
  - CRUD endpoints for profiles
  - Template list endpoint
```

**Configuration File:**
```
backend/config.json
  - defaultProfile: string (name of default profile)
  - profiles: Record<name, LLMProfile>
  - agents: Record<agentName, { llmProfile: string; sampler?: {} }>
```

## Type Definitions

```typescript
interface LLMProfile {
  type: string;                    // 'openai', 'kobold', etc.
  baseURL: string;
  apiKey?: string;
  model?: string;
  template?: string;               // 'chatml', 'alpaca', etc.
  sampler?: {
    temperature?: number;
    topP?: number;
    max_completion_tokens?: number;
    maxContextTokens?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
  };
  fallbackProfiles?: string[];
}

interface LLMConfig {
  defaultProfile: string;
  profiles: Record<string, LLMProfile>;
  agents: Record<string, {
    llmProfile: string;
    sampler?: Record<string, any>;
  }>;
}
```

## Best Practices

1. **Start with one profile**: Create and test one working profile before adding more
2. **Use meaningful names**: Profile names like "openai-gpt4" are better than "profile1"
3. **Set fallback profiles**: Add fallback profiles for redundancy
4. **Document your setup**: Add notes about each profile's purpose in your own workflow
5. **Test agent responses**: After configuration changes, send a test message to verify the agent responds correctly

## Integration with Chat

After configuring profiles:
1. Agents will use their assigned profiles for all LLM calls
2. If a profile fails, fallback profiles are automatically tried
3. Sampler settings from agent overrides take precedence over profile defaults
4. Per-agent customizations enable fine-tuning behavior (e.g., narrator more creative than director)
