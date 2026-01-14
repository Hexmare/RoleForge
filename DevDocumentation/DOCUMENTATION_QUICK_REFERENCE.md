# Documentation Quick Reference

**Updated:** January 14, 2026

---

## The Two Core Files

### 1. `.github/IMPLEMENTATION_STATUS.md`
**Purpose**: Complete reference for all implemented features and architecture  
**Use when**: You need to understand what's built, how it works, or what the database looks like

**Key Sections**:
- Executive Summary (status overview)
- Architecture Overview (tech stack)
- Phase 1-5 Complete sections (what's implemented)
- Agents documentation (8 agents explained)
- Database Schema (all tables)
- API Endpoints (40+ routes)
- Socket.io Events (real-time communication)
- Code Patterns (CRUD, state management)

### 2. `.github/copilot-instructions.md`  
**Purpose**: Coding standards, best practices, and conventions  
**Use when**: You're writing code and need style guidance, patterns, or error handling approaches

**Key Sections**:
- Coding Standards (TypeScript, React, SQL conventions)
- Type Safety (examples and anti-patterns)
- Error Handling (retry logic, logging)
- Common Patterns (CRUD, state merge, agent chaining)
- Performance Best Practices (token budgeting, queries)
- Debugging Tips (logging strategies)
- Deployment Checklist

---

## Reference Files (Kept)

### `.github/agent-design.md`
**Contains**: Detailed specifications for each of 8 agents  
**Use when**: You need deep dive on agent behavior, templates, or intentions

### `.github/*_Schema.json`  
**Contains**: Data structure references for Character, Persona, Lorebook  
**Use when**: You're working with these data models and need field definitions

---

## Common Questions & Where to Find Answers

| Question | File | Section |
|----------|------|---------|
| What features are implemented? | IMPLEMENTATION_STATUS.md | Phases 1-5 |
| How do I structure TypeScript code? | copilot-instructions.md | Coding Standards |
| What's the database schema? | IMPLEMENTATION_STATUS.md | Database Schema |
| How do I call an API endpoint? | IMPLEMENTATION_STATUS.md | API Endpoints |
| What agents exist and what do they do? | IMPLEMENTATION_STATUS.md | Phase 3 |
| How should I handle errors? | copilot-instructions.md | Error Handling |
| What are the design patterns? | copilot-instructions.md | Common Patterns |
| How does character override work? | IMPLEMENTATION_STATUS.md | Phase 5: Character Override System |
| What's the world hierarchy? | IMPLEMENTATION_STATUS.md | Phase 5: Hierarchical Model |
| How do messages persist? | IMPLEMENTATION_STATUS.md | Phase 5: Message Logging |
| What Socket.io events exist? | IMPLEMENTATION_STATUS.md | Socket.io Events |
| How do I optimize performance? | copilot-instructions.md | Performance Best Practices |
| What's planned for Phase 6? | IMPLEMENTATION_STATUS.md | Phase 6-8 (outline) |

---

## Reading Path by Role

### 👨‍💻 **Developer (Adding Features)**
1. Start: `copilot-instructions.md` → Coding Standards
2. Reference: `IMPLEMENTATION_STATUS.md` → Relevant Phase section
3. Pattern: `copilot-instructions.md` → Common Patterns
4. Details: `agent-design.md` (if agents involved) or schema files

### 🏛️ **Architect (System Design)**
1. Start: `IMPLEMENTATION_STATUS.md` → Architecture Overview
2. Deep Dive: Each Phase section (1-5)
3. Schemas: `*_Schema.json` files
4. Agents: `agent-design.md` for multi-agent details

### 🆕 **New Team Member (Onboarding)**
1. Start: `IMPLEMENTATION_STATUS.md` → Executive Summary
2. Overview: `IMPLEMENTATION_STATUS.md` → Architecture Overview
3. Standards: `copilot-instructions.md` → Coding Standards
4. Deep Dive: Specific phase sections as needed

### 🐛 **Debugger (Fixing Issues)**
1. Check: `IMPLEMENTATION_STATUS.md` → Relevant Phase
2. Reference: `IMPLEMENTATION_STATUS.md` → API Endpoints or Database Schema
3. Tips: `copilot-instructions.md` → Debugging Tips
4. Patterns: `copilot-instructions.md` → Error Handling section

### 📦 **DevOps (Deployment)**
1. Checklist: `copilot-instructions.md` → Deployment Checklist
2. Schema: `IMPLEMENTATION_STATUS.md` → Database Schema
3. Config: `IMPLEMENTATION_STATUS.md` → Configuration Management

---

## File Sizes & Quick Stats

- **IMPLEMENTATION_STATUS.md**: 28.2 KB
  - 9 phases (5 complete, 4 outlined)
  - 8 agent specifications
  - 6 database tables
  - 40+ API endpoints
  - 12 Socket.io events

- **copilot-instructions.md**: 13.3 KB
  - 15 coding standards sections
  - 8 common patterns
  - 6 performance practices
  - Development workflow guide

- **Total Documentation**: ~65 KB (focused, maintainable, comprehensive)

---

## Key Features Quick Lookup

### Implemented Features ✅
- Multi-agent orchestration (8 agents)
- Character management with overrides
- Persona system (user profiles)
- Lore/knowledge base system
- World/Campaign/Arc/Scene hierarchy
- Message logging and persistence
- Real-time Socket.io chat
- LLM profile management
- State tracking (world, character, trackers)
- Multi-character conversations
- Inline message editing
- Avatar support

### Planned Features 📋
- Phase 6: Visual generation (images)
- Phase 6b: Audio integration (TTS)
- Phase 7: Response shaping, plugins
- Phase 8: Deployment, optimization

---

## When to Update Documentation

### Update IMPLEMENTATION_STATUS.md When:
- ✏️ Adding Phase 6, 7, 8 features
- ✏️ Changing database schema
- ✏️ Adding/modifying API endpoints
- ✏️ Creating new agents
- ✏️ Updating state management

### Update copilot-instructions.md When:
- ✏️ Establishing new coding patterns
- ✏️ Documenting performance optimizations
- ✏️ Adding debugging techniques
- ✏️ Changing file organization
- ✏️ Updating TypeScript/React best practices

---

## Cross-References

- **IMPLEMENTATION_STATUS.md** → copilot-instructions.md (for coding patterns used in implementation)
- **copilot-instructions.md** → IMPLEMENTATION_STATUS.md (for feature context)
- Both → **agent-design.md** (for detailed agent specifications)
- Both → **Schema files** (for data structure details)

---

## Questions?

- **"What does X do?"** → Check `IMPLEMENTATION_STATUS.md` phases
- **"How do I build X?"** → Check `copilot-instructions.md` patterns  
- **"What's the schema for X?"** → Check `*_Schema.json` or `IMPLEMENTATION_STATUS.md`
- **"How deep is agent X?"** → Check `agent-design.md`

**Everything you need is in these 2 files. No need to search multiple docs.** 📚
