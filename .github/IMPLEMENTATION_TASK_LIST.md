# Implementation Task List: LLM Client Improvements

**Scope**: All items from DISCREPANCIES_AND_ACTION_ITEMS.md EXCEPT:
- ✗ Claude (no Anthropic SDK integration)
- ✗ OpenRouter (no native support)
- ✗ TextGenerationWebUI (unless using OpenAI endpoint)

**Total Effort**: ~12-20 hours  
**Phases**: 3 (Critical → Robustness → Polish)

---

## Phase 1: Critical Fixes (3.5-4 hours) 🚀

These must be completed first; they're blocking and foundational.

### Task 1.1: Fix renderLLMTemplate() to use profile.template
**Priority**: CRITICAL  
**Effort**: 30 minutes  
**Dependencies**: None  
**Files**: `backend/src/agents/BaseAgent.ts`

**Description**:
The renderLLMTemplate() method reads `profile.template` but doesn't validate the file exists. If a template other than 'chatml' is configured, the app crashes silently.

**Acceptance Criteria**:
- [ ] renderLLMTemplate() validates template file exists
- [ ] If template missing, logs warning and falls back to 'chatml'
- [ ] No runtime exceptions on missing templates
- [ ] Unit test added for fallback behavior

**Implementation Steps**:
1. Open `backend/src/agents/BaseAgent.ts` at line 185
2. Add file existence check before reading
3. Implement fallback to 'chatml' if file not found
4. Add console.warn() logging
5. Add unit test in `__tests__/` for fallback case

