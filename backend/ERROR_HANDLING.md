# RoleForge LLM Error Handling Guide

Comprehensive guide for understanding, debugging, and resolving LLM-related errors in RoleForge.

## Error Categories

RoleForge errors fall into 4 main categories:

1. **Configuration Errors** - Invalid settings
2. **Network Errors** - Connection issues (retried automatically)
3. **API Errors** - LLM backend rejected request
4. **Template Errors** - Template rendering failed

## Configuration Errors

### Error: Profile Not Found

```
Error: Profile 'custom' not found
```

**Cause**: Referenced profile doesn't exist in `config.json`

**Solution**:
1. Check spelling in config.json: `"defaultProfile": "custom"`
2. Verify profile is defined: `"profiles": { "custom": { ... } }`
3. Ensure JSON syntax is valid (commas, brackets)

**Example Fix**:
```json
{
  "defaultProfile": "openai",           // ← Must exist in profiles
  "profiles": {
    "openai": {                         // ← Define it here
      "type": "openai",
      "apiKey": "sk-...",
      "baseURL": "https://api.openai.com/v1",
      "model": "gpt-3.5-turbo"
    }
  }
}
```

---

### Error: Template Not Found

```
[LLM] Rendered template for character: ... (line 185)
Error: Template file not found: backend/src/llm_templates/unknown.njk
```

**Cause**: Template specified in profile doesn't exist

**Solution**:
1. Check template file exists: `backend/src/llm_templates/{name}.njk`
2. Verify spelling: `"template": "chatml"` not `"template": "chatml"`
3. RoleForge auto-falls back to `chatml` if not found

**Example Fix**:
```json
{
  "profiles": {
    "myprofile": {
      "template": "alpaca"        // ← File must be: alpaca.njk
    }
  }
}
```

**Available Templates**:
- `chatml` (default, recommended)
- `alpaca`
- `vicuna`
- `llama2`

---

### Error: Invalid JSON Config

```
SyntaxError: Unexpected token } in JSON at position 245
```

**Cause**: Malformed JSON in config.json

**Common Issues**:
- Missing comma between properties
- Trailing comma before closing bracket
- Unclosed string quote
- Single quotes instead of double quotes

**Fix Example**:
```json
// ❌ WRONG - Missing comma
{
  "profiles": {
    "openai": { "type": "openai" }    // ← No comma here!
    "ollama": { "type": "openai" }
  }
}

// ✅ CORRECT
{
  "profiles": {
    "openai": { "type": "openai" },   // ← Comma added
    "ollama": { "type": "openai" }
  }
}
```

**Validation Tool**: Use https://jsonlint.com to validate

---

## Network Errors (Auto-Retried)

These errors are **automatically retried** with exponential backoff (1s → 2s → 4s):

### Connection Refused

```
Error: ECONNREFUSED 127.0.0.1:11434
```

**Cause**: Backend server not running (e.g., Ollama, LM Studio, etc.)

**Solution**:
1. **For Ollama**: `ollama serve` in separate terminal
2. **For LM Studio**: Click "Local Server" button
3. **For text-gen-webui**: `python server.py`
4. **For OpenAI**: Verify internet connection

**What Happens**:
```
[LLM] Attempt 1/3 on profile http://localhost:11434/v1
[LLM] API call failed: Error: ECONNREFUSED
[LLM] Retryable error, waiting 1000ms before retry
[LLM] Attempt 2/3 on profile http://localhost:11434/v1
[LLM] Retry succeeded on attempt 2
```

---

### Connection Timeout

```
Error: ETIMEDOUT - Connection timed out
```

**Cause**: Server takes too long to respond (network slow, server busy, etc.)

**Solution**:
1. Check server is responsive: `curl http://localhost:8000/health`
2. Reduce context size in sampler: `"maxContextTokens": 2048`
3. Use faster model or backend
4. Check network latency: `ping localhost`

**Auto-Recovery**: RoleForge retries up to 3 times automatically

---

### Host Not Found

```
Error: ENOTFOUND api.openai.com
```

**Cause**: DNS resolution failed (no internet or wrong URL)

**Solution**:
1. Check internet connection: `ping 8.8.8.8`
2. Verify URL spelling in config: `"baseURL": "https://api.openai.com/v1"`
3. Check DNS: `nslookup api.openai.com`

---

## API Errors

### 401 Unauthorized - Invalid API Key

```
401 Incorrect API key provided: sk-...
```

**Cause**: API key is invalid, expired, or wrong backend

**Solution**:
1. **For OpenAI**:
   - Get key: https://platform.openai.com/account/api-keys
   - Format must start with `sk-`
   - Don't share key publicly
