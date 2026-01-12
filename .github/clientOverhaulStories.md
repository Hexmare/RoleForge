# SillyTavern LLM Client Implementation Analysis

## Overview

This document provides a detailed analysis of SillyTavern's LLM client implementation, based on the open-source code from the GitHub repository (https://github.com/SillyTavern/SillyTavern). SillyTavern is a frontend interface for interacting with large language models (LLMs) in a roleplaying and chat context. It supports multiple LLM backends, including local setups like KoboldAI, TextGenerationWebUI (Oobabooga), and cloud services like OpenAI, Claude, OpenRouter, and others. The implementation is primarily JavaScript-based, running in a NodeJS environment for the server and browser for the frontend.

The LLM client is not a single monolithic component but a modular system. Backend integrations are handled through extension scripts in `public/scripts/extensions/`, where each backend has its own directory (e.g., `openai/`, `kobold/`, `claude/`). Prompt templating is a core feature, allowing users to customize how prompts are constructed for different models. This includes switching between template presets to accommodate model-specific formats (e.g., Alpaca, Vicuna, ChatML). Templates incorporate various prompts for tasks like chat generation, summarization, and image captioning.

This document explains the architecture, key files, how templating works, model switching, and task-specific prompt incorporation. It is structured to serve as a spec for defining user stories and tasks in a similar project (e.g., RoleForge).

## Repository Structure Relevant to LLM Client

