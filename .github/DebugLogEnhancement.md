# Debugging in RoleForge with the `debug` Package

RoleForge uses the lightweight **`debug`** package for structured, toggleable logging across backend (Node.js) and frontend (browser).  
This replaces noisy `console.log` statements and lets you enable/disable specific sections (e.g. LLM calls, image generation, UI rendering) independently without changing code.

## Package Information

- **NPM Package**: `debug`  
- **Repository**: https://github.com/debug-js/debug  
- **Description**: A tiny JavaScript debugging utility modelled after Node.js core's debugging technique. Works in Node.js **and** web browsers.  
- **Why we use it**: Namespace-based toggling (not just log levels), zero-cost when disabled, cross-platform, tiny footprint (~4KB).

## Installation

```PowerShell
npm install debug
```

(or `yarn add debug` / `pnpm add debug`)

## Basic Usage

Create a debug instance for each logical section of the app using a namespace:

```javascript
// Backend or frontend file
const debug = require('debug');           // CommonJS
// or
import debug from 'debug';               // ESM

const llmDebug    = debug('roleforge:llm');
const imageDebug  = debug('roleforge:image:gen');
const uiDebug     = debug('roleforge:ui:render');
const storyDebug  = debug('roleforge:story:guide');

// Then use like console.log, but only outputs when enabled
llmDebug('Sending prompt to Kobold/OpenAI backend: %s', prompt);
imageDebug('Generated image with seed %d → %s', seed, url);
uiDebug('Rendering scene: %o', sceneData);
```

Supported formatters: `%s`, `%d`, `%j`/`%o` (objects), etc. — same as `util.format`.

## Namespaces (Sections) – Recommended Pattern for RoleForge

Use hierarchical namespaces starting with `roleforge:` for easy wildcard matching.

Examples:
- `roleforge:llm`               → general LLM interactions
- `roleforge:llm:prompt`        → prompt construction
- `roleforge:llm:response`      → raw model output
- `roleforge:image:gen`         → image generation calls (Stable Diffusion-like)
- `roleforge:image:save`        → local file saving
- `roleforge:ui:render`         → scene / character rendering
- `roleforge:story:guide`       → story progression logic
- `roleforge:backend:*`         → everything backend-only
- `roleforge:frontend:*`        → everything frontend-only

## Configuring Flags via `config.json` (Recommended)

The `debug` package reads from the `DEBUG` environment variable by default, but we load namespaces from **`config.json`** for easier local development.

### 1. Create / Update `config.json`

Place this file in the project root (next to `package.json`).  
Example:

```json
{
  "debug": {
    "enabledNamespaces": "roleforge:llm:*,roleforge:image:gen,roleforge:story:*,-roleforge:llm:verbose",
    "colors": true
  }
}
```

- `enabledNamespaces`: Comma-separated list. Supports:
  - Wildcards: `*`
  - Negation: `-namespace`
  - Examples: `roleforge:*` (everything), `roleforge:llm,-roleforge:llm:verbose` (LLM but not verbose parts)
- `colors`: `true`/`false` (optional – disables terminal colors if needed)

Commit a `config.example.json` and add `config.json` to `.gitignore`.

### 2. Backend – Load from `config.json`

In your main entry file (e.g. `server.js`, `index.js`, or a dedicated `lib/debug-init.js`):

```javascript
const fs = require('fs');
const path = require('path');
const debug = require('debug');

const configPath = path.join(__dirname, 'config.json');
let namespaces = process.env.DEBUG || ''; // fallback to env var

if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.debug?.enabledNamespaces) {
      namespaces = config.debug.enabledNamespaces;
    }
  } catch (err) {
    console.error('Failed to load debug config from config.json:', err.message);
  }
}

if (namespaces) {
  debug.enable(namespaces);
  console.log(`Debug enabled (from config.json / DEBUG env): ${namespaces}`);
}

// Optional: respect colors setting
if (config?.debug?.colors === false) {
  process.env.DEBUG_COLORS = '0';
}
```

Now run your server normally — it uses `config.json` automatically.

### 3. Frontend – Load from `config.json` (or localStorage)

**Option A: Fetch `config.json` at startup** (if serving it statically)

```javascript
// In main.js, app entry, or a debug init module
import debug from 'debug';

async function initDebug() {
  try {
    const res = await fetch('/config.json');
    if (!res.ok) throw new Error('Not found');
    const config = await res.json();
    const namespaces = config.debug?.enabledNamespaces || '';
    if (namespaces) {
      debug.enable(namespaces);
      console.log('Frontend debug enabled from config.json:', namespaces);
    }
  } catch {
    // fallback: use localStorage if exists
    const stored = localStorage.getItem('debug');
    if (stored) debug.enable(stored);
  }
}

initDebug();
```

IMPORTANT: We will NOT use browser `localStorage` for debug configuration. All debug configuration must be persisted in the backend and served to the frontend via a secure endpoint.

Do NOT set `localStorage.debug` in the browser. Instead, the frontend should request the current debug namespaces from the backend at startup (or subscribe to a secure admin-updated channel) and call `debug.enable()` with the received namespaces. The backend is the single source of truth for debug flags and must validate and sanitize any changes (see "Security note" below).

## Quick CLI Overrides (for one-off debugging)

```bash
# Backend – override config.json
DEBUG=roleforge:llm:* node server.js

# Disable everything
DEBUG= node server.js
```

## Tips for RoleForge Development

- Start broad during feature work: `roleforge:llm:*` or `roleforge:image:*`
- Narrow down once stable: `roleforge:llm:response` only
- Use colors in terminal — they make sections easy to spot
- No performance cost when namespaces are disabled
- Great for tracking LLM prompt/response cycles, image gen parameters, Kobold/OpenAI errors, etc.

