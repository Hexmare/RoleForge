# RoleForge Backend Support Matrix

Complete reference for supported LLM backends, connection profiles, and requirements.

## Supported Backends

RoleForge supports any **OpenAI-compatible API** endpoint. This includes:

### ✅ Officially Tested

| Backend | Type | Endpoint | Notes |
|---------|------|----------|-------|
| OpenAI | Cloud API | https://api.openai.com/v1 | Primary recommendation |
| Ollama | Local | http://localhost:11434/v1 | Best for local development |
| LM Studio | Local | http://localhost:1234/v1 | Easy UI-based setup |
| Text Generation WebUI | Local | http://localhost:5000/v1 | KoboldCPP-compatible |
| vLLM | Local/Remote | http://localhost:8000/v1 | High-performance inference |
| Hugging Face Inference API | Cloud | https://api-inference.huggingface.co/models/{model} | Beta support |

### ⚠️ In Progress (Not Yet Supported)

- Claude (Anthropic) - Requires SDK refactor for non-OpenAI API format
- OpenRouter - Requires proxy layer for stop_sequence support  
- Other local LLMs - Add via OpenAI-compatible wrapper

## Configuration by Backend

### OpenAI (Recommended for Cloud)

```json
{
  "profiles": {
    "openai": {
      "type": "openai",
      "apiKey": "sk-your-key-here",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-3.5-turbo",
      "template": "chatml",
      "sampler": {
        "temperature": 0.7,
        "topP": 0.9,
        "max_completion_tokens": 800,
        "maxContextTokens": 4000
      }
    }
  }
}
```

**Requirements**:
- Valid API key from https://platform.openai.com/account/api-keys
- Internet connection
- Sufficient API credits

**Supported Models**:
- gpt-4, gpt-4-turbo, gpt-3.5-turbo
- gpt-3.5-turbo-16k (higher context)

---

### Ollama (Best for Local Development)

**Installation**:
```bash
# Download from https://ollama.ai
# Then pull a model
ollama pull llama2
# Server runs at http://localhost:11434
```

**Configuration**:
```json
{
  "profiles": {
    "ollama": {
      "type": "openai",
      "baseURL": "http://localhost:11434/v1",
      "model": "llama2",
      "template": "llama2",
      "sampler": {
        "temperature": 0.7,
        "topP": 0.9,
        "max_completion_tokens": 400,
        "maxContextTokens": 2048
      }
    }
  }
}
```

**Supported Models** (via `ollama pull`):
- llama2, llama2:13b, llama2:70b
- mistral, neural-chat, orca-mini
- phi (fast, small)

**Advantages**:
- ✅ Free, completely local
- ✅ No API keys needed
- ✅ Works offline
- ✅ Fast for testing

**Notes**:
- First model pull takes time (downloads weights)
- RAM: 8GB minimum for 7B models, 16GB+ for 13B/70B
- GPU acceleration: Optional but recommended

---

### LM Studio (Easiest Local Setup)

**Installation**:
```
1. Download from https://lmstudio.ai
2. Open app, search for model (e.g., "mistral")
3. Click download
4. Click "Local Server" (green button)
5. Server runs at http://localhost:1234/v1
```

**Configuration**:
```json
{
  "profiles": {
    "lmstudio": {
      "type": "openai",
      "baseURL": "http://localhost:1234/v1",
      "model": "local-model",
      "template": "chatml",
      "sampler": {
        "temperature": 0.7,
        "max_completion_tokens": 300
      }
    }
  }
}
```

**Advantages**:
- ✅ Easiest GUI setup
- ✅ Model management built-in
- ✅ No command line needed
- ✅ Works completely offline

**Disadvantages**:
- Slower than native implementations
- Higher RAM usage

---

### Text Generation WebUI (Advanced Local)

**Installation**:
```bash
git clone https://github.com/oobabooga/text-generation-webui
cd text-generation-webui
python start_linux.py  # or start_windows.py
```

**Configuration**:
```json
{
  "profiles": {
    "webui": {
      "type": "openai",
      "baseURL": "http://localhost:5000/v1",
      "model": "text-generation-webui",
      "template": "alpaca",
      "sampler": {
        "temperature": 0.7,
        "topP": 0.9,
        "max_completion_tokens": 500
      }
    }
  }
}
```

**Advantages**:
- ✅ Highly configurable
- ✅ Advanced sampling options
- ✅ Excellent for experimentation
- ✅ Great UI

**Disadvantages**:
- Steeper learning curve
- More setup required

---

### vLLM (High Performance)

**Installation**:
```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server --model mistral-7b-instruct-v0.1
```

**Configuration**:
```json
{
  "profiles": {
    "vllm": {
      "type": "openai",
      "baseURL": "http://localhost:8000/v1",
      "model": "mistral-7b-instruct-v0.1",
      "template": "alpaca",
      "sampler": {
        "temperature": 0.7,
        "max_completion_tokens": 1000,
        "maxContextTokens": 4000
      }
    }
  }
}
```

**Advantages**:
- ✅ Fastest inference
- ✅ Best throughput
- ✅ GPU optimized
- ✅ Production-ready

**Requirements**:
- GPU with CUDA support
- Higher VRAM (12GB+ recommended)
- NVIDIA drivers installed

---

## Recommended Setups by Use Case

### 🎯 Quick Testing
```
→ Use: LM Studio
→ Model: Mistral 7B
→ Setup time: 5 minutes
→ No coding required
```

### 🔬 Development/Experimentation
```
→ Use: Ollama
→ Model: Llama2
→ Setup time: 10 minutes
→ Lightweight, fast iteration
```

### 🚀 Production Cloud
```
→ Use: OpenAI
→ Model: GPT-4
→ Cost: ~$0.03/1K input tokens
→ Best quality, most reliable
```

