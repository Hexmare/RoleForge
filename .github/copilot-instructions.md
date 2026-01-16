# Copilot Instructions - Coding Standards & Conventions

**Last Updated:** January 14, 2026

**CRITICAL DIRECTION**: 
  - DO NOT EVER ASK TO COMMIT OR GENERATE Pull requests FOR ANYHTING IN THIS PROJECT. THE USER WILL HANDLE ALL OF THAT THEMSELVES.

> **For detailed implementation status, architecture, and feature documentation, see** `DevDocumentation/IMPLEMENTATION_STATUS.md` and keep [`.github/RoleForgeDesign.md`](.github/RoleForgeDesign.md) up to date as the live design snapshot.

---

## Project Overview

**Project Name**: RoleForge  
**Type**: Full-stack TypeScript AI roleplay platform  
**Status**: Phases 1-5 Complete, Phases 6-8 Planned

RoleForge is a multi-agent orchestration system for AI-guided interactive fiction. It uses Node.js + Express backend, React frontend, SQLite persistence, and LLM proxy integration. The system emphasizes **modularity, extensibility, and pure JavaScript/TypeScript** (no Python).

---

## Tech Stack & Key Libraries

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Node.js, Express, Socket.io | HTTP API, real-time events |
| **Frontend** | React (TypeScript), Vite, Tailwind | UI, styling, build |
| **Database** | SQLite (better-sqlite3) | Persistent storage |
| **Templating** | Nunjucks | Dynamic prompt assembly (Jinja-like) |
| **LLM** | OpenAI SDK, Axios | API integration (OpenAI-compatible, Kobold) |
| **Real-time** | Socket.io | Bidirectional chat events |

---

## Coding Standards

### Language & Format

- **Language**: TypeScript (strict mode)
- **Style**: Curly braces required, no implicit types
- **File Extensions**: `.ts` (backend), `.tsx` (React components)
- **Naming**: 
  - Classes: `PascalCase` (e.g., `WorldService`, `CharacterAgent`)
  - Functions: `camelCase` (e.g., `updateState`, `parseInput`)
  - Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
  - Files: `kebab-case` for utilities (e.g., `token-counter.ts`), `PascalCase` for classes (e.g., `WorldService.ts`)

### Type Safety

```typescript
// ✅ DO: Explicit types
async function updateState(id: number, updates: { name: string; description?: string }): Promise<void> {
  // Implementation
}

// ❌ DON'T: Implicit `any`
async function updateState(id, updates) {
  // Implementation
}
```

### Error Handling

```typescript
// ✅ DO: Detailed error context
try {
  const result = await someAsyncOperation();
} catch (error) {
  console.error('Failed to process request', { 
    context: 'operationName', 
    error, 
    input: relevantData 
  });
  throw new Error(`Operation failed: ${error.message}`);
}

// ✅ DO: Retryable error detection
function isRetryableError(error: any): boolean {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') return true;
  if (error.status && [408, 429, 500, 502, 503, 504].includes(error.status)) return true;
  return false;
}
```

### Async/Await & Promises

```typescript
// ✅ DO: Explicit Promise types
async function fetchData(url: string): Promise<DataType> {
  const response = await fetch(url);
  return response.json();
}

// ✅ DO: Parallel operations when independent
const [worlds, campaigns] = await Promise.all([
  WorldService.getAll(),
  CampaignService.getAll()
]);

// ❌ DON'T: Unnecessary nesting
const result = await asyncOp1();
const result2 = await asyncOp2(result); // Only if sequential!
```

### Database Access

```typescript
// ✅ DO: Use prepared statements
const stmt = db.prepare('SELECT * FROM Table WHERE id = ?');
const result = stmt.get(id);

// ✅ DO: Validate rows exist
if (!result) {
  throw new Error(`Item with id ${id} not found`);
}

// ❌ DON'T: String concatenation (SQL injection risk)
const result = db.exec(`SELECT * FROM Table WHERE id = ${id}`);
```

### JSON Serialization

```typescript
// ✅ DO: Explicit JSON.stringify for DB storage
db.prepare('UPDATE Table SET data = ? WHERE id = ?').run(
  JSON.stringify(jsonObject),
  id
);

// ✅ DO: Parse JSON from DB
const raw = db.prepare('SELECT data FROM Table WHERE id = ?').get(id);
const parsed = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;

// ✅ DO: Validate against "default" sentinel
if (value && value !== 'default' && value !== 'Default') {
  // Use value
}
```

