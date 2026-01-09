# agent-design.md

## Overview

RoleForge's multi-agent system is directly inspired by Talemate's architecture but implemented entirely in TypeScript/Node.js. The goal is to separate concerns (narration, dialogue, world consistency, story direction, summarization, visual generation, and creation) so that each aspect of the roleplay can be tuned independently and, crucially, can use different LLM backends or models via **per-agent LLM profiles**.

All agents inherit from a `BaseAgent` class, render their prompts using **Nunjucks** templates (`.njk` files), and call the LLM through a unified client that resolves the correct connection profile at runtime.

## Connection Profiles – Core Configuration

Connection details are stored in `config.json` (or optionally YAML). This allows:

- A **system-wide default profile**
- **Per-agent overrides** (use default or a specific named profile)

### Example config.json snippet
```json
{
  "defaultProfile": "kobold-local",
  "profiles": {
    "openai-gpt4o": {
      "type": "openai",
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-4o",
      "temperature": 0.7,
      "maxTokens": 800
    },
    "kobold-local": {
      "type": "kobold",
      "baseURL": "http://localhost:5001/api",
      "model": "default",
      "temperature": 0.8,
      "maxTokens": 400,
      "extraParams": { "rep_pen": 1.15 }
    },
    "cheap-summary": {
      "type": "openai",
      "baseURL": "http://localhost:8000/v1",
      "apiKey": "none",
      "model": "mistral-7b",
      "temperature": 0.3,
      "maxTokens": 300
    }
  },
  "agents": {
    "narrator":   { "llmProfile": "default" },
    "character":  { "llmProfile": "default" },
    "director":   { "llmProfile": "default" },
    "world":      { "llmProfile": "default" },
    "summarize":  { "llmProfile": "cheap-summary" },
    "visual":     { "llmProfile": "default" },
    "creator":    { "llmProfile": "default" }
  }
}
```

The `ConfigManager` class resolves the correct profile for each agent at runtime.

## Agent List, Intention, and Templates

All templates live in `backend/src/prompts/`. Context variables (history, userInput, worldState, etc.) are injected by the Orchestrator before rendering.

### 1. NarratorAgent
**Intention**: Produces immersive third-person descriptive narration. Primary storytelling voice.

**File**: `narratorAgent.ts`  
**Template**: `narrator.njk`
```njk
You are the Narrator in an immersive roleplaying story. Write vivid, third-person narration only. 
Do not put dialogue in quotes unless it comes from an NPC (handled separately).

Current scene summary: {{ sceneSummary | default("None") }}
World lore entries:
{% for entry in lore %}- {{ entry }}{% endfor %}

Recent events (last 5 exchanges):
{% for msg in history.slice(-5) %}{{ msg }}{% endfor %}

User's latest action: {{ userInput }}

{% if directorGuidance %}
Direction to follow: {{ directorGuidance }}
{% endif %}

Describe what happens next in a natural, engaging way while staying perfectly consistent with established facts.
Keep response length 150–300 words unless otherwise instructed.

{% if visualOpportunity %}
[GEN_IMAGE: {{ visualPrompt }}]
{% endif %}
```

### 2. CharacterAgent
**Intention**: Handles dialogue and actions for individual NPCs. One instance per active character.

**File**: `characterAgent.ts` (instantiated dynamically per character ID)  
**Template**: `character.njk`
```njk
You are {{ character.name }}, {{ character.description }}.
Personality traits: {{ character.personality | join(", ") }}

Speak ONLY as {{ character.name }}. Use natural first-person dialogue inside quotes.
You may describe your own immediate actions in asterisks if needed, but never narrate the scene or speak for others.

Conversation history (most recent at bottom):
{% for msg in history %}{{ msg }}{% endfor %}

Respond to the latest events as {{ character.name }} would.
```

### 3. DirectorAgent
**Intention**: Provides high-level story guidance and pacing. Helps avoid stagnation and ensures engaging plot progression without railroading.