### ⚡ Maximum Performance
```
→ Use: vLLM
→ Model: Mistral/Llama2
→ GPU: RTX 4090 or A100
→ Setup: Docker recommended
```

## Sampler Settings Reference

All backends support these sampler options:

```json
{
  "sampler": {
    "temperature": 0.7,              // 0.0-2.0, higher = more creative
    "topP": 0.9,                     // 0.0-1.0, nucleus sampling
    "topK": 40,                      // Restrict to top K tokens
    "max_completion_tokens": 400,    // Max tokens in response
    "maxContextTokens": 2048,        // Max context window
    "frequencyPenalty": 0.0,         // Penalize repeated tokens
    "presencePenalty": 0.0,          // Penalize new tokens
    "stop": ["User:", "###"],        // Stop generation at these strings
    "n": 1,                          // Number of completions
    "forceJson": false               // Force JSON output (if supported)
  }
}
```

## Retry and Fallback Configuration

RoleForge automatically retries failed requests and can fallback to backup profiles:

```json
{
  "profiles": {
    "primary": {
      "type": "openai",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-4",
      "fallbackProfiles": ["backup", "local"]
    },
    "backup": {
      "type": "openai",
      "baseURL": "https://backup-api.example.com/v1",
      "model": "gpt-3.5-turbo"
    },
    "local": {
      "type": "openai",
      "baseURL": "http://localhost:11434/v1",
      "model": "llama2"
    }
  }
}
```

**Retry Behavior**:
- **Max retries**: 3 per profile
- **Backoff**: 1s → 2s → 4s
- **Retryable errors**: 408, 429, 500, 502, 503, 504, network timeouts
- **Non-retryable**: Auth errors (401, 403) skip retries

**Fallback Cascade**:
1. Try primary profile with 3 retries
2. If all retries fail, try first backup profile
3. If backup fails, try next backup
4. If all profiles fail, return error

## API Key Management

### Storage Best Practices

1. **Never commit keys to git**
2. **Use environment variables in production**:
   ```json
   {
     "profiles": {
       "openai": {
         "apiKey": "${OPENAI_API_KEY}"
       }
     }
   }
   ```
3. **Set environment variable**:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

### Key Rotation

To rotate keys without downtime:

1. Add new profile with new key
2. Update `defaultProfile` if needed
3. Existing connections continue working
4. Gradually migrate agents to new profile

## Troubleshooting by Backend

### OpenAI
```
Error: 401 Incorrect API key
→ Solution: Check key at https://platform.openai.com/account/api-keys

Error: 429 Rate limit exceeded
→ Solution: Reduce concurrent requests or upgrade account

Error: 503 Service unavailable
→ Solution: OpenAI having issues, RoleForge auto-retries
```

### Ollama
```
Error: Connection refused
→ Solution: ollama pull <model> && ollama serve

Error: No such file
→ Solution: Model not downloaded, run: ollama pull llama2

Slow responses
→ Solution: Model too large for RAM, try smaller: ollama pull mistral
```

### LM Studio
```
Error: "model not found" in logs
→ Solution: Click "Local Server" green button, server not running

Error: Out of memory
→ Solution: Reduce context or use smaller model
```

## Template Compatibility

| Backend | ChatML | Alpaca | Vicuna | Llama2 |
|---------|--------|--------|--------|--------|
| OpenAI | ✅ Native | ⚠️ Works | ⚠️ Works | ⚠️ Works |
| Ollama | ✅ ChatML | ✅ Yes | ✅ Yes | ✅ Native |
| LM Studio | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Text Gen WebUI | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| vLLM | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

## Performance Benchmarks

Approximate response times (3.5K context, 200 token response):

| Model | Backend | Speed | Quality |
|-------|---------|-------|---------|
| GPT-4 | OpenAI Cloud | 3-5s | ⭐⭐⭐⭐⭐ |
| GPT-3.5-turbo | OpenAI Cloud | 1-2s | ⭐⭐⭐⭐ |
| Llama2 (70B) | vLLM GPU | 2-4s | ⭐⭐⭐⭐ |
| Llama2 (13B) | Ollama | 5-15s | ⭐⭐⭐ |
| Mistral (7B) | LM Studio | 10-30s | ⭐⭐⭐ |

*Note: Highly dependent on hardware and settings*

## Cost Comparison

| Backend | Setup Cost | Monthly (1M tokens) |
|---------|-----------|-------------------|
| OpenAI | $0 | $3-60 (depends on model) |
| Ollama | Hardware | $0 |
| LM Studio | Hardware | $0 |
| vLLM | Hardware | $0 |

## Adding New Backend Support

To add a new OpenAI-compatible backend:

1. Update `BACKEND_SUPPORT.md` (this file)
2. Add configuration example
3. Test with `npm test`
4. Document in troubleshooting section

## Migration Between Backends

### From OpenAI to Ollama

1. Install Ollama: https://ollama.ai
2. Pull model: `ollama pull llama2`
3. Update config.json:
   ```json
   {
     "defaultProfile": "ollama",
     "profiles": {
       "ollama": {
         "baseURL": "http://localhost:11434/v1",
         "model": "llama2",
         "template": "llama2"
       }
     }
   }
   ```
4. Restart backend: `npm run dev:backend`

## Summary

- ✅ OpenAI: Best quality, cloud-based
- ✅ Ollama: Best for local development
- ✅ LM Studio: Easiest setup
- ✅ vLLM: Best performance
- ✅ All support retry + fallback

---

**Last Updated**: January 12, 2026  
**Supported**: OpenAI-compatible APIs only  
**Test Coverage**: All backends tested with retry logic