### React Components

```typescript
// ✅ DO: Functional components with hooks
export const MyComponent: React.FC<{ prop: string }> = ({ prop }) => {
  const [state, setState] = useState<StateType>(initialValue);
  
  useEffect(() => {
    // Side effect
  }, [dependencies]);
  
  return <div>{state}</div>;
};

// ✅ DO: Prop interfaces
interface MyComponentProps {
  title: string;
  onSelect?: (id: number) => void;
  children?: React.ReactNode;
}

// ✅ DO: Use Tailwind classes
<div className="flex items-center gap-2 p-4 bg-slate-800 rounded">
  {/* Content */}
</div>
```

### Agent Implementation

```typescript
// ✅ DO: Extend BaseAgent
export class CustomAgent extends BaseAgent {
  constructor(configManager: ConfigManager, env: nunjucks.Environment) {
    super('custom', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    const systemPrompt = this.renderTemplate('custom', context);
    const response = await this.callLLM(systemPrompt, context.userInput);
    return this.cleanResponse(response as string);
  }
}

// ✅ DO: Define clear context requirements
interface AgentContext {
  userInput: string;
  history: string[];
  worldState: Record<string, any>;
  character?: CharacterData;
  // ... other fields
}
```

### Nunjucks Templates

```njk
{# ✅ DO: Comments for clarity #}
{{ variable }}                      {# Variable insertion #}
{{ object.property }}               {# Nested property access #}
{{ value | default("fallback") }}   {# Filters #}
{% for item in array %}             {# Loops #}
{% if condition %}                  {# Conditionals #}

{# ❌ DON'T: Overly complex logic #}
{% if complex.nested.condition and other.value %}

{# ✅ DO: Comments explaining JSON output format #}
{# Output: {"response": "...", "state": {...}} #}
```

### Socket.io Events

```typescript
// ✅ DO: Namespaced event handlers
io.to(`scene-${sceneId}`).emit('stateUpdated', { state, trackers });

// ✅ DO: Type-safe event payloads
interface StateUpdatedEvent {
  state: Record<string, any>;
  trackers: TrackersType;
}

// ✅ DO: Handle missing scene gracefully
if (!sceneId) {
  console.warn('Cannot emit event: sceneId required');
  return;
}
```

---

## File Organization

### Backend Structure
```
backend/src/
├── agents/              # Agent implementations (extend BaseAgent)
│   ├── BaseAgent.ts
│   ├── CharacterAgent.ts
│   ├── WorldAgent.ts
│   └── ...
├── services/            # Data services (CRUD, business logic)
│   ├── WorldService.ts
│   ├── CampaignService.ts
│   └── ...
├── llm/                 # LLM integration
│   ├── client.ts        # OpenAI SDK wrapper
│   └── customClient.ts
├── prompts/             # Nunjucks templates (.njk)
│   ├── character.njk
│   ├── world.njk
│   └── ...
├── utils/               # Utilities & helpers
│   ├── token-counter.ts
│   ├── json-repair.ts
│   └── lore-matcher.ts
├── server.ts            # Express setup
├── database.ts          # SQLite initialization
└── configManager.ts     # LLM profile management
```

### Frontend Structure
```
frontend/src/
├── components/          # React components
│   ├── Chat.tsx
│   ├── WorldStatus.tsx
│   ├── Panel.tsx
│   └── ...
├── App.tsx              # Root component
├── index.css            # Tailwind + custom styles
└── types/               # TypeScript interfaces
```

---

## Common Patterns

### Service CRUD Pattern
```typescript
export const MyService = {
  // Create
  create(name: string, description?: string) {
    const stmt = db.prepare('INSERT INTO MyTable (name, description) VALUES (?, ?)');
    const result = stmt.run(name, description || null);
    return { id: result.lastInsertRowid, name, description };
  },

  // Read
  getById(id: number) {
    return db.prepare('SELECT * FROM MyTable WHERE id = ?').get(id);
  },

  // Update
  update(id: number, { name, description }: { name?: string; description?: string }) {
    const stmt = db.prepare('UPDATE MyTable SET name = ?, description = ? WHERE id = ?');
    return stmt.run(name, description, id);
  },

  // Delete
  delete(id: number) {
    const stmt = db.prepare('DELETE FROM MyTable WHERE id = ?');
    return stmt.run(id);
  }
};
```

