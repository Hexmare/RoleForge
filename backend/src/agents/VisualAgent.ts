import { BaseAgent, AgentContext } from './BaseAgent.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export class VisualAgent extends BaseAgent {
  constructor(configManager: any, env: any) {
    super('visual', configManager, env);
  }

  async run(context: AgentContext): Promise<string> {
    this.configManager.reload(); // Check config every run

    // Check if this is a regeneration request (no userInput, but narration provided)
    if (!context.userInput && context.narration) {
      let promptRaw = (typeof context.narration === 'string') ? context.narration.trim() : '';
      // If narration appears to be JSON metadata, extract the inner prompt field.
      // Handle nested/double-encoded JSON by unwrapping until we reach a plain prompt string.
      while (promptRaw && promptRaw.startsWith('{')) {
        try {
          const parsed = JSON.parse(promptRaw);
          if (parsed && typeof parsed === 'object' && parsed.prompt && typeof parsed.prompt === 'string') {
            // unwrap one level and continue if it's still JSON
            promptRaw = parsed.prompt;
            continue;
          }
          break;
        } catch (e) {
          // not JSON — stop unwrapping
          break;
        }
      }
      const prompt = promptRaw;
      try {
        const imageUrl = await this.generateImage(prompt);
        console.log('Generated Image prompt:', imageUrl);
        const meta = { prompt, urls: [imageUrl], current: 0 };
        return `![${JSON.stringify(meta)}](${imageUrl})`;
      } catch (error) {
        console.error('Image regeneration failed:', error);
        throw error;
      }
    }

    // For /image command: use dedicated visual-image template with matched entities
    if ((context as any).matchedEntities && (context as any).matchedEntities.length > 0) {
      const systemPrompt = this.renderTemplate('visual-image', context);
      const messageContext = this.buildMessageContext(context, systemPrompt);
      messageContext.userInput = '';
      const response = await this.callLLMWithContext(messageContext);
      const sdPrompt = this.cleanResponse(response as string).trim();
      
      // Validate the prompt
      if (sdPrompt.length < 30 || sdPrompt.includes('detailed prompt here')) {
        console.error('Visual agent generated invalid prompt:', sdPrompt);
        return '[Image generation failed: invalid prompt generated]';
      }
      
      try {
        const imageUrl = await this.generateImage(sdPrompt);
        const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
        return `![${JSON.stringify(meta)}](${imageUrl})`;
      } catch (error) {
        console.error('Image generation failed:', error);
        return '[Image generation failed]';
      }
    }

    // For scene-picture mode, generate an optimized SD prompt directly
    if (context.narrationMode === 'scene-picture') {
      const systemPrompt = this.renderTemplate('visual-scene-picture', context);
      const messageContext = this.buildMessageContext(context, systemPrompt);
      messageContext.userInput = 'Generate optimized Stable Diffusion prompt';
      const response = await this.callLLMWithContext(messageContext);
      const sdPrompt = this.cleanResponse(response as string).trim();
      return sdPrompt;
    }

    // For /image command: narration is provided, generate image directly (legacy path)
    if (context.narration && typeof context.narration === 'string' && context.narration.length > 10) {
      const systemPrompt = this.renderTemplate('visual', context);
      const messageContext = this.buildMessageContext(context, systemPrompt);
      messageContext.userInput = '';
      const response = await this.callLLMWithContext(messageContext);
      const sdPrompt = this.cleanResponse(response as string).trim();
      
      // If the prompt is too short or generic, it failed
      if (sdPrompt.length < 20 || sdPrompt.includes('detailed prompt here')) {
        console.error('Visual agent generated invalid prompt:', sdPrompt);
        return '[Image generation failed: invalid prompt generated]';
      }
      
      try {
        const imageUrl = await this.generateImage(sdPrompt);
        const meta = { prompt: sdPrompt, urls: [imageUrl], current: 0 };
        return `![${JSON.stringify(meta)}](${imageUrl})`;
      } catch (error) {
        console.error('Image generation failed:', error);
        return '[Image generation failed]';
      }
    }

    // For regular visual requests with userInput, check for [GEN_IMAGE:] tags
    const messageContext = this.buildMessageContext(context);
    const response = await this.callLLMWithContext(messageContext);
    const cleaned = this.cleanResponse(response as string);

    // Check for image generation trigger
    const imageMatch = cleaned.match(/\[GEN_IMAGE:\s*(.+?)\]/);
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      try {
        const imageUrl = await this.generateImage(prompt);
        const meta = { prompt, urls: [imageUrl], current: 0 };
        return `![${JSON.stringify(meta)}](${imageUrl})`;
      } catch (error) {
        console.error('Image generation failed:', error);
        return '[Image generation failed]';
      }
    }

    return cleaned;
  }

  async generateImage(prompt: string): Promise<string> {
    this.configManager.reload(); // Reload config fresh each time
    const config = this.configManager.getConfig();
    const comfyui = config.comfyui;
    if (!comfyui || !comfyui.endpoint) {
      throw new Error('ComfyUI config not found');
    }

    // Basic ComfyUI workflow for SD image gen (simplified)
    const positivePrefix = (config.comfyui && config.comfyui.positive_prompt) ? String(config.comfyui.positive_prompt) : '';
    const negativeFromCfg = (config.comfyui && config.comfyui.negative_prompt) ? String(config.comfyui.negative_prompt) : 'text, watermark';
    const finalPositive = (positivePrefix + ' ' + prompt).trim();

    // Try to load a workflow file from backend/workflows and substitute tokens
    let workflow: any = null;
    let seedVal: number;
    if (config.comfyui && config.comfyui.seed !== undefined && config.comfyui.seed !== null) {
      seedVal = Number(config.comfyui.seed);
      if (isNaN(seedVal)) seedVal = Math.floor(Math.random() * 1000000);
      if (seedVal === -1) seedVal = Math.floor(Math.random() * 1000000);
      else if (seedVal < 0) seedVal = 0; // Coerce other negative seeds to 0 for ComfyUI
    } else {
      seedVal = Math.floor(Math.random() * 1000000);
    }

    const tokenMap: Record<string, any> = {
      prompt: finalPositive,
      positive_prompt: finalPositive,
      negative_prompt: negativeFromCfg,
      model: config.comfyui.model || config.comfyui.checkpoint,
      vae: config.comfyui.vae,
      sampler: config.comfyui.sampler,
      scheduler: config.comfyui.scheduler,
      steps: config.comfyui.steps ?? 20,
      seed: seedVal,
      width: config.comfyui.width ?? 512,
      height: config.comfyui.height ?? 512,
      scale: config.comfyui.scale ?? config.comfyui.cfg_scale ?? 8,
      cfg_scale: config.comfyui.cfg_scale ?? 8,
    };

    try {
      if (config.comfyui && config.comfyui.workflow) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname_local = path.dirname(__filename);
        const wfPath = path.join(__dirname_local, '..', '..', 'workflows', String(config.comfyui.workflow));
        if (fs.existsSync(wfPath)) {
          const raw = fs.readFileSync(wfPath, 'utf-8');
          const parsed = JSON.parse(raw);

          const replaceTokens = (obj: any): any => {
            if (obj === null || obj === undefined) return obj;
            if (Array.isArray(obj)) return obj.map(replaceTokens);
            if (typeof obj === 'object') {
              const out: any = {};
              for (const k of Object.keys(obj)) out[k] = replaceTokens(obj[k]);
              return out;
            }
            if (typeof obj === 'string') {
              const exact = obj.match(/^%(.+)%$/);
              if (exact) {
                const key = exact[1];
                if (key in tokenMap) return tokenMap[key];
                return obj;
              }
              return obj.replace(/%([^%]+)%/g, (_, t) => {
                const v = tokenMap[t];
                return v === undefined || v === null ? '' : String(v);
              });
            }
            return obj;
          };

          workflow = replaceTokens(parsed);
          console.log('[ComfyUI] Worklow :', JSON.stringify(workflow));
        }
      }
    } catch (e) {
      console.warn('Failed to load/replace workflow, falling back to built-in', e);
      workflow = null;
    }

    if (!workflow) {
      workflow = {
        "3": {
          "inputs": {
            "seed": tokenMap.seed,
            "steps": tokenMap.steps,
            "cfg": tokenMap.cfg_scale,
            "sampler_name": tokenMap.sampler || "euler",
            "scheduler": tokenMap.scheduler || "normal",
            "denoise": 1,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0]
          },
          "class_type": "KSampler"
        },
        "4": {
          "inputs": {
            "ckpt_name": tokenMap.model || config.comfyui.checkpoint || "v1-5-pruned-emaonly.ckpt"
          },
          "class_type": "CheckpointLoaderSimple"
        },
        "5": {
          "inputs": {
            "width": tokenMap.width,
            "height": tokenMap.height,
            "batch_size": 1
          },
          "class_type": "EmptyLatentImage"
        },
        "6": {
          "inputs": {
            "text": tokenMap.prompt,
            "clip": ["4", 1]
          },
          "class_type": "CLIPTextEncode"
        },
        "7": {
          "inputs": {
            "text": tokenMap.negative_prompt,
            "clip": ["4", 1]
          },
          "class_type": "CLIPTextEncode"
        },
        "8": {
          "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
          },
          "class_type": "VAEDecode"
        },
        "9": {
          "inputs": {
            "filename_prefix": "ComfyUI",
            "images": ["8", 0]
          },
          "class_type": "SaveImage"
        }
      };
    }

    // After replacement, sanitize workflow seeds (ComfyUI rejects negative seeds except -1 which is handled above)
    const sanitizeSeeds = (obj: any) => {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) return obj.forEach(sanitizeSeeds);
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          if (k === 'seed' && typeof obj[k] === 'number' && obj[k] < 0 && obj[k] !== -1) obj[k] = 0;
          sanitizeSeeds(obj[k]);
        }
      }
    };

    try {
      sanitizeSeeds(workflow);
    } catch (e) {
      console.warn('Failed to sanitize workflow seeds', e);
    }

    // Log the filled workflow for debugging (avoid logging large binary blobs)
    try {
      if (config.comfyui && config.comfyui.debugWorkflow) {
        console.debug('ComfyUI filled workflow preview:', JSON.stringify(workflow, null, 2).slice(0, 20000));
      }
    } catch (e) {
      if (config.comfyui && config.comfyui.debugWorkflow) {
        console.debug('ComfyUI workflow preview (unable to stringify)');
      }
    }

    let promptId: string | undefined;
    try {
      const response = await axios.post(`${comfyui.endpoint}/prompt`, {
        prompt: workflow,
        client_id: comfyui.clientId
      });
      promptId = response.data.prompt_id;
    } catch (err: any) {
      console.error('ComfyUI /prompt request failed:', err?.message || err);
      if (err?.response?.data) {
        try { console.error('ComfyUI response body:', JSON.stringify(err.response.data, null, 2)); } catch(e) { console.error('ComfyUI response (raw):', err.response.data); }
      }
      // Try a fallback: post the workflow as the top-level body (some Comfy variants expect raw graph)
      try {
        console.debug('Retrying ComfyUI /prompt with raw workflow body as fallback');
        const fallbackResp = await axios.post(`${comfyui.endpoint}/prompt`, workflow);
        promptId = fallbackResp.data.prompt_id;
      } catch (err2: any) {
        console.error('ComfyUI fallback request also failed:', err2?.message || err2);
        if (err2?.response?.data) {
          try { console.error('ComfyUI fallback response body:', JSON.stringify(err2.response.data, null, 2)); } catch(e) { console.error('ComfyUI fallback response (raw):', err2.response.data); }
        }
        throw new Error('ComfyUI request failed; see server logs for details');
      }
    }

    // Poll for completion
    let history;
    try {
      do {
        await new Promise(resolve => setTimeout(resolve, 1000));  // Wait 1s
        const histResp = await axios.get(`${comfyui.endpoint}/history/${promptId}`);
        history = histResp.data;
      } while (!history || Object.keys(history).length === 0 || !promptId || !(history as Record<string, any>)[promptId]?.outputs);
    } catch (err: any) {
      console.error('Error polling ComfyUI history:', err?.message || err);
      if (err?.response?.data) {
        try { console.error('ComfyUI history response body:', JSON.stringify(err.response.data, null, 2)); } catch(e) { console.error('ComfyUI history response (raw):', err.response.data); }
      }
      throw new Error('Failed to poll ComfyUI history; see server logs');
    }

    if (!promptId) {
      throw new Error('ComfyUI did not return a prompt id');
    }
    const entry = history[promptId];
    if (!entry || !entry.outputs) {
      throw new Error('No image outputs found in ComfyUI history');
    }
    const outputs = entry.outputs as Record<string, any>;
    const saveNode = outputs['9'];  // SaveImage node
    if (saveNode && saveNode.images && saveNode.images.length > 0) {
      const filename = saveNode.images[0].filename;
      return `${comfyui.endpoint}/view?filename=${filename}`;
    }

    throw new Error('No image generated');
  }

  // Public helper to generate an image directly from a prompt string
  async generateFromPrompt(prompt: string): Promise<string> {
    // reuse the internal workflow
    return await this.generateImage(prompt);
  }
}