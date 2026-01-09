# RoleForge Monorepo Setup Instructions for GitHub Copilot

**Goal**: Create a fully functional monorepo with a Node.js/TypeScript backend (Express + Socket.io) and a Vite + React TypeScript frontend, configured for concurrent development. This is Phase 1 of the RoleForge project.

**Execute these steps exactly in order**. All commands are Windows PowerShell compatible (tested on npm v10+ as of January 2026).

### 1. Root Project Initialization

Open PowerShell in `C:\AI_Tools\RoleForge` and run:

```powershell
# Initialize root package.json (if not already done)
npm init -y

# Set basic metadata
npm pkg set name=roleforge
npm pkg set version=0.1.0
npm pkg set private=true

# Set workspaces (escape inner quotes for PowerShell)
npm pkg set workspaces="[\"\"backend\"\",\"\"frontend\"\",\"\"shared\"\"]"

# Add root scripts (escape inner quotes)
npm pkg set scripts.dev="concurrently \"npm run dev:backend\" \"npm run dev:frontend\""
npm pkg set scripts.build="tsc -b && cd frontend && npm run build"

# Install root dev dependencies
npm i -D typescript @types/node concurrently nodemon
```

### 2. Create Workspace Folders

```powershell
mkdir backend frontend shared
```

### 3. Backend Workspace Setup

```powershell
cd backend

npm init -y

# Enable ESM (required for import/export syntax)
npm pkg set type=module

# Production dependencies
npm i express socket.io nunjucks axios openai

# Development dependencies
npm i -D typescript ts-node nodemon @types/express @types/node @types/socket.io @types/nunjucks

cd ..
```

### 4. Frontend Workspace Setup (Vite + React TS)

```powershell
cd frontend

# Create Vite React TypeScript project (answer prompts: project name ".", framework React, variant TypeScript)
npm create vite@latest . -- --template react-ts

# Install Socket.io client
npm i socket.io-client

cd ..
```

### 5. TypeScript Configuration

**Root tsconfig.json** (create at project root `C:\AI_Tools\RoleForge\tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "composite": true,
    "declaration": true
  },
  "include": ["backend/src/**/*", "frontend/src/**/*", "shared/src/**/*"]
}
```

**Backend tsconfig.json** (create at `backend/tsconfig.json`)

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/backend"
  },
  "include": ["src/**/*"]
}
```

### 6. Initial Backend Code

Create folder and file: `backend/src/server.ts`

```ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('userMessage', (msg: string) => {
    console.log('User:', msg);
    // Temporary echo - will replace with LLM call in Phase 2
    socket.emit('aiResponse', `Echo: ${msg}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
```

Add backend dev script: `backend/package.json` → add to scripts

```json
"scripts": {
  "dev:backend": "nodemon --watch src --exec ts-node src/server.ts"
}
```

### 7. Frontend Proxy Configuration

Edit `frontend/vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true
      }
    }
  }
});
```

### 8. Basic Frontend Chat UI

Replace `frontend/src/App.tsx` with:

```tsx
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3001');

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socket.on('aiResponse', (msg: string) => {
      setMessages(prev => [...prev, `AI: ${msg}`]);
    });

    return () => {
      socket.off('aiResponse');
    };
  }, []);

  const sendMessage = () => {
    if (input.trim()) {
      socket.emit('userMessage', input);
      setMessages(prev => [...prev, `You: ${input}`]);
      setInput('');
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="app">
      <h1>RoleForge - Phase 1 Test</h1>
      <div className="chat-window">
        {messages.map((msg, i) => (
          <p key={i} className={msg.startsWith('You:') ? 'user' : 'ai'}>
            {msg}
          </p>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}

export default App;
```

Add minimal CSS `frontend/src/App.css`:

```css
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

.chat-window {
  height: 60vh;
  overflow-y: auto;
  border: 1px solid #ccc;
  padding: 10px;
  margin-bottom: 10px;
  background: #f9f9f9;
}

.user { text-align: right; color: blue; }
.ai { text-align: left; color: green; }

.input-area {
  display: flex;
  gap: 10px;
}

input {
  flex: 1;
  padding: 10px;
  font-size: 16px;
}

button {
  padding: 10px 20px;
  font-size: 16px;
}
```

### 9. Run the Project

From root directory:

```powershell
npm run dev
```

Expected result:
- Backend starts on port 3001
- Vite dev server starts on port 5173
- Open http://localhost:5173 → type a message → see echo response

**Success**: You now have a working real-time chat foundation for RoleForge.

Next phase: LLM integration with config profiles (Phase 2).
```