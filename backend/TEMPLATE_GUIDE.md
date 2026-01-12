# RoleForge LLM Template Guide

Complete reference for understanding and customizing LLM message formatting templates in RoleForge.

## Overview

Templates control how RoleForge formats messages for different LLM backends. Each template defines the structure and markers used to distinguish system prompts, user messages, and assistant responses.

**Location**: `backend/src/llm_templates/`

**Supported Formats**:
- **ChatML** (chatml.njk) - OpenAI's standard format, recommended
- **Alpaca** (alpaca.njk) - Stanford Alpaca instruction format
- **Vicuna** (vicuna.njk) - LLaMA-based chat format
- **Llama2** (llama2.njk) - Meta's Llama2-Chat format

## Template System Architecture

### How Templates Work

1. **Configuration** → Template selection in `config.json`
2. **Preprocessing** → Variables replaced via Nunjucks
3. **Rendering** → Final text sent to LLM
4. **Parsing** → Response split by role markers

```
config.json (profile.template = "chatml")
    ↓
BaseAgent.renderLLMTemplate()
    ↓
Nunjucks rendering with {{system_prompt}}, {{user_message}}, {{assistant_message}}
    ↓
Final message text
    ↓
LLM API receives formatted message
```

### Key Components

**Variables** (auto-injected by RoleForge):
- `{{system_prompt}}` - System instructions for the LLM
- `{{user_message}}` - User input / current request
- `{{assistant_message}}` - Previous assistant response (for continuations)

**Role Markers** (format-specific):
- Used to identify message roles during parsing
- Critical for response extraction
- Different for each format

## Supported Template Formats

### 1. ChatML (Recommended) - chatml.njk

**Use for**: OpenAI API, LM Studio, Ollama with ChatML support

**Format**:
```
<|im_start|>system
{{system_prompt}}<|im_end|>
<|im_start|>user
{{user_message}}<|im_end|>
<|im_start|>assistant
{{assistant_message}}<|im_end|>
```

**Markers**: `<|im_start|>` and `<|im_end|>`

**Role identifiers**: `system`, `user`, `assistant`

**Best for**:
- OpenAI gpt-3.5-turbo, gpt-4
- Ollama models with ChatML
- LM Studio servers

**Example response parsing**:
```
Input: <|im_start|>assistant\nHello there!<|im_end|>
Parsed: { role: "assistant", content: "Hello there!" }
```

---

### 2. Alpaca - alpaca.njk

**Use for**: Models fine-tuned on Stanford Alpaca instructions

**Format**:
```
Below is an instruction that describes a task. Write a response that appropriately completes the request.

### Instruction:
{{system_prompt}}

### Input:
{{user_message}}

### Response:
{{assistant_message}}
```

**Markers**: `### Instruction:`, `### Response:`

**Best for**:
- Alpaca-7B/13B/30B
- OpenLLaMA fine-tuned variants
- Instruction-tuned models

**Notes**:
- Simple, readable format
- Good for smaller models
- No special delimiters for parsing

---

### 3. Vicuna - vicuna.njk

**Use for**: LLaMA-based models fine-tuned via Vicuna training

**Format**:
```
{{system_prompt}}

USER: {{user_message}}
ASSISTANT:{{assistant_message}}
```

**Markers**: `USER:` and `ASSISTANT:`

**Best for**:
- Vicuna-7B/13B/33B
- LLaMA models with Vicuna fine-tuning
- FastChat/LMDeploy

**Notes**:
- Requires newline before ASSISTANT marker
- System prompt at top without marker
- Space-efficient format

---

### 4. Llama2-Chat - llama2.njk

**Use for**: Meta's official Llama2-Chat models

**Format**:
```
<s>[INST] <<SYS>>
{{system_prompt}}
<</SYS>>

{{user_message}} [/INST] {{assistant_message}} </s>
```

**Markers**: `[INST]`, `[/INST]`, `<s>`, `</s>`, `<<SYS>>`, `<</SYS>>`

**Best for**:
- Llama2-7B-chat, 13B-chat, 70B-chat
- HuggingFace official Llama2 models
- Text generation backends supporting Llama2

**Notes**:
- Special SYS block for system prompt
- Token `</s>` marks response end
- Requires exact spacing

---

## Configuration

### Selecting a Template

Edit `backend/config.json`:

