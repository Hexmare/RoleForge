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

## Configuring Flags via localConfig/config.json

The `debug` package still respects the `DEBUG` environment variable, but we prefer loading namespaces from the existing tracked backend configuration (`localConfig/config.json`) so everyone shares the same defaults.

### 1. Update localConfig/config.json

Add or extend the `debug` section inside `localConfig/config.json` (the file already under version control) with the desired namespaces, terminal-color preference, and a whitelist of allowed namespace patterns:

```json
"debug": {
  "enabledNamespaces": "roleforge:llm:*,roleforge:image:gen,roleforge:story:*",
  "colors": true,
  "whitelist": [
    "roleforge:llm:*",
    "roleforge:image:*",
    "roleforge:ui:render",
    "roleforge:story:guide",
    "roleforge:frontend:*",
    "roleforge:backend:*",
    "roleforge:llm:prompt",
    "roleforge:llm:response"
  ]
}
```

- `enabledNamespaces`: Comma-separated list (supports `*` and negation like `-roleforge:llm:verbose`).
- `colors`: `true`/`false` (optional – set `false` to disable ANSI colors in the terminal).
- `whitelist`: Permitted namespace patterns; the backend must validate any runtime value against this list before calling `debug.enable()`.

### 2. Backend – Load and validate

In the backend entry point (for example, `backend/src/server.ts`), load `localConfig/config.json`, fall back to `process.env.DEBUG`, and validate namespaces against the configured whitelist before enabling them:

```javascript
const fs = require('fs');
const path = require('path');
const debug = require('debug');

const configPath = path.resolve(__dirname, '..', 'config.json');
let namespaces = process.env.DEBUG || '';
let config;

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.debug?.enabledNamespaces) {
      namespaces = config.debug.enabledNamespaces;
    }
  } catch (err) {
    console.error('Failed to load debug config:', err.message);
  }
}

const isAllowedNamespace = (value) => {
  const whitelist = (config?.debug?.whitelist || []).map((entry) => new RegExp(`^${entry.replace('*', '.*')}$`));
  return whitelist.some((pattern) => pattern.test(value));
};

if (namespaces) {
  const allowed = namespaces
    .split(',')
    .map((ns) => ns.trim())
    .filter((ns) => !ns.startsWith('-'))
    .filter((ns) => isAllowedNamespace(ns));

  if (allowed.length) {
    debug.enable(allowed.join(','));
    console.log(`Debug enabled (from config.json / DEBUG env): ${allowed.join(',')}`);
  }
}

// Optional: respect colors setting
if (config?.debug?.colors === false) {
  process.env.DEBUG_COLORS = '0';
}
```

Now run your server normally — it uses `config.json` automatically.

### 3. Frontend – Fetch debug config from the backend

Rather than reading a static file, the frontend should hit a backend endpoint (e.g. `GET /api/debug-config`) that returns the current `debug` namespace settings. Example response payload:

```json
{
  "enabledNamespaces": "roleforge:llm:*,roleforge:image:gen",
  "colors": true
}
```

The backend endpoint must load `localConfig/config.json`, run the whitelist validation described above, and return only sanitized values; no browser-side persistence (like `localStorage`) is allowed.

```javascript
import debug from 'debug';

async function initDebug() {
  const res = await fetch('/api/debug-config');
  if (!res.ok) return;

  const { enabledNamespaces, colors } = await res.json();
  if (colors === false) {
    document.body.classList.add('debug-no-colors');
  }
  if (enabledNamespaces) {
    debug.enable(enabledNamespaces);
    console.log('Frontend debug enabled from backend config:', enabledNamespaces);
  }
}

initDebug();
```

The backend is the single source of truth, so any flag updates should happen there and propagate through this endpoint.

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

