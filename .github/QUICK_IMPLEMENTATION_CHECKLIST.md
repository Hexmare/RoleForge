# Quick Implementation Checklist

**Total Tasks**: 11 | **Total Effort**: ~11-13 hours | **Status**: Ready to Start

---

## Phase 1: Critical Fixes (3.5-4 hours) ✅ START HERE

### ☐ Task 1.1: Fix renderLLMTemplate() 
- **File**: `backend/src/agents/BaseAgent.ts` (line 185)
- **Time**: 30 min
- **What**: Add file existence check, implement fallback to chatml
- **Why**: Prevents crash when template file missing
- **Done When**: Tests pass, logs show fallback working

### ☐ Task 1.2: Create Missing Templates
- **Files**: Create 3 new files in `backend/src/llm_templates/`
  - `alpaca.njk`
  - `vicuna.njk`
  - `llama2.njk`
- **Time**: 1-2 hours
- **What**: Create Nunjucks templates for each format
- **Why**: Enables support for fine-tuned models
- **Done When**: All files created, no render errors

### ☐ Task 1.3: Add Template Tests
- **File**: Create `backend/src/__tests__/llm-template.test.ts`
- **Time**: 30 min
- **What**: Unit tests for all templates + fallback behavior
- **Why**: Ensures reliability, catches regressions
- **Done When**: `npm test` passes, 100% template coverage

---

## Phase 2: Robustness (4-5.5 hours) ⚙️ AFTER PHASE 1

### ☐ Task 2.1: Implement Error Fallback
- **Files**: 
  - `backend/src/configManager.ts` (add to LLMProfile)
  - `backend/src/llm/client.ts` (add fallback logic)
- **Time**: 2-3 hours
- **What**: Auto-try backup profiles if primary fails
- **Why**: System doesn't break on API failure
- **Config**: `"fallbackProfiles": ["kobold", "backup"]`
- **Done When**: Fallback tested, logs show cascade

### ☐ Task 2.2: Add Retry Logic
- **File**: `backend/src/llm/client.ts`
- **Time**: 1-1.5 hours
- **What**: 3 retries with exponential backoff (1s, 2s, 4s)
- **Why**: Handles transient network failures
- **Pattern**: Retry primary before moving to fallback
- **Done When**: Tests verify delays, integration test passes

### ☐ Task 2.3: Validate Stop Sequences
- **Files**: 
  - Template files (add stop_sequence)
  - `backend/src/llm/client.ts` (pass to API)
- **Time**: 1-1.5 hours
- **What**: Ensure stop sequences in templates work
- **Why**: Improves LLM response quality
- **Done When**: Stop sequences respected in responses

---

## Phase 3: Documentation (3-3.5 hours) 📚 CAN DO ANYTIME

### ☐ Task 3.1: Template Architecture Guide
- **File**: Create `backend/TEMPLATE_GUIDE.md`
- **Time**: 1 hour
- **What**: Complete guide on template system
- **Sections**: Overview, formats, examples, troubleshooting
- **Done When**: Guide clear to new developer

### ☐ Task 3.2: Backend Support Doc
- **File**: Create `backend/BACKEND_SUPPORT.md`
- **Time**: 30 min
- **What**: List supported backends with configs
- **Done When**: All current backends documented

### ☐ Task 3.3: Error Handling Guide
- **File**: Create `backend/ERROR_HANDLING.md`
- **Time**: 30 min
- **What**: Debug guide + common errors/solutions
- **Done When**: Users can self-serve on errors

### ☐ Task 3.4: Update README
- **File**: `README.md` or `backend/README.md`
- **Time**: 30 min
- **What**: Add LLM config section with examples
- **Done When**: New users can configure without help

---

## Optional: Frontend UI (8-16 hours) 🎨 LOW PRIORITY

### ☐ Task 3.5: Frontend Config UI
- **File**: Create `frontend/src/components/LLMConfigModal.tsx`
- **Time**: 8-16 hours
- **What**: UI for profile/template/parameter selection
- **Note**: **NOT REQUIRED** for Phase 1-3
- **Status**: Skip unless explicitly prioritized

---

## Testing Checklist

### After Phase 1:
- [ ] `npm test` passes (all template tests)
- [ ] Non-existent template → logs warning, falls back to chatml
- [ ] All 4 templates (ChatML, Alpaca, Vicuna, Llama2) render without error
- [ ] Configuration switching templates works

### After Phase 2:
- [ ] Primary LLM stopped → system retries 3 times
- [ ] All retries fail → moves to fallback profile
- [ ] Exponential backoff timing verified (1s, 2s, 4s)
- [ ] Stop sequences respected by LLM

### After Phase 3:
- [ ] All documentation complete and linked
- [ ] New team member can set up system from docs
- [ ] Error messages point to relevant documentation

---

## Implementation Steps: DO THIS