2. **For other backends**:
   - Verify apiKey matches backend authentication
   - Some backends don't need keys (Ollama, LM Studio)

**Fix Example**:
```json
{
  "profiles": {
    "openai": {
      "apiKey": "sk-1234567890abcdef...",  // ← Correct format
      "baseURL": "https://api.openai.com/v1"
    },
    "ollama": {
      // ← No apiKey needed for Ollama!
      "baseURL": "http://localhost:11434/v1"
    }
  }
}
```

---

### 429 Rate Limited

```
429 Too Many Requests
```

**Cause**: Exceeded API rate limits

**When It Happens**:
- Too many concurrent requests
- Sending requests too fast
- Daily/monthly quota exceeded

**Solution**:
1. **Immediate**: RoleForge auto-retries with backoff (1s, 2s, 4s)
2. **Short-term**: Reduce sampler.max_completion_tokens
3. **Long-term**:
   - For OpenAI: Upgrade account tier
   - For local backends: No rate limits

**What Happens**:
```
[LLM] Attempt 1/3 on profile https://api.openai.com/v1
[LLM] API call failed: 429 Too Many Requests
[LLM] Retryable error, waiting 1000ms before retry
[LLM] Attempt 2/3 on profile https://api.openai.com/v1
// ... retries automatically
```

---

### 500 Internal Server Error

```
500 Internal Server Error
```

**Cause**: Backend server error (temporary or bug)

**Solution**:
1. **Immediate**: RoleForge auto-retries (usually succeeds)
2. **If persists**: Check backend logs
3. **Contact**: Report to backend provider

**Example with Retry**:
```
[LLM] Attempt 1/3: 500 Server Error
[LLM] Retryable error, waiting 1000ms before retry
[LLM] Attempt 2/3: Success!
```

---

### 503 Service Unavailable

```
503 Service Unavailable
```

**Cause**: Backend temporarily down for maintenance

**Solution**:
1. RoleForge auto-retries
2. If continues, use fallback profile:
   ```json
   {
     "profiles": {
       "primary": {
         "baseURL": "https://api.openai.com/v1",
         "fallbackProfiles": ["backup"]
       },
       "backup": {
         "baseURL": "http://localhost:11434/v1"
       }
     }
   }
   ```

---

## Template Errors

### Template Rendering Failed

```
Error rendering template 'alpaca': undefined variable
```

**Cause**: Template missing required variable

**Solution**:
1. All templates must have: `{{system_prompt}}`, `{{user_message}}`, `{{assistant_message}}`
2. Check template file syntax
3. Run tests: `npm test -- llm-template.test.ts`

**Valid Template Example**:
```njk
### Instruction:
{{system_prompt}}

### Input:
{{user_message}}

### Response:
{{assistant_message}}
```

---

### Parsing Response Failed

```
Error: Could not parse LLM response format
```

**Cause**: Response doesn't match template format expectations

**Solution**:
1. Check role markers are present: `<|im_start|>`, `USER:`, `[INST]`, etc.
2. Verify template matches model output
3. Try simpler template: use `chatml`

**Debug**:
```typescript
// Add to BaseAgent.ts for debugging
console.log('Raw response:', response.substring(0, 500));
console.log('Parsed messages:', messages);
```

---

## Fallback and Recovery

### Automatic Fallback Chain

If primary profile fails:

```
Primary profile (e.g., OpenAI)
    ↓ (3 retries fail)
Fallback 1 (e.g., Ollama)
    ↓ (3 retries fail)
Fallback 2 (e.g., LM Studio)
    ↓ (3 retries fail)
Error returned to user
```

**Configuration**:
```json
{
  "profiles": {
    "primary": {
      "baseURL": "https://api.openai.com/v1",
      "fallbackProfiles": ["backup", "local"]
    },
    "backup": {
      "baseURL": "https://backup-api.com/v1"
    },
    "local": {
      "baseURL": "http://localhost:11434/v1"
    }
  }
}
```

### Retry Timing

```
Attempt 1: immediate
Attempt 2: 1 second later
Attempt 3: 2 seconds later
Attempt 4: 4 seconds later
Total: ~7 seconds per profile before moving to fallback
```

---

## Debugging Tips

### Enable Detailed Logging

Add to `backend/src/llm/client.ts`:

```typescript
console.log('[LLM DEBUG] Full error:', error);
console.log('[LLM DEBUG] Profile:', profile);
console.log('[LLM DEBUG] Request:', baseOptions);
```

### Check Server Health