```json
{
  "profiles": {
    "openai": {
      "type": "openai",
      "apiKey": "sk-...",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-3.5-turbo",
      "template": "chatml"
    },
    "alpaca": {
      "type": "openai",
      "apiKey": "your-key",
      "baseURL": "http://localhost:5000/v1",
      "model": "alpaca-7b",
      "template": "alpaca"
    },
    "llama2": {
      "type": "openai",
      "baseURL": "http://localhost:8000/v1",
      "model": "llama2",
      "template": "llama2"
    }
  },
  "defaultProfile": "openai"
}
```

### Per-Agent Overrides

Override template for specific agents:

```json
{
  "agents": {
    "character": {
      "llmProfile": "alpaca",
      "template": "alpaca"
    },
    "narrator": {
      "template": "llama2"
    }
  }
}
```

## Creating Custom Templates

### Template Requirements

1. **Must include all 3 variables**:
   - `{{system_prompt}}`
   - `{{user_message}}`
   - `{{assistant_message}}`

2. **Role identification**:
   - Must have clear markers for system/user/assistant roles
   - Used during response parsing

3. **Nunjucks compatible**:
   - Supports `{% if %}`, `{% for %}`, `{{ }}`
   - Processed before sending to LLM

### Example: Custom Format

Create `backend/src/llm_templates/custom.njk`:

```njk
{# Custom format for proprietary API #}
<custom_start role="system">
{{system_prompt}}
</custom_start>

<custom_start role="user">
{{user_message}}
</custom_start>

<custom_start role="assistant">
{{assistant_message}}
</custom_start>
```

Then reference in config.json:

```json
{
  "profiles": {
    "custom": {
      "template": "custom"
    }
  }
}
```

## Troubleshooting

### Template Not Found Error

```
Error: Template file not found: backend/src/llm_templates/unknown.njk
```

**Solution**:
- Verify template name in `config.json` matches .njk filename
- Check file exists in `backend/src/llm_templates/`
- RoleForge falls back to `chatml` if specified template missing

### Incorrect Response Parsing

If LLM responses aren't parsed correctly:

1. **Verify role markers** are in response
2. **Check spacing** - some formats require exact whitespace
3. **Test template rendering**:
   ```bash
   cd backend
   npm run test -- llm-template.test.ts
   ```

### Model Not Following Format

If model ignores format:

1. **Verify model supports format** - check HuggingFace docs
2. **Try simpler format** - Alpaca is most forgiving
3. **Check model training** - may have used different format

## Testing Templates

### Automated Tests

```bash
cd backend
npm test -- llm-template.test.ts
```

Validates:
- All templates exist
- Variables present
- Role markers correct
- Fallback chain works

### Manual Testing

1. Set template in config.json
2. Send message in chat
3. Check console logs: `Rendered template for character: ...`
4. Verify LLM response appears correctly

### Debug Mode

Add logging to understand template flow:

```typescript
// In BaseAgent.ts
console.log('Template path:', templatePath);
console.log('Template content:', template.substring(0, 200));
console.log('Rendered output:', rendered.substring(0, 200));
```

## Performance Considerations

- **Template size**: Kept small (< 500 bytes each)
- **Variable replacement**: O(n) in template size
- **Parsing**: Split by markers, linear in response size
- **Caching**: Templates loaded once at startup

## Migration Guide

### Switching Templates

To change default template:

1. Edit `backend/config.json`
2. Change `profiles.{profileName}.template` value
3. Restart backend: `npm run dev:backend`

### Adding New Format Support

1. Create `.njk` file in `backend/src/llm_templates/`
2. Add to config.json as new profile
3. Test with `npm test -- llm-template.test.ts`
4. Update documentation

## Best Practices

1. **Start with ChatML** - most compatible
2. **Test before deployment** - run template tests
3. **Document custom formats** - add comments
4. **Use appropriate format for model** - match training
5. **Keep backups** - save original templates
6. **Monitor performance** - check token counts

## References

- [ChatML Specification](https://github.com/openai/openai-python/blob/main/chatml.md)
- [Alpaca Training](https://github.com/tatsu-lab/stanford_alpaca)
- [Vicuna Project](https://github.com/lm-sys/FastChat)
- [Llama2 Paper](https://arxiv.org/abs/2307.09288)

## Summary

| Format | Best For | Markers | Complexity | Status |
|--------|----------|---------|-----------|--------|
| ChatML | OpenAI, Ollama | `<\|im_start\|>` | High | ✅ Recommended |
| Alpaca | Smaller models | `###` | Low | ✅ Simple |
| Vicuna | LLaMA fine-tunes | `USER:/ASSISTANT:` | Medium | ✅ Common |
| Llama2 | Meta Llama2 | `[INST]`, `<s>` | High | ✅ Official |

---

**Last Updated**: January 12, 2026  
**RoleForge Version**: With Retry & Fallback Support
