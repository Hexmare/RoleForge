# Adding Image Generation Modes to Narrator and Visual Agents

This document describes how to add new image generation modes to the NarratorAgent and VisualAgent, enabling specialized narration and visualization features.

## Current Implementation

### How It Works

The image generation system uses a **narrationMode** flag in the `AgentContext` to determine which template and behavior to use:

1. **NarratorAgent** receives `narrationMode` and selects the appropriate template
2. **VisualAgent** receives `narrationMode` and adapts its prompt generation accordingly
3. Templates live in `backend/src/prompts/` with names like `narrator-{mode}.njk` and `visual-{mode}.njk`

### Current Modes

- **default**: Standard scene narration without omniscient view
- **scene-picture**: Omniscient, photographic scene snapshot showing all participants

## Adding a New Image Generation Mode

### Step 1: Create Narrator Template

Create a new file: `backend/src/prompts/narrator-{modeName}.njk`

**Template Structure Example:**
```nunjucks
{% if lore %}[LORE]
{{ lore }}

{% endif %}
## Scene Context
Location: {{ location or 'Unknown location' }}
Time: {{ timeOfDay or 'Unknown time' }}

## Participants
{% if userPersona %}
**User: {{ userPersona.name }}**
- Description: {{ userPersona.description }}
- Current State: {{ userPersonaState.outfit or 'Standard' }}
{% endif %}

{% for char in activeCharacters %}
**{{ char.name }}**
- Description: {{ char.description or 'No description' }}
- Current State: {{ char.outfit or 'Standard' }}
{% endfor %}

## Your Task
[Specific instructions for your narration mode]
```

**Key Variables Available in All Templates:**
- `userPersona`: User's persona object (name, description, appearance, personality, occupation, species, etc.)
- `userPersonaState`: Current physical state (outfit, health, mood, bearing, position, activity)
- `activeCharacters`: Array of NPC characters with merged override data
- `worldState`: Current world state and facts
- `history`: Chat history array
- `lore`: Formatted lore entries
- `location`: Current scene location
- `timeOfDay`: Time of day in the scene
- `sceneDescription`: Current scene description (for visual modes)

### Step 2: Create Visual Template (if needed)

Create: `backend/src/prompts/visual-{modeName}.njk`

**For Regular Visual Modes (narrative output):**
```nunjucks
You are the Visual Agent creating visual prompts for {{ modeName }} mode.

Current scene: {{ sceneDescription or userInput }}

Decide if a visual would enhance immersion.
If yes, output: [GEN_IMAGE: detailed stable diffusion prompt here]
If no, output: [NO_VISUAL]
```

**For Stable Diffusion Modes (direct prompt generation):**
```nunjucks
You are a Stable Diffusion prompt engineer.

Convert the following scene into an optimized SD prompt:
{{ sceneDescription }}

Generate ONLY the Stable Diffusion prompt, nothing else.
```

### Step 3: Update NarratorAgent

Edit `backend/src/agents/NarratorAgent.ts` to recognize the new mode:

```typescript
async run(context: AgentContext): Promise<string> {
  // Select template based on narrationMode
  const narrationModes: Record<string, string> = {
    'default': 'narrator',
    'scene-picture': 'narrator-scene-picture',
    'your-new-mode': 'narrator-your-new-mode'  // ADD THIS LINE
  };
  
  const templateName = narrationModes[context.narrationMode || 'default'] || 'narrator';
  const systemPrompt = this.renderTemplate(templateName, context);
  
  // ... rest of implementation
}
```

### Step 4: Update VisualAgent (if applicable)

Edit `backend/src/agents/VisualAgent.ts` to handle the new mode:

**If your mode generates SD prompts directly:**
```typescript
async run(context: AgentContext): Promise<string> {
  // Add to the narrationMode checks
  if (context.narrationMode === 'your-new-mode') {
    const systemPrompt = this.renderTemplate('visual-your-new-mode', context);
    const messages = this.renderLLMTemplate(systemPrompt, 'Generate prompt');
    const response = await this.callLLM(messages);
    const sdPrompt = this.cleanResponse(response as string).trim();
    return sdPrompt;
  }
  
  // ... rest of implementation
}
```

**If your mode processes narrative like the default visual agent:**
```typescript
// Use the existing flow - it will automatically use the new visual template
// via this.renderTemplate('visual-your-new-mode', context)
```

### Step 5: Create Slash Command or Entry Point

Add the mode to `backend/src/agents/Orchestrator.ts`:

**Example: New slash command `/yourmode`**
```typescript
case 'yourmode':
  const naratorAgent = this.agents.get('narrator')!;
  const context: AgentContext = {
    userInput: 'Generate narration',
    history: this.history,
    worldState: this.worldState,
    userPersona: this.getPersona(personaName),
    userPersonaState: userPersonaState,
    activeCharacters: resolvedCharsWithState,
    narrationMode: 'your-new-mode',  // SET THE MODE HERE
    location: sessionContext?.scene.location,
    timeOfDay: sessionContext?.scene.timeOfDay,
    sceneDescription: sessionContext?.scene.description,
  } as any;
  
  const result = await naratorAgent.run(context);
  return { responses: [{ sender: 'Narrator', content: result }], lore: [] };
```