**File**: `directorAgent.ts`  
**Template**: `director.njk`
```njk
You are the Director Agent responsible for story pacing and engagement.

Current plot arc: {{ plotArc | default("Unknown") }}
Summarized recent events: {{ sceneSummary }}
World state snapshot: {{ worldState | json }}

User's latest input: {{ userInput }}

Analyze the scene and output a short guidance directive (50–100 words) for the Narrator and other agents.
Examples:
- "Escalate tension by revealing a hidden threat."
- "Allow a moment of calm and character development."
- "Introduce an unexpected ally."

Preserve user agency at all times.
```

### 4. WorldAgent
**Intention**: Tracks and enforces persistent world state (time, locations, key facts, character relationships). Can output structured JSON updates.

**File**: `worldAgent.ts`  
**Template**: `world.njk`
```njk
You are the World State Agent. Your job is to maintain perfect consistency.

Current known state (JSON):
{{ worldState | json }}

Recent events that may affect state:
{% for event in recentEvents %}- {{ event }}{% endfor %}

User action: {{ userInput }}

If anything has changed (time passage, new facts, location shifts, relationship updates), output an updated JSON object containing ONLY the changed fields.
If no changes are required, output: {"unchanged": true}

Example output:
{
  "timeOfDay": "night",
  "location": "ancient ruins",
  "keyFacts": ["The king is dead", "A prophecy was revealed"]
}
```

### 5. SummarizeAgent
**Intention**: Condenses long chat histories to keep context within token limits and improve coherence.

**File**: `summarizeAgent.ts`  
**Template**: `summarize.njk`
```njk
You are the Summarizer Agent. Produce a concise summary of the conversation history while preserving all plot-critical information.

Full history provided:
{% for msg in history %}{{ msg }}{% endfor %}

Focus on:
- Major events and outcomes
- Character developments and relationships
- Changes to world state
- Open plot threads

Output a single paragraph summary (100–250 words).
```

### 6. VisualAgent
**Intention**: Generates detailed prompts for Stable Diffusion (or video diffusion) and triggers image/video generation.

**File**: `visualAgent.ts`  
**Template**: `visual.njk`
```njk
You are the Visual Agent. Create a high-quality prompt for image or short video generation based on the current scene.

Current narration: {{ narration }}
Key visual elements: {{ sceneElements | join(", ") }}
Art style preference: {{ visualStyle | default("realistic fantasy") }}

Decide if a visual would enhance immersion right now.
If yes, output exactly one of:
[GEN_IMAGE: detailed prompt here, highly detailed, masterpiece, best quality]
[GEN_VIDEO: short action description for 4–8 second clip]

If no visual is needed, output: [NO_VISUAL]
```

### 7. CreatorAgent
**Intention**: On-demand generation of new characters, locations, items, or scenarios.

**File**: `creatorAgent.ts`  
**Template**: `creator.njk`
```njk
You are the Creator Agent. Generate new story elements on request while fitting existing lore.

User request: {{ creationRequest }}
Existing world lore:
{% for entry in lore %}- {{ entry }}{% endfor %}

Generate the requested element and output strictly as JSON matching the appropriate schema.

Example character schema:
{
  "name": "string",
  "description": "physical appearance",
  "personality": "traits",
  "backstory": "string",
  "traits": ["array", "of", "keywords"]
}
```
### 8. TTSAgent
**Intention**: Generates and proxies text-to-speech audio for narration/dialogue, with per-character voices.

**File**: `ttsAgent.ts`  
**Template**: `tts.njk`
```njk
You are the TTS Agent. Convert the provided text to speech prompts, assigning voices based on characters.

Input text: {{ text }}
Character voice map: {{ voiceMap | json }}  // e.g., {"npc1": "deep male"}

Output JSON for API call:
{
  "segments": [{"speaker": "narrator", "text": "segment1"}, {"speaker": "npc1", "text": "dialogue"}]
}
```



## Orchestrator Flow (Typical Sequence)

```ts
1. (Optional) SummarizeAgent → if history too long
2. DirectorAgent      → get high-level guidance
3. WorldAgent         → update/enforce state
4. NarratorAgent      → main descriptive output (receives directorGuidance)
5. CharacterAgent(s)  → dialogue for each active NPC (parallel)
6. VisualAgent        → detect & generate image/video if appropriate
7. TTSAgent        → generate audio if enabled
8. Combine & stream to frontend
```

Special commands (e.g., `/create`, `/image`) can bypass the normal flow and invoke CreatorAgent or VisualAgent directly.