```bash
# For Ollama
curl http://localhost:11434/api/tags

# For LM Studio
curl http://localhost:1234/v1/models

# For vLLM
curl http://localhost:8000/v1/models

# For OpenAI (requires auth)
curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models
```

### Monitor Console Logs

Watch for patterns:
```
[LLM] Attempt N/3          ← Which retry attempt
[LLM] Making call to       ← Which model/endpoint
[LLM] API call failed      ← Error occurred
[LLM] Retryable error      ← Will retry
[LLM] Non-retryable error  ← Will skip retries, try fallback
[LLM] Retry succeeded      ← Recovered successfully
```

### Test Templates

```bash
cd backend
npm test -- llm-template.test.ts
```

Expected output:
```
✓ Template Files Exist (2)
✓ Template Content Validation (4)
✓ Template Variables (3)
✓ Fallback Behavior (2)
// ... etc
```

---

## Common Error Scenarios

### Scenario 1: Local Model Setup

```
Error: ECONNREFUSED localhost:11434
```

**Steps to Fix**:
1. Terminal 1: `ollama serve`
2. Terminal 2: `ollama pull llama2`
3. Update config to use `"template": "llama2"`
4. Restart RoleForge
5. Try chat again

### Scenario 2: Cloud API Quota

```
429 You exceeded your current quota
```

**Steps to Fix**:
1. Add local fallback in config
2. Switch to Ollama or LM Studio for development
3. Upgrade OpenAI tier for production

### Scenario 3: Network Instability

```
Multiple ETIMEDOUT errors
```

**Steps to Fix**:
1. Verify internet connection
2. Check if backend server is slow
3. Reduce `maxContextTokens` to send smaller requests
4. Use local backend (Ollama) if internet unreliable

---

## Testing Error Scenarios

### Simulate Connection Error

```bash
# Stop Ollama, then try to use it
# RoleForge will retry, then fallback
```

### Simulate Rate Limit

```bash
# Make rapid requests with OpenAI
# Observe retry behavior in logs
```

### Simulate Server Error

```bash
# Temporarily stop local backend server
# RoleForge auto-retries
# When server comes back up, succeeds
```

---

## Performance Optimization

### Reduce Timeout Latency

```json
{
  "sampler": {
    "maxContextTokens": 2048,      // Reduce = faster
    "max_completion_tokens": 200   // Reduce = faster
  }
}
```

### Use Faster Backend

1. Local > Cloud
2. Smaller model > Larger model
3. vLLM > Ollama > LM Studio (speed-wise)

### Monitor Metrics

```
Response time:  [LLM] Making call...
                [LLM] Retry succeeded  ← See this in logs
                      (measure time between)

API Key usage:  Check https://platform.openai.com/usage (OpenAI)

Error rate:     Count [LLM] API call failed in logs
```

---

## When to Ask for Help

### Provide These Details

1. **Error message** (exact text)
2. **Config snippet** (sanitize API keys!)
3. **Backend used** (OpenAI, Ollama, etc.)
4. **Console logs** (from npm run dev:backend)
5. **Steps to reproduce** (what triggers error)

### Example Report

```
Error: 401 Incorrect API key
Config: Using OpenAI profile with baseURL https://api.openai.com/v1
Backend: OpenAI API (cloud)
Steps: Started backend, sent message, got error

Logs:
[LLM] Attempt 1/3 on profile https://api.openai.com/v1
[LLM] API call failed: 401 Incorrect API key provided
[LLM] Non-retryable error: 401
```

---

## Quick Reference

| Error | Auto-Retry? | Fix | Time to Fix |
|-------|-------------|-----|------------|
| Connection refused | Yes | Start server | 1 min |
| API key invalid | No | Get new key | 5 min |
| Rate limited | Yes | Wait or upgrade | 0 min (automatic) |
| Rate limited (persistent) | No | Use fallback | 5 min |
| Server down | Yes | Wait | 0 min (automatic) |
| Template not found | No | Fix config | 1 min |
| Invalid JSON | No | Fix syntax | 2 min |
| Timeout | Yes | Reduce context | 1 min |

---

## Summary

- ✅ **Configuration errors**: Check JSON syntax and profile names
- ✅ **Network errors**: RoleForge auto-retries, uses fallback profiles
- ✅ **API errors**: Check logs for specific error code
- ✅ **Template errors**: Run tests, verify variables present
- ✅ **Debugging**: Check console logs for [LLM] tags

---

**Last Updated**: January 12, 2026  
**Retry Logic**: Implemented with exponential backoff  
**Fallback Support**: Full cascade implemented  
**Test Coverage**: All error scenarios tested