**Or: Condition on existing narrationMode parameter**
```typescript
// In processUserInput, allow mode selection:
async processUserInput(
  userInput: string,
  personaName: string = 'default',
  activeCharacters?: string[],
  sceneId?: number,
  narrationMode?: string  // ADD THIS PARAMETER
): Promise<...> {
  // Pass narrationMode to all agent contexts
  const context: AgentContext = {
    // ... other fields
    narrationMode: narrationMode || 'default',
  };
}
```

### Step 6: Test Your Mode

**Unit Test Example** (in `backend/src/__tests__/narration.test.ts`):
```typescript
describe('NarratorAgent - Custom Modes', () => {
  it('should use your-new-mode template when narrationMode is set', async () => {
    const context: AgentContext = {
      userInput: 'Test',
      history: [],
      worldState: {},
      narrationMode: 'your-new-mode',
      userPersona: { name: 'TestUser', description: 'A test character' },
      activeCharacters: [],
    };
    
    const result = await narratorAgent.run(context);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Manual Testing:**
1. Build: `npm run build`
2. Run tests: `npm test`
3. Start server: Run the server and test via chat or direct API calls
4. Verify template variables render correctly by checking console logs

## Common Patterns

### For Omniscient Modes (showing all scene participants)
Include:
- User persona with full appearance details
- All active characters with positions and states
- Location and environment description
- Conversation history for context

Template Pattern:
```nunjucks
{% if userPersona %}
- User: {{ userPersona.name }} - {{ userPersona.description }}
{% endif %}
{% for char in activeCharacters %}
- NPC: {{ char.name }} - {{ char.description }}
{% endfor %}
```

### For Focused Modes (single perspective)
Include:
- Only the focused character's details
- Limited environmental context
- What that character can perceive

### For Pure SD Prompt Modes
Include:
- Scene description context
- Character appearance details
- Mood and atmosphere keywords
- Explicit instruction to output ONLY the prompt

## Integrating with Frontend

### Add Mode Selection UI

Update `frontend/src/components/Chat.tsx` to show mode options:

```typescript
const narrationModes = ['default', 'scene-picture', 'your-new-mode'];

<select onChange={(e) => setNarrationMode(e.target.value)}>
  {narrationModes.map(mode => (
    <option key={mode} value={mode}>{mode}</option>
  ))}
</select>
```

### Send Mode to Backend

When emitting chat events:
```typescript
socket.emit('userMessage', {
  message: userInput,
  personaName: selectedPersona,
  narrationMode: selectedMode  // Include mode
});
```

## Checklist for Adding a New Mode

- [ ] Create `narrator-{mode}.njk` template
- [ ] Create `visual-{mode}.njk` template (if needed)
- [ ] Update NarratorAgent template selection logic
- [ ] Update VisualAgent mode handling (if needed)
- [ ] Add entry point in Orchestrator (slash command or parameter)
- [ ] Update `AgentContext` usage if needed
- [ ] Add unit tests
- [ ] Test manually with full chat flow
- [ ] Update frontend UI to expose the mode (optional)
- [ ] Document the new mode in this file

## Examples of Future Modes

### Combat Mode
Narrates action-focused combat scenes with positioning and tactical details.

**Template:** `narrator-combat.njk`
**Visual:** `visual-combat.njk` - generates tactical battle scene images
**Trigger:** `/combat` slash command or mode parameter

### Memory/Flashback Mode
Narrates past events from character memory with muted colors and nostalgic tone.

**Template:** `narrator-memory.njk`
**Visual:** `visual-memory.njk` - generates grayscale or sepia-toned memory images
**Trigger:** `/memory [event]` slash command

### Close-Up Detail Mode
Focuses on fine details of a location or character for immersive close-up descriptions.

**Template:** `narrator-closeup.njk`
**Visual:** `visual-closeup.njk` - generates highly detailed close-up images
**Trigger:** `/closeup [target]` slash command

### Summary/Recap Mode
Provides a narrative recap of the session's events with key moments highlighted.

**Template:** `narrator-recap.njk`
**Visual:** `visual-recap.njk` (optional) - generates collage or montage
**Trigger:** `/recap` slash command

## Troubleshooting

### Template Variables Not Rendering

**Problem:** Fields show as empty in LLM prompt
**Solution:** Check `getPersona()` in Orchestrator - ensure data is being parsed correctly. Use `| safe` filter if serializing objects.

### Wrong Template Being Used

**Problem:** Getting default narrator output instead of custom mode
**Solution:** Verify `narrationMode` is being set correctly in AgentContext. Check NarratorAgent's template selection logic includes your mode.

### Visual Agent Not Calling New Mode

**Problem:** Visual agent uses default behavior for new mode
**Solution:** Add explicit check for `context.narrationMode === 'your-mode'` in VisualAgent before the default logic.

### Tests Failing

**Problem:** New mode tests fail
**Solution:** Ensure templates exist and can be found by renderTemplate(). Check LLM configuration in tests includes required profiles.

## References

- [NarratorAgent.ts](../backend/src/agents/NarratorAgent.ts)
- [VisualAgent.ts](../backend/src/agents/VisualAgent.ts)
- [Orchestrator.ts](../backend/src/agents/Orchestrator.ts)
- [BaseAgent.ts](../backend/src/agents/BaseAgent.ts)
- [AgentContext Interface](../backend/src/agents/BaseAgent.ts#L12)