### State Merge Pattern
```typescript
const existing = StateService.get(id);
if (!existing) {
  // Create with defaults
  StateService.create(id, { ...defaults, ...updates });
} else {
  // Update only provided fields
  StateService.update(id, {
    field1: updates.field1 !== undefined ? updates.field1 : existing.field1,
    field2: updates.field2 !== undefined ? updates.field2 : existing.field2
  });
}
```

### Orchestrator Agent Chaining
```typescript
// Initialize
this.emitAgentStatus('agent-name', 'start', sceneId);

try {
  // Run agent
  const response = await agent.run(context);
  
  // Parse response
  let parsed: any = null;
  let retries = 0;
  while (retries < 3) {
    try {
      parsed = JSON.parse(response);
      break;
    } catch (e) {
      // Try repair logic
      const repaired = tryJsonRepair(response);
      if (repaired) {
        try {
          parsed = JSON.parse(repaired);
          break;
        } catch {}
      }
    }
    retries++;
  }
  
  // Use parsed result
} finally {
  this.emitAgentStatus('agent-name', 'complete', sceneId);
}
```

---

## Testing & Validation

### Unit Tests
```typescript
// ✅ DO: Test with Vitest
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MyService', () => {
  let db: any;

  beforeEach(() => {
    db = setupTestDb();
  });

  it('should create item with correct fields', () => {
    const result = MyService.create('test', 'description');
    expect(result.name).toBe('test');
    expect(result.id).toBeDefined();
  });

  it('should throw on invalid input', () => {
    expect(() => MyService.create('', 'desc')).toThrow();
  });
});
```

### Type Checking
```bash
# Validate TypeScript types
npx tsc --noEmit

# Fix type errors before committing
```

---

## Performance Best Practices

### Token Management
```typescript
// ✅ DO: Trim context based on token budget
const maxTokens = profile.sampler?.maxContextTokens || 4096;
const trimmedMessages = trimMessages(messages, maxTokens);

// ✅ DO: Estimate tokens before API call
const tokens = estimateTokens(prompt);
if (tokens > maxTokens) {
  // Handle overflow
}
```

### Database Queries
```typescript
// ✅ DO: Use indexes for frequent queries
// CREATE INDEX idx_scene_id ON Messages(sceneId);

// ✅ DO: Limit result sets
const messages = db.prepare(
  'SELECT * FROM Messages WHERE sceneId = ? LIMIT ? OFFSET ?'
).all(sceneId, limit, offset);
```

### Lazy Loading
```typescript
// ✅ DO: Load related data on demand
const campaign = CampaignService.getById(id);
const arcs = campaign ? ArcService.listByCampaign(campaign.id) : [];

// ❌ DON'T: Load everything upfront
const campaigns = CampaignService.getAll();
const allArcs = campaigns.map(c => ArcService.listByCampaign(c.id));
```

---

## Debugging Tips

### Enable Logging
```typescript
// ✅ DO: Contextual console logs
console.log('[AGENT] Calling CharacterAgent for "Alex"');
console.log('[LLM] Making call to model:', model);
console.warn('[WORLD] Failed to parse state:', error);

// ✅ DO: Log before state changes
console.log('Character states before:', Object.keys(characterStates));
// ... modify ...
console.log('Character states after:', Object.keys(characterStates));
```

### Socket.io Debugging
```typescript
// ✅ DO: Listen to all events for debugging
io.onAny((eventName, ...args) => {
  console.debug('[SOCKET]', eventName, args);
});
```

---

## Deployment Checklist

- [ ] All TypeScript compiles without errors (`npm run build`)
- [ ] All tests pass (`npm run test`)
- [ ] `backend/config.json` configured with production endpoints
- [ ] Database migrations applied
- [ ] LLM API keys set in environment variables
- [ ] Frontend built and optimized
- [ ] Error logging configured
- [ ] Database backups enabled

---

## References & Further Reading

- **Implementation Status**: `DevDocumentation/IMPLEMENTATION_STATUS.md` - Complete feature list, architecture, and status
- **Agent Design**: `DevDocumentation/agent-design.md` - Detailed agent specifications
- **Backend Support**: `backend/BACKEND_SUPPORT.md` - Backend development guide
- **Error Handling**: `backend/ERROR_HANDLING.md` - Error patterns and recovery
- **Template Guide**: `backend/TEMPLATE_GUIDE.md` - Nunjucks usage guide

---

## Questions?

For detailed implementation information, refer to `DevDocumentation/IMPLEMENTATION_STATUS.md`. For architecture questions, check `DevDocumentation/agent-design.md`.