```
Week 1:
  Mon: 1.1 Fix + 1.2 Create Templates (2.5 hrs)
  Tue: 1.3 Tests + 2.1 Fallback (2.5 hrs)
  Wed: 2.2 Retry + 2.3 Stop Seq (2.5 hrs)
  → Phase 1 & 2 COMPLETE

Week 2:
  Thu: 3.1 Guide + 3.2 Backend (1.5 hrs)
  Fri: 3.3 Errors + 3.4 README (1 hr)
  → All COMPLETE
```

**Total**: ~11 hours over 2 weeks

---

## Success Criteria: ✅ DEFINITION OF DONE

**Task is DONE when:**
- [ ] Code written & tested
- [ ] All acceptance criteria met
- [ ] Peer reviewed
- [ ] Merged to main branch
- [ ] No regressions in other tests

**All tasks COMPLETE when:**
- [ ] Templates work (all 4 formats)
- [ ] Error recovery works (fallback + retry)
- [ ] Tests passing (100% coverage)
- [ ] Documentation done (4 guides created)
- [ ] User can configure without code knowledge
- [ ] System doesn't crash on LLM failure

---

## File Changes Summary

### NEW FILES (6 total)
```
backend/src/llm_templates/
├─ alpaca.njk          (CREATE)
├─ vicuna.njk          (CREATE)
└─ llama2.njk          (CREATE)

backend/src/__tests__/
└─ llm-template.test.ts (CREATE)

.github/
├─ TEMPLATE_GUIDE.md   (CREATE)
├─ BACKEND_SUPPORT.md  (CREATE)
└─ ERROR_HANDLING.md   (CREATE)
```

### MODIFIED FILES (3 total)
```
backend/src/agents/
└─ BaseAgent.ts        (MODIFY: renderLLMTemplate())

backend/src/llm/
└─ client.ts           (MODIFY: add fallback + retry)

backend/src/
└─ configManager.ts    (MODIFY: add fallbackProfiles to interface)

.github/ or backend/
└─ README.md           (UPDATE: add LLM config section)
```

---

## Effort Per Developer

**Developer assigned all tasks**:
- ~13 hours of work
- Spans 2 weeks with 1-2.5 hrs/day
- Realistic: 2-3 developers for 1 week

**Distributed**:
- Dev 1: Phase 1 (3.5 hrs)
- Dev 2: Phase 2 (4.5 hrs)
- Dev 3: Phase 3 (3 hrs) + Reviews

---

## Reporting Progress

**Check these regularly**:

| Milestone | Target Date | Success Indicator |
|-----------|-------------|-------------------|
| Task 1.1 Complete | Day 1 | Tests passing |
| Phase 1 Done | End of Week 1 Day 1 | All templates work |
| Phase 2 Done | End of Week 1 Day 3 | Fallback tested |
| Phase 3 Done | End of Week 2 | Docs complete |
| All Tests Green | Day 10 | `npm test` passes |
| Ready for Release | Day 12 | All criteria met |

---

## Risk Flags 🚩

| Risk | Flag When | Action |
|------|-----------|--------|
| Task 1.1 blocking others | Stuck >30min | Pair program with experienced dev |
| Template creation going slow | >1.5 hrs for 1 template | Simplify template or get help |
| Tests not passing | >1 hr debugging | Review test design, simplify |
| Fallback logic complex | >2 hrs on 2.1 | Use simple try-catch first |
| Documentation not clear | Reader confused | Rewrite with examples |

---

## Questions Before Starting?

**Common Q&A**:

**Q**: Do I have to do all tasks?  
**A**: Yes. Phase 1 & 2 are critical. Phase 3 is essential documentation.

**Q**: Can I skip the tests?  
**A**: No. Tests catch regressions. Include test writing in task time.

**Q**: What if I don't understand a template format?  
**A**: Look up the model documentation online (Alpaca, Vicuna, Llama2).

**Q**: Should I skip Task 3.5 (frontend UI)?  
**A**: YES. Not required. Config.json is sufficient. Do only if explicitly asked.

**Q**: What if a task takes longer?  
**A**: Flag immediately. Break it into smaller pieces or get help.

**Q**: Do I need to know all details before starting?  
**A**: No. IMPLEMENTATION_TASK_LIST.md has all details. Start Task 1.1 now.

---

## Next Steps

1. **CONFIRM**: This task list aligns with your priorities
2. **ASSIGN**: Tasks to developers (or start yourself)
3. **SCHEDULE**: Time blocks for Week 1 & 2
4. **COMMUNICATE**: Share plan with team
5. **EXECUTE**: Start with Task 1.1 (30 min fix)
6. **TRACK**: Mark tasks complete as you go
7. **REPORT**: Daily standup on progress

---

**Ready to start? Begin with Task 1.1 in BaseAgent.ts**

See IMPLEMENTATION_TASK_LIST.md for full details on each task.