- **public/scripts/extensions/**: Contains backend-specific LLM clients. Each subdirectory (e.g., `openai`, `kobold`, `novelai`) has an `index.js` file that defines the API connection, request formatting, response parsing, and backend-specific templating overrides.
- **public/scripts/**: Core scripts for prompt building and chat management, including `power.js` (general utilities), `chat.js` (chat logic), and `prompt.js` (prompt construction).
- **public/scripts/InstructMode.js** (or similar): Handles instruction templating presets.
- **server.js**: NodeJS server that proxies requests to LLM backends to handle CORS and security.
- **data/presets/**: JSON files for template presets (e.g., `alpaca.json`, `vicuna.json`).
- **public/extensions/**: User extensions for custom tasks (e.g., summarization via Extras API).
- **src/**: Source for compiled code, but most logic is in public/scripts for browser execution.

The LLM client is client-side heavy, with the browser making API calls (proxied through server.js for some backends). This allows real-time streaming and UI integration.

## LLM Client Architecture

SillyTavern's LLM client uses a plugin-like architecture for backends. Each backend extension exports an object with methods like `getSettings()`, `loadSettings()`, `generate()`, and `getModelList()`.

- **Backend Selection**: In the UI, users select the backend from a dropdown (e.g., "OpenAI", "KoboldAI"). This loads the corresponding extension script dynamically.
- **API Calls**: The `generate()` method constructs the prompt, sends it to the backend API (e.g., `/v1/chat/completions` for OpenAI-compatible), and handles streaming responses.
- **Error Handling**: Common to all backends, including retries, fallbacks (model fallback if primary fails), and logging.
- **Streaming**: Supports token-by-token streaming for real-time chat updates.
- **Parameters**: Users configure generation params (temperature, top_p, etc.) per backend, with defaults from the extension.

Example flow:
1. User inputs a message.
2. Chat script collects context (history, character card, world info).
3. Prompt builder applies template.
4. Backend extension sends formatted prompt to API.
5. Response is parsed and appended to chat.

### Key Files for LLM Client

- **public/scripts/extensions/openai/index.js**: Handles OpenAI, OpenRouter, and compatible APIs. Implements chat completion using OpenAI SDK-like calls. Supports model listing via `/v1/models`.
- **public/scripts/extensions/kobold/index.js**: For KoboldAI/CPP. Uses legacy sampling API (`/api/v1/generate`).
- **public/scripts/extensions/textgenerationwebui/index.js**: For Oobabooga. Supports OpenAI-compatible endpoint.
- **public/scripts/PromptManager.js**: Central prompt builder. Merges character prompts, user input, system instructions.
- **public/scripts/Instruct.js**: Manages instruct mode templates.

## Prompt Templating System

SillyTavern's templating is designed to make prompts model-agnostic while allowing customization for model-specific fine-tunes. Prompts are built dynamically using placeholders and sections.

- **Components of a Prompt**:
  - **Main Prompt**: Global system prompt (e.g., "You are a helpful assistant").
  - **Character Card**: Description, personality, scenario, dialogue examples from the card (JSON or PNG-embedded).
  - **World Info (Lorebooks)**: Contextual entries triggered by keywords in the chat.
  - **Chat History**: Previous messages formatted as user/assistant pairs.
  - **User Input**: Current message.
  - **Gaslight (Instruct Template)**: The formatting wrapper (e.g., for instruction-tuned models).
  - **NSFW/Jailbreak Prompt**: Appended for adult content or to bypass filters.
  - **Author's Note**: Injected mid-context for style guidance.

- **Templating Mechanism**:
  - Templates are defined as JSON objects with fields like `system_prompt_prefix`, `system_prompt_suffix`, `user_prompt_prefix`, `assistant_prompt_prefix`, etc.
  - Example for Alpaca template (from presets/alpaca.json):
    ```
    {
      "system_prefix": "### Instruction:\n",
      "system_suffix": "\n",
      "user_prefix": "### Input:\n",
      "user_suffix": "\n",
      "assistant_prefix": "### Response:\n",
      "assistant_suffix": "\n",
      "stop_sequence": ["### Instruction:", "### Input:"]
    }
    ```
  - The PromptManager builds the full prompt by iterating through chat history and wrapping each message with the appropriate prefix/suffix.
  - Code snippet from PromptManager.js (approximated):
    ```
    function buildPrompt(chatHistory, systemPrompt, template) {
      let prompt = template.system_prefix + systemPrompt + template.system_suffix;
      for (let msg of chatHistory) {
        if (msg.role === 'user') {
          prompt += template.user_prefix + msg.content + template.user_suffix;
        } else {
          prompt += template.assistant_prefix + msg.content + template.assistant_suffix;
        }
      }
      return prompt;
    }
    ```

- **Handling for Different Tasks**:
  - **Chat Generation**: Uses the full context prompt for roleplay/chat.
  - **Summarization**: Via Extras API (SillyTavern-Extras repo), sends a specialized prompt like "Summarize the following text: {{text}}".
  - **Image Captioning**: For inline image gen, uses a task-specific prompt like "Describe this scene for image generation: {{description}}".
  - **Expression Classification**: Sends prompt to classify emotions for avatars.
  - Tasks are handled by wrapping the base template with task-specific instructions (e.g., system prompt override).

## Switching Templates for Different Models

- **Model-Specific Accommodation**:
  - Users select a "Preset" in the UI (under Advanced Formatting > Instruct Mode).
  - Presets are loaded from JSON files in `data/instruct-presets/`.
  - Switching: When a new preset is selected, it updates the template object in memory. The next generation rebuilds the prompt using the new format.
  - For backends like OpenAI, the template is applied client-side before sending as a messages array ( [{role: 'system', content: ...}, {role: 'user', content: ...}] ).
  - For legacy backends like Kobold, it's concatenated into a single string.
  - Model switching: In backend extensions, `getModelList()` fetches available models from the API (e.g., OpenAI's /v1/models). Users select a model, which updates params like max_tokens based on model capabilities.

- **Code for Template Switching**:
  - In UI script (e.g., settings.js): Event listener on preset dropdown calls `loadInstructPreset(presetName)`, which fetches JSON and sets `template = presetData;`.
  - Backend extensions check if instruct mode is enabled and apply the template; otherwise, use default concatenation.
  - Example:
    ```
    async function generate() {
      const template = getCurrentTemplate(); // From global state
      const prompt = buildPrompt(chat, mainPrompt, template);
      const response = await fetch('/api/generate', { body: JSON.stringify({prompt, params}) });
      // Parse and stream
    }
    ```

- **Incorporating Prompts for Each Task**:
  - Tasks use modular prompt builders. For example, for a summarization task in extensions/summarize/index.js:
    - Override system prompt: "You are a summarizer. Summarize concisely."
    - Use the same template but with task input as user message.
  - For multi-model support, fallback chains: If primary model fails, switch to secondary with its template.
  - Dynamic insertion: World Info injects entries if keywords match, updating the prompt on-the-fly.

## Potential Improvements and Limitations

- **Strengths**: Highly customizable, supports 20+ backends, easy extension.
- **Limitations**: Client-side heavy, potential security issues with direct API calls; templates are static JSON, no dynamic generation.
- **For RoleForge**: Adopt modular backend extensions and JSON-based templates for flexibility.

## User Stories and Tasks Derived from This Spec

### User Stories

1. **As a user, I want to select different LLM backends so that I can switch between local and cloud models.**
   - Acceptance: Dropdown in settings loads extension and lists models.

2. **As a developer, I want modular backend implementations so that I can add new LLMs easily.**
   - Acceptance: Each backend in separate folder with standard interface.

3. **As a user, I want to switch prompt templates to match my model's fine-tune so that responses are consistent.**
   - Acceptance: Preset dropdown updates template; prompts rebuilt accordingly.

4. **As a user, I want task-specific prompts incorporated into the template so that I can perform summarization or image gen seamlessly.**
   - Acceptance: Extensions override system prompt for tasks.

5. **As a user, I want model fallback and switching so that if one model fails, another takes over with its template.**
   - Acceptance: Configurable fallback chain in settings.

### Tasks

1. **Implement Backend Extension Skeleton**:
   - Create `extensions/template/index.js` with generate(), getModels(), etc.
   - Test with dummy API.

2. **Develop Prompt Builder Function**:
   - Write `buildPrompt()` with placeholder replacement.
   - Support messages array or string output.

3. **Create JSON Preset System**:
   - Load presets from folder.
   - UI for selecting and editing presets.

4. **Integrate Task-Specific Overrides**:
   - In extensions, add task param to generate() for prompt modification.

5. **Add Model Switching Logic**:
   - Fetch model list per backend.
   - Update UI and params on selection.

This document can be used as a blueprint for implementing a similar system in RoleForge, ensuring compatibility with OpenAI-like backends and Kobold.