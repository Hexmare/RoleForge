# RoleForge
This is a LLM driven Roleplay system that I am building as a science project.
This project is heavily inspired by Talemate https://github.com/vegu-ai/talemate
as well as SillyTavern https://github.com/SillyTavern/SillyTavern

Key design docs:

- [.github/copilot-instructions.md](.github/copilot-instructions.md)
- [.github/agent-design.md](.github/agent-design.md)
- [.github/phase5.md](.github/phase5.md)

Both of these projects started me down the rabbit hole. If anything becomes of this little sidequest, those are the giants whose shoulders I am trying to stand on.

## LLM Configuration

RoleForge uses OpenAI-compatible API endpoints for all LLM interactions. Configuration is managed via `backend/config.json`.

### Quick Start Examples

#### OpenAI (Cloud)
```json
{
  "profiles": {
    "openai": {
      "type": "openai",
      "apiKey": "sk-...",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-3.5-turbo",
      "template": "chatml"
    }
  },
  "defaultProfile": "openai"
}
```

#### Ollama (Local, Free)
```json
{
  "profiles": {
    "ollama": {
      "type": "openai",
      "baseURL": "http://localhost:11434/v1",
      "model": "llama2",
      "template": "llama2"
    }
  },
  "defaultProfile": "ollama"
}
```

#### LM Studio (Easiest)
```json
{
  "profiles": {
    "lmstudio": {
      "type": "openai",
      "baseURL": "http://localhost:1234/v1",
      "model": "local-model",
      "template": "chatml"
    }
  },
  "defaultProfile": "lmstudio"
}
```

### Documentation

- **[Template Guide](backend/TEMPLATE_GUIDE.md)** - Message format templates (ChatML, Alpaca, Vicuna, Llama2)
- **[Backend Support](backend/BACKEND_SUPPORT.md)** - Supported LLM backends and setup instructions
- **[Error Handling](backend/ERROR_HANDLING.md)** - Troubleshooting, retry logic, and debugging

### Features

✅ Multiple LLM backends (OpenAI, Ollama, LM Studio, vLLM, etc.)  
✅ Automatic retry with exponential backoff  
✅ Fallback profiles for reliability  
✅ Multiple message formats (ChatML, Alpaca, Vicuna, Llama2)  
✅ Per-agent LLM profile overrides  
✅ Comprehensive error logging