**Code Location**: [backend/src/agents/BaseAgent.ts#L185](../backend/src/agents/BaseAgent.ts#L185)

---

### Task 1.2: Create missing LLM template files
**Priority**: CRITICAL  
**Effort**: 1-2 hours  
**Dependencies**: Task 1.1 (fix must be in place first)  
**Files**: 
- `backend/src/llm_templates/alpaca.njk` (NEW)
- `backend/src/llm_templates/vicuna.njk` (NEW)
- `backend/src/llm_templates/llama2.njk` (NEW - optional)

**Description**:
Create Nunjucks templates for popular fine-tuned model formats. These enable RoleForge to work with models trained on Alpaca, Vicuna, and Llama2 instruction formats.

**Acceptance Criteria**:
- [ ] alpaca.njk created with correct format
- [ ] vicuna.njk created with correct format
- [ ] llama2.njk created (optional)
- [ ] Each template has {{system_prompt}}, {{user_message}}, {{assistant_message}} placeholders
- [ ] Templates render without errors
- [ ] Templates tested with actual LLM calls

**Reference Formats**:

**Alpaca Format**:
```
### Instruction:
{system_prompt}
### Input:
{user_message}
### Response:
{assistant_message}
```

**Vicuna Format**:
```
A chat between a curious user and an artificial intelligence assistant.

USER: {system_prompt}
{user_message}
ASSISTANT: {assistant_message}
```

**Llama2 Format**:
```
[INST] <<SYS>>
{system_prompt}
<</SYS>>

{user_message} [/INST] {assistant_message}
```

**Implementation Steps**:
1. Create `backend/src/llm_templates/alpaca.njk` with Alpaca format
2. Create `backend/src/llm_templates/vicuna.njk` with Vicuna format
3. Create `backend/src/llm_templates/llama2.njk` with Llama2 format
4. Test each template renders correctly
5. Update config.json to reference templates
6. Test with actual LLM calls (if possible)

**Testing**:
- Set `profile.template = "alpaca"` in config.json
- Verify system loads template without error
- Send a message and verify LLM receives correctly formatted prompt

---

### Task 1.3: Add template validation tests
**Priority**: CRITICAL  
**Effort**: 30 minutes  
**Dependencies**: Task 1.1, 1.2  
**Files**: `backend/src/__tests__/llm-template.test.ts` (NEW)

**Description**:
Create unit tests to verify all templates load and render correctly.

**Acceptance Criteria**:
- [ ] Test file created: `__tests__/llm-template.test.ts`
- [ ] Tests verify all templates exist and load
- [ ] Tests verify renderLLMTemplate() with each template
- [ ] Tests verify fallback behavior on missing template
- [ ] All tests pass

**Test Cases**:
1. Load chatml.njk and verify renders
2. Load alpaca.njk and verify renders
3. Load vicuna.njk and verify renders
4. Load llama2.njk and verify renders
5. Request non-existent template, verify fallback to chatml
6. Verify placeholders exist in all templates

**Implementation Steps**:
1. Create `backend/src/__tests__/llm-template.test.ts`
2. Write test for each template
3. Write test for fallback behavior
4. Run tests: `npm test`
5. Ensure all pass before moving to Phase 2

---

## Phase 2: Robustness Improvements (3-5 hours) ⚙️

These improve error handling and system reliability.

### Task 2.1: Implement error fallback mechanism
**Priority**: HIGH  
**Effort**: 2-3 hours  
**Dependencies**: Task 1.1-1.3 (Phase 1 complete)  
**Files**: 
- `backend/src/llm/client.ts`
- `backend/src/configManager.ts`

**Description**:
Add fallback profile mechanism so if primary LLM fails, system automatically tries backup profiles with retry logic.

**Acceptance Criteria**:
- [ ] LLMProfile interface includes `fallbackProfiles?: string[]`
- [ ] chatCompletion() tries fallback on error
- [ ] Retry logic with exponential backoff (1s, 2s, 4s...)
- [ ] Max 3 retries on primary, then move to fallback
- [ ] Detailed error logging for debugging
- [ ] Tests verify fallback behavior

**Configuration Example**:
```json
{
  "profiles": {
    "openai": {
      "baseURL": "http://localhost:5001/v1",
      "model": "gpt-3.5-turbo",
      "fallbackProfiles": ["kobold", "backup"]
    },
    "kobold": {
      "baseURL": "http://backup-server:5001/v1",
      "model": "mistral"
    },
    "backup": {
      "baseURL": "http://remote-api:8000/v1",
      "model": "llama2"
    }
  }
}
```

**Implementation Steps**:
1. Update `LLMProfile` interface in configManager.ts:
   ```typescript
   interface LLMProfile {
     // ... existing fields
     fallbackProfiles?: string[];
   }
   ```

2. Update `chatCompletion()` in client.ts:
   - Add retry counter (0-3)
   - On error, check if retry count < 3
   - If yes: wait (exponential backoff), retry same profile
   - If no: move to next profile in fallbackProfiles
   - If all fail: throw error with full chain logged

3. Add helper function for exponential backoff:
   ```typescript
   function getBackoffDelay(retryCount: number): number {
     return Math.pow(2, retryCount) * 1000;
   }
   ```

4. Add comprehensive error logging showing:
   - Which profile tried
   - Which fallback tried next
   - Full error details
   - Full retry sequence

5. Write tests:
   - Test retry on first attempt
   - Test fallback to second profile
   - Test all profiles fail
   - Test max retries enforced

**Testing**:
- Manually stop LLM API, verify fallback works
- Configure 2-3 profiles, verify cascade
- Monitor logs for retry sequence

---

### Task 2.2: Implement retry logic with exponential backoff
**Priority**: HIGH  
**Effort**: 1-1.5 hours  
**Dependencies**: Task 2.1  
**Files**: `backend/src/llm/client.ts`

**Description**:
Refine retry logic to use proper exponential backoff with jitter for robust failure handling.

**Acceptance Criteria**:
- [ ] Retry happens 3 times before moving to fallback
- [ ] Exponential backoff: 1s → 2s → 4s
- [ ] Optional jitter to prevent thundering herd (if multi-client)
- [ ] Configurable retry count (default 3)
- [ ] Tests verify delays are correct
- [ ] Logs show retry attempts with timing

**Implementation Steps**:
1. Create retry configuration in LLMProfile:
   ```typescript
   interface LLMProfile {
     // ... existing
     retryConfig?: {
       maxRetries?: number;      // default 3
       initialDelayMs?: number;  // default 1000
       backoffMultiplier?: number; // default 2
       jitterFactor?: number;    // default 0.1
     }
   }
   ```

2. Implement retry wrapper around chatCompletion:
   ```typescript
   async function chatCompletionWithRetry(
     profile: LLMProfile,
     messages: ChatMessage[],
     retryCount: number = 0
   ): Promise<...> {
     try {
       return await chatCompletion(profile, messages);
     } catch (error) {
       // ... retry logic
     }
   }
   ```

3. Add tests for delay calculations:
   - 1st retry: 1000ms
   - 2nd retry: 2000ms
   - 3rd retry: 4000ms

4. Add integration test with timeout simulation

---

### Task 2.3: Add stop_sequence support validation
**Priority**: MEDIUM  
**Effort**: 1-1.5 hours  
**Dependencies**: Task 1.1-1.3 (templates exist)  
**Files**: 
- `backend/src/llm/client.ts`
- `backend/src/agents/BaseAgent.ts`

**Description**:
Ensure stop sequences from templates are properly passed to LLM APIs and validate they work correctly.

**Acceptance Criteria**:
- [ ] Stop sequences extracted from templates
- [ ] Stop sequences passed to OpenAI API correctly
- [ ] LLM respects stop sequences (validated in tests)
- [ ] Documentation explains stop sequences
- [ ] Tests verify stop behavior

**Implementation Steps**:
1. Update template files to include stop_sequence field:
   ```njk
   {% set stop_sequence = ["### Input:", "### Instruction:"] %}
   {# template content #}
   ```

2. Update renderLLMTemplate() to extract stop_sequence:
   ```typescript
   const stops = template.stop_sequence || [];
   ```

3. Pass stops to OpenAI SDK:
   ```typescript
   const response = await client.chat.completions.create({
     ...baseOptions,
     stop: stops,
   });
   ```

4. Test with model that respects stops (Alpaca, etc.)

5. Document in TEMPLATE_GUIDE.md

---

## Phase 3: Documentation & UX (1-8 hours) 📚

These improve knowledge sharing and user experience.

### Task 3.1: Document template architecture
**Priority**: HIGH  
**Effort**: 1 hour  
**Dependencies**: Task 1.1-1.3, 2.1-2.3  
**Files**: `backend/TEMPLATE_GUIDE.md` (NEW)

**Description**:
Create comprehensive guide for template system so developers and users understand how templates work and how to add new ones.

**Acceptance Criteria**:
- [ ] Document created: `backend/TEMPLATE_GUIDE.md`
- [ ] Explains template file format (Nunjucks)
- [ ] Lists all available templates with descriptions
- [ ] Shows how to create a new template
- [ ] Shows how to configure template in config.json
- [ ] Includes examples for each template type
- [ ] Includes troubleshooting section

**Document Sections**:
1. **Overview**: What are templates, why they matter
2. **Available Templates**: List each template with use cases
3. **Template Format**: Syntax, placeholders, stop sequences
4. **Creating Templates**: Step-by-step guide
5. **Configuration**: How to select templates
6. **Examples**: Sample configs for each template type
7. **Troubleshooting**: Common issues and solutions
8. **API Reference**: Template placeholder variables

**Implementation Steps**:
1. Create `backend/TEMPLATE_GUIDE.md`
2. Fill in all sections with content
3. Include code examples for each section
4. Include troubleshooting for missing template error
5. Link from main README.md
6. Review for clarity and completeness

---

### Task 3.2: Create BACKEND_SUPPORT.md documentation
**Priority**: HIGH  
**Effort**: 30 minutes  
**Dependencies**: None (can do anytime)  
**Files**: `backend/BACKEND_SUPPORT.md` (NEW)

**Description**:
Document which LLM backends are currently supported, which require what configuration, and any known limitations.

**Acceptance Criteria**:
- [ ] Document created: `backend/BACKEND_SUPPORT.md`
- [ ] Lists all supported backends with status
- [ ] Shows configuration examples for each
- [ ] Lists known limitations
- [ ] Explains why Claude/OpenRouter not supported (yet)
- [ ] Links to relevant external resources

**Content**:
```markdown
# Backend Support

## Currently Supported
- ✓ OpenAI (native via SDK)
- ✓ KoboldCPP (via OpenAI endpoint)
- ✓ Any OpenAI-compatible server

## Configuration Examples
[examples for each...]

## Known Limitations
- Claude requires Anthropic SDK (planned)
- OpenRouter not natively supported (planned)

## Future Roadmap
- Backend adapter system for multi-LLM support
```

**Implementation Steps**:
1. Create `backend/BACKEND_SUPPORT.md`
2. Fill in current backend info
3. Add configuration examples
4. Document limitations clearly
5. Link from README
6. Review for accuracy

---

### Task 3.3: Create ERROR_HANDLING.md documentation
**Priority**: MEDIUM  
**Effort**: 30 minutes  
**Dependencies**: Task 2.1-2.3 (error handling exists)  
**Files**: `backend/ERROR_HANDLING.md` (NEW)

**Description**:
Document how error handling works, fallback behavior, and what logs to look for when debugging LLM issues.

**Acceptance Criteria**:
- [ ] Document created: `backend/ERROR_HANDLING.md`
- [ ] Explains retry logic and exponential backoff
- [ ] Explains fallback profile mechanism
- [ ] Shows example error logs
- [ ] Provides debugging guide
- [ ] Lists common errors and solutions

**Content**:
```markdown
# Error Handling

## Overview
RoleForge implements robust error handling with retry logic and fallback profiles.

## Retry Logic
- Retries: 3 attempts on primary profile
- Backoff: 1s → 2s → 4s
- On all retries fail: moves to fallback profile

## Fallback Profiles
- Configured in config.json
- Automatically tried if primary fails
- Cascade through all profiles

## Debugging
- Enable socket logs in config.json
- Look for "LLM API call failed" in logs
- Check which profile was attempted
- Verify profile configuration

## Common Errors
1. "Template X.njk not found" → create template file
2. "Connection refused" → verify LLM server running
3. "401 Unauthorized" → check API key
```

**Implementation Steps**:
1. Create `backend/ERROR_HANDLING.md`
2. Fill in all sections
3. Add example error logs
4. Add debugging checklist
5. Link from README
6. Review with team

---

### Task 3.4: Update config.json documentation in README
**Priority**: MEDIUM  
**Effort**: 30 minutes  
**Dependencies**: Task 3.1-3.3  
**Files**: `backend/README.md` (or main README.md)

**Description**:
Update main README with configuration examples, especially templates and fallback profiles.

**Acceptance Criteria**:
- [ ] README updated with template examples
- [ ] README shows fallback profile configuration
- [ ] Configuration hierarchy documented
- [ ] Links to TEMPLATE_GUIDE.md and ERROR_HANDLING.md
- [ ] New users can configure without external help

**Implementation Steps**:
1. Open main README or backend/README.md
2. Add section: "LLM Configuration"
3. Show basic profile setup
4. Show template selection
5. Show fallback configuration
6. Link to detailed guides
7. Review for new user clarity

---

### Task 3.5: Add frontend LLM configuration UI (Optional - Nice-to-Have)
**Priority**: LOW  
**Effort**: 8-16 hours  
**Dependencies**: Task 1.1-1.3, 2.1-2.3 (backend stable)  
**Files**: `frontend/src/components/LLMConfigModal.tsx` (NEW)

**Description**:
Create optional frontend UI for LLM configuration, allowing users to select profiles, templates, and adjust parameters without editing config.json. (This is polish; implementation only if prioritized)

**Acceptance Criteria**:
- [ ] Component created: LLMConfigModal.tsx
- [ ] Allows profile selection
- [ ] Allows template selection (from available templates)
- [ ] Shows current configuration
- [ ] Allows parameter adjustment (temperature, etc.)
- [ ] Saves to backend
- [ ] Shows validation errors
- [ ] Follows existing UI patterns (like ComfyConfigModal)

**Implementation Steps** (if pursued):
1. Create LLMConfigModal.tsx component
2. Add profile selector dropdown
3. Add template selector (loads from API or static list)
4. Add parameter sliders
5. Add save/cancel buttons
6. Integrate into App.tsx or settings
7. Add backend endpoint if needed: GET /api/llm/config
8. Test UI and backend integration

**Note**: This task is OPTIONAL. Prioritize Phase 1 & 2 first.

---

## Execution Order Summary

### Week 1: Phase 1 (CRITICAL - Do First)
1. **Monday**: Task 1.1 (fix renderLLMTemplate) + 1.2 (create templates)
2. **Tuesday**: Task 1.3 (tests) + 2.1 (error fallback)
3. **Wednesday**: Task 2.2 (retry logic) + 2.3 (stop_sequence)

**Outcome**: All templates work, error recovery in place, tests passing

### Week 2: Phase 2 & 3 (DOCUMENTATION & POLISH)
1. **Thursday**: Task 3.1 (TEMPLATE_GUIDE.md) + 3.2 (BACKEND_SUPPORT.md)
2. **Friday**: Task 3.3 (ERROR_HANDLING.md) + 3.4 (README updates)
3. **Backlog**: Task 3.5 (Frontend UI - optional)

**Outcome**: Full documentation, users can configure system, internal knowledge captured

---

## Testing Strategy

### Per-Task Testing
Each task includes specific acceptance criteria. Test immediately after completion.

### Integration Testing
After Phase 1:
- Test all templates load without error
- Test template switching via config
- Test fallback behavior manually

After Phase 2:
- Test retry logic with simulated failures
- Test exponential backoff timing
- Test stop sequences respected

### End-to-End Testing
After all phases:
1. Configure multiple profiles in config.json
2. Configure fallback profiles
3. Stop primary LLM, verify fallback works
4. Use different templates, verify rendering
5. Verify all documentation accurate
6. Test with team before release

---

## Success Criteria (All Tasks Complete)

- [ ] All templates (ChatML, Alpaca, Vicuna, Llama2) load without error
- [ ] Template selection via config.json works
- [ ] Error fallback mechanism tested and working
- [ ] Retry logic with exponential backoff implemented
- [ ] Stop sequences properly configured in templates
- [ ] TEMPLATE_GUIDE.md complete and clear
- [ ] BACKEND_SUPPORT.md lists all current backends
- [ ] ERROR_HANDLING.md provides debugging guidance
- [ ] README updated with configuration examples
- [ ] All tests passing
- [ ] No runtime exceptions on missing templates
- [ ] Fallback tested (primary fails, backup succeeds)
- [ ] Zero technical debt from implementation

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Templates fail to load | Fallback to chatml implemented (Task 1.1) |
| Retry logic causes infinite loops | Max retries enforced (Task 2.2) |
| Stop sequences break LLM output | Tested with real models (Task 2.3) |
| Documentation becomes outdated | Review before each release |
| Frontend UI scope creeps | Mark as LOW priority, implement last |

---

## Dependencies & Blockers

```
Task 1.1 (Fix renderLLMTemplate)
    ↓
Task 1.2 (Create templates) - BLOCKED until 1.1 done
    ↓
Task 1.3 (Template tests) - BLOCKED until 1.2 done
    ↓
Phase 1 Complete
    ↓
Task 2.1 (Error fallback) - Can start once Phase 1 complete
    ↓
Task 2.2 (Retry logic) - Can start once 2.1 started
    ↓
Task 2.3 (Stop sequences) - Can start once templates complete
    ↓
Phase 2 Complete
    ↓
Phase 3 (Documentation) - Can start any time, ideally after Phase 1
```

---

## Effort Breakdown

| Phase | Task | Effort | Total |
|-------|------|--------|-------|
| **Phase 1** | 1.1 Fix template loading | 30 min | **3.5-4 hours** |
| | 1.2 Create templates | 1-2 hrs | |
| | 1.3 Add tests | 30 min | |
| | | | |
| **Phase 2** | 2.1 Error fallback | 2-3 hrs | **4-5.5 hours** |
| | 2.2 Retry logic | 1-1.5 hrs | |
| | 2.3 Stop sequences | 1-1.5 hrs | |
| | | | |
| **Phase 3** | 3.1 Template guide | 1 hr | **3-3.5 hours** |
| | 3.2 Backend support doc | 30 min | |
| | 3.3 Error handling doc | 30 min | |
| | 3.4 README updates | 30 min | |
| | 3.5 Frontend UI (optional) | 8-16 hrs | **0 hours** (skipped) |
| | | | |
| **TOTAL** | | | **~11-13 hours** |

**Note**: Excluding Claude/OpenRouter/TextGenerationWebUI support saves ~2-3 days of work.

---

## Sign-Off & Handoff

### Before Starting
- [ ] Confirm all tasks with team
- [ ] Assign tasks to developers
- [ ] Set up feature branch: `feature/llm-improvements`

### After Each Phase
- [ ] All tests passing
- [ ] Code review completed
- [ ] Documentation merged
- [ ] Team sign-off on quality

### Before Release
- [ ] Integration testing complete
- [ ] Documentation reviewed
- [ ] Users trained/informed
- [ ] Monitoring/alerting configured
- [ ] Rollback plan ready

