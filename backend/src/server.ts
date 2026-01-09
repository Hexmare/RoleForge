/// <reference path="./types/global.d.ts" />
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ConfigManager } from './configManager';
import { chatCompletion, ChatMessage } from './llm/client';
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Orchestrator } from './agents/Orchestrator';
import db from './database';
import multer from 'multer';
import sharp from 'sharp';
import WorldService from './services/WorldService';
import CampaignService from './services/CampaignService';
import ArcService from './services/ArcService';
import SceneService from './services/SceneService';
import MessageService from './services/MessageService';
import CharacterService from './services/CharacterService';
import { VisualAgent } from './agents/VisualAgent';
import { tryParse, unwrapPrompt } from './utils/unpackPrompt';
import axios from 'axios';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Nunjucks
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, 'prompts')), { autoescape: false });
env.addFilter('json', (obj: any) => JSON.stringify(obj, null, 2));

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// In-memory per-message regen lock to prevent concurrent regen requests
const regenLocks: Set<number> = new Set();

// Middleware
app.use(express.json());

// Serve public files (avatars etc.)
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// Ensure avatars folder exists
const avatarsDir = path.join(process.cwd(), 'public', 'avatars');
try { fs.mkdirSync(avatarsDir, { recursive: true }); } catch (e) { /* ignore */ }

const storage = multer.diskStorage({
  destination: function (_req: any, _file: any, cb: any) { cb(null, avatarsDir); },
  filename: function (_req: any, file: any, cb: any) {
    const safe = (file && file.originalname ? String(file.originalname) : 'upload').replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});
const upload = multer({ storage });

// API Routes

// World/Campaign/Arc/Scene CRUD
app.get('/api/worlds', (req, res) => {
  res.json(WorldService.getAll());
});

app.post('/api/worlds', (req, res) => {
  const { name, description } = req.body;
  const created = WorldService.create(name, description);
  res.json(created);
});

app.put('/api/worlds/:id', (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  res.json(WorldService.update(Number(id), { name, description }));
});

app.delete('/api/worlds/:id', (req, res) => {
  const { id } = req.params;
  res.json(WorldService.delete(Number(id)));
});

// Campaigns
app.get('/api/worlds/:worldId/campaigns', (req, res) => {
  const { worldId } = req.params;
  res.json(CampaignService.listByWorld(Number(worldId)));
});

app.post('/api/worlds/:worldId/campaigns', (req, res) => {
  const { worldId } = req.params;
  const { name, description } = req.body;
  res.json(CampaignService.create(Number(worldId), name, description));
});

app.put('/api/campaigns/:id', (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  res.json(CampaignService.update(Number(id), { name, description }));
});

app.delete('/api/campaigns/:id', (req, res) => {
  const { id } = req.params;
  res.json(CampaignService.delete(Number(id)));
});

// Arcs
app.get('/api/campaigns/:campaignId/arcs', (req, res) => {
  const { campaignId } = req.params;
  res.json(ArcService.listByCampaign(Number(campaignId)));
});

app.post('/api/campaigns/:campaignId/arcs', (req, res) => {
  const { campaignId } = req.params;
  const { name, description } = req.body;
  res.json(ArcService.create(Number(campaignId), name, description));
});

app.put('/api/arcs/:id', (req, res) => {
  const { id } = req.params;
  res.json(ArcService.update(Number(id), req.body));
});

app.delete('/api/arcs/:id', (req, res) => {
  const { id } = req.params;
  res.json(ArcService.delete(Number(id)));
});

// Scenes
app.get('/api/arcs/:arcId/scenes', (req, res) => {
  const { arcId } = req.params;
  res.json(SceneService.listByArc(Number(arcId)));
});

app.post('/api/arcs/:arcId/scenes', (req, res) => {
  const { arcId } = req.params;
  const { title, description, location, timeOfDay } = req.body;
  res.json(SceneService.create(Number(arcId), title, description, location, timeOfDay));
});

app.put('/api/scenes/:id', (req, res) => {
  const { id } = req.params;
  res.json(SceneService.update(Number(id), req.body));
});

app.delete('/api/scenes/:id', (req, res) => {
  const { id } = req.params;
  res.json(SceneService.delete(Number(id)));
});

// Messages
app.get('/api/scenes/:sceneId/messages', (req, res) => {
  const { sceneId } = req.params;
  const limit = Number(req.query.limit || 100);
  const offset = Number(req.query.offset || 0);
  res.json(MessageService.getMessages(Number(sceneId), limit, offset));
});

app.post('/api/scenes/:sceneId/messages', (req, res) => {
  const { sceneId } = req.params;
  const { sender, message, charactersPresent, metadata } = req.body;
  res.json(MessageService.logMessage(Number(sceneId), sender, message, charactersPresent || [], metadata || {}));
});

app.put('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  const { message, metadata } = req.body;
  res.json(MessageService.editMessage(Number(id), message, metadata));
});

// Image actions for a message: next, prev, regen
app.post('/api/messages/:id/image', async (req, res) => {
  const { id } = req.params;
  const { action, prompt, index } = req.body;
  const messageId = Number(id);
  if (!['next', 'prev', 'regen', 'deleteCurrent', 'deleteAll'].includes(action)) return res.status(400).json({ error: 'invalid action' });
  try {
    const row = db.prepare('SELECT id, sceneId, message, metadata FROM Messages WHERE id = ?').get(messageId) as any;
    if (!row) return res.status(404).json({ error: 'message not found' });
    const sceneId = Number(row.sceneId);
    // parse metadata
    let meta: any = {};
    try { meta = typeof row.metadata === 'string' && row.metadata ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (e) { meta = {}; }
    // fallback: try to parse alt b64 in message body
    if ((!meta || !meta.urls) && typeof row.message === 'string') {
      const m = String(row.message || '').match(/!\[(.*?)\]\((.*?)\)/);
      if (m) {
        try {
          const alt = m[1] || '';
          try { meta = JSON.parse(alt); } catch { meta = { prompt: alt, urls: [m[2]], current: 0 }; }
        } catch (e) { meta = { prompt: '', urls: [m[2]], current: 0 }; }
      }
    }

    meta = meta || {};
    meta.urls = Array.isArray(meta.urls) ? meta.urls.slice() : (meta.urls ? [String(meta.urls)] : []);
    if (meta.urls.length === 0 && typeof row.message === 'string') {
      // try to use the inline URL
      const m = String(row.message || '').match(/!\[(.*?)\]\((.*?)\)/);
      if (m) meta.urls = [m[2]];
    }
    meta.current = typeof meta.current === 'number' ? meta.current : 0;

    // Handle delete actions (remove file(s) + update metadata)
    if (action === 'deleteCurrent' || action === 'deleteAll') {
      const idx = (typeof index === 'number') ? index : (meta.current || 0);
      if (action === 'deleteCurrent') {
        if (meta.urls && meta.urls.length > 0 && idx >= 0 && idx < meta.urls.length) {
          const urlToDelete = meta.urls.splice(idx, 1)[0];
          try {
            if (String(urlToDelete).includes('/public/generated/')) {
              const rel = String(urlToDelete).split('/public/')[1].replace(/^\//, '');
              const fp = path.join(process.cwd(), 'public', rel);
              if (fs.existsSync(fp)) fs.unlinkSync(fp);
            }
          } catch (e) { console.warn('Failed to delete image file', e); }
        }
        meta.current = Math.max(0, Math.min(meta.current || 0, (meta.urls || []).length - 1));
      } else if (action === 'deleteAll') {
        if (meta.urls && meta.urls.length > 0) {
          for (const u of meta.urls) {
            try {
              if (String(u).includes('/public/generated/')) {
                const rel = String(u).split('/public/')[1].replace(/^\//, '');
                const fp = path.join(process.cwd(), 'public', rel);
                if (fs.existsSync(fp)) fs.unlinkSync(fp);
              }
            } catch (e) { console.warn('Failed to delete image file', e); }
          }
        }
        meta.urls = [];
        meta.current = 0;
      }

      // If no images remain, replace message content with the original prompt (if available)
      let newContent: string | null = null;
      if (!meta.urls || meta.urls.length === 0) {
        let providedPrompt = '';
        if (meta && meta.prompt) providedPrompt = String(meta.prompt || '');
        else {
          const m = String(row.message || '').match(/!\[(.*?)\]\((.*?)\)/);
          if (m) {
            const alt = m[1] || '';
            try { providedPrompt = JSON.parse(alt).prompt || providedPrompt; } catch { providedPrompt = alt || providedPrompt; }
          }
        }
        newContent = providedPrompt || '';
        db.prepare('UPDATE Messages SET message = ?, metadata = ? WHERE id = ?').run(newContent, JSON.stringify(meta), messageId);
      } else {
        newContent = `![${JSON.stringify(meta)}](${meta.urls[meta.current]})`;
        db.prepare('UPDATE Messages SET message = ?, metadata = ? WHERE id = ?').run(newContent, JSON.stringify(meta), messageId);
      }
      try { io.to(`scene-${sceneId}`).emit('messageUpdated', { messageId, newContent }); } catch (e) { console.warn('Failed to emit messageUpdated from delete action', e); }
      return res.json({ success: true, metadata: meta, newContent });
    }

    if (action === 'next' || action === 'prev') {
      if (meta.urls.length <= 1) {
        return res.json({ success: true, metadata: meta, newContent: row.message });
      }
      let idx = meta.current || 0;
      if (action === 'next') idx = (idx + 1) % meta.urls.length;
      else idx = (idx - 1 + meta.urls.length) % meta.urls.length;
      meta.current = idx;
      const newContent = `![${JSON.stringify(meta)}](${meta.urls[meta.current]})`;
      db.prepare('UPDATE Messages SET message = ?, metadata = ? WHERE id = ?').run(newContent, JSON.stringify(meta), messageId);
      try { io.to(`scene-${sceneId}`).emit('messageUpdated', { messageId, newContent }); } catch (e) { console.warn('Failed to emit messageUpdated from image action', e); }
      return res.json({ success: true, metadata: meta, newContent });
    }

    // Regen path
    // Determine prompt to use
    let providedPrompt = (typeof prompt === 'string') ? prompt : '';
    if (!providedPrompt) {
      if (meta && meta.prompt) providedPrompt = String(meta.prompt || '');
      else {
        // try to extract from alt or message
        const m = String(row.message || '').match(/!\[(.*?)\]\((.*?)\)/);
        if (m) {
          const alt = m[1] || '';
          try { providedPrompt = JSON.parse(alt).prompt || providedPrompt; } catch { providedPrompt = alt || providedPrompt; }
        }
      }
    }

    // Use VisualAgent to regenerate image and store
    if (regenLocks.has(messageId)) {
      return res.status(429).json({ error: 'regen already in progress' });
    }
    regenLocks.add(messageId);
    try {
      const parsedPrompt = (typeof providedPrompt === 'string') ? providedPrompt : JSON.stringify(providedPrompt || '');
      const visualAgent = new VisualAgent(configManager, env);
      const context: any = { narration: parsedPrompt, metadata: meta, sceneElements: [] };
      let result: any = null;
      try {
        result = await visualAgent.run(context);
      } catch (vaErr) {
        const verr: any = vaErr;
        try { io.to(`scene-${sceneId}`).emit('regenFailed', { messageId, error: String(verr?.message || verr) }); } catch (err) { console.warn('Failed to emit regenFailed after VisualAgent error', err); }
        return res.status(500).json({ error: 'VisualAgent failed', detail: String(verr?.message || verr) });
      }
      const match = result && result.match ? result.match(/!\[.*?\]\((.*?)\)/) : null;
      if (!match) return res.status(500).json({ error: 'No image returned from VisualAgent' });
      const newUrl = match[1];
      // store locally
      let stored: any = { localUrl: newUrl, size: 0 };
      try { stored = await downloadAndStoreImageForScene(newUrl, sceneId); } catch (e) { console.warn('Failed to store regenerated image locally, using remote URL', e); }
      // merge
      const existing = meta.urls || [];
      const merged = Array.from(new Set([...(existing || []), stored.localUrl]));
      meta.urls = merged;
      meta.current = merged.length - 1;
      meta.prompt = providedPrompt;
      const newContent = `![${JSON.stringify(meta)}](${stored.localUrl})`;
      try { io.to(`scene-${sceneId}`).emit('imageStored', { messageId, sceneId, originalUrl: newUrl, localUrl: stored.localUrl, size: stored.size }); } catch (e) { console.warn('Failed to emit imageStored', e); }
      db.prepare('UPDATE Messages SET message = ?, metadata = ? WHERE id = ?').run(newContent, JSON.stringify(meta), messageId);
      try { io.to(`scene-${sceneId}`).emit('messageUpdated', { messageId, newContent }); } catch (e) { console.warn('Failed to emit messageUpdated after regen', e); }
      return res.json({ success: true, metadata: meta, newContent, url: stored.localUrl });
    } finally {
      regenLocks.delete(messageId);
    }
  } catch (e) {
    console.error('Image action failed', e);
    return res.status(500).json({ error: 'Image action failed', detail: String((e as any).message || e) });
  }
});

// Delete a message and reorder subsequent messages
app.delete('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  try {
    const result = MessageService.deleteMessage(Number(id));
    return res.json(result);
  } catch (e) {
    console.error('Failed to delete message', e);
    return res.status(500).json({ error: 'Failed to delete' });
  }
});

// Move a message up or down (swap with neighbor)
app.post('/api/messages/:id/move', (req, res) => {
  const { id } = req.params;
  const { direction } = req.body;
  if (!['up', 'down'].includes(direction)) return res.status(400).json({ error: 'direction must be up or down' });
  try {
    const result = MessageService.moveMessage(Number(id), direction as 'up' | 'down');
    return res.json(result);
  } catch (e) {
    console.error('Failed to move message', e);
    return res.status(500).json({ error: 'Failed to move' });
  }
});

// BaseCharacters endpoints (used for canonical character definitions)
app.get('/api/base-characters', (req, res) => {
  const rows = db.prepare('SELECT * FROM BaseCharacters').all() as any[];
  const parsed = rows.map(r => ({ id: r.id, slug: r.slug, data: JSON.parse(r.data) }));
  res.json(parsed);
});

app.post('/api/base-characters', (req, res) => {
  const { slug, data } = req.body;
  const stmt = db.prepare('INSERT INTO BaseCharacters (slug, data) VALUES (?, ?)');
  const result = stmt.run(slug, JSON.stringify(data));
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/base-characters/:id', (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM BaseCharacters WHERE id = ?').get(id) as any;
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ id: row.id, slug: row.slug, data: JSON.parse(row.data) });
});

app.put('/api/base-characters/:id', (req, res) => {
  const { id } = req.params;
  const { data } = req.body;
  const stmt = db.prepare('UPDATE BaseCharacters SET data = ? WHERE id = ?');
  const result = stmt.run(JSON.stringify(data), id);
  res.json({ changes: result.changes });
});

// Character override endpoints
app.get('/api/worlds/:worldId/characters/:characterId/override', (req, res) => {
  const { worldId, characterId } = req.params;
  const row = db.prepare('SELECT overrideData FROM WorldCharacterOverrides WHERE worldId = ? AND characterId = ?').get(Number(worldId), Number(characterId)) as any;
  if (!row) return res.json({ override: null });
  res.json({ override: JSON.parse(row.overrideData) });
});

app.post('/api/worlds/:worldId/characters/:characterId/override', (req, res) => {
  const { worldId, characterId } = req.params;
  const { override } = req.body;
  const exists = db.prepare('SELECT 1 FROM WorldCharacterOverrides WHERE worldId = ? AND characterId = ?').get(Number(worldId), Number(characterId));
  if (exists) {
    const stmt = db.prepare('UPDATE WorldCharacterOverrides SET overrideData = ? WHERE worldId = ? AND characterId = ?');
    const result = stmt.run(JSON.stringify(override), Number(worldId), Number(characterId));
    const payload = { level: 'world', worldId: Number(worldId), characterId: Number(characterId), changes: result.changes };
    try { io.emit('characterOverrideChanged', payload); } catch (e) { console.warn('Failed to emit characterOverrideChanged', e); }
    return res.json({ changes: result.changes });
  } else {
    const stmt = db.prepare('INSERT INTO WorldCharacterOverrides (worldId, characterId, overrideData) VALUES (?, ?, ?)');
    const result = stmt.run(Number(worldId), Number(characterId), JSON.stringify(override));
    const payload = { level: 'world', worldId: Number(worldId), characterId: Number(characterId), inserted: result.lastInsertRowid };
    try { io.emit('characterOverrideChanged', payload); } catch (e) { console.warn('Failed to emit characterOverrideChanged', e); }
    return res.json({ inserted: result.lastInsertRowid });
  }
});

app.get('/api/campaigns/:campaignId/characters/:characterId/override', (req, res) => {
  const { campaignId, characterId } = req.params;
  const row = db.prepare('SELECT overrideData FROM CampaignCharacterOverrides WHERE campaignId = ? AND characterId = ?').get(Number(campaignId), Number(characterId)) as any;
  if (!row) return res.json({ override: null });
  res.json({ override: JSON.parse(row.overrideData) });
});

app.post('/api/campaigns/:campaignId/characters/:characterId/override', (req, res) => {
  const { campaignId, characterId } = req.params;
  const { override } = req.body;
  const exists = db.prepare('SELECT 1 FROM CampaignCharacterOverrides WHERE campaignId = ? AND characterId = ?').get(Number(campaignId), Number(characterId));
  if (exists) {
    const stmt = db.prepare('UPDATE CampaignCharacterOverrides SET overrideData = ? WHERE campaignId = ? AND characterId = ?');
    const result = stmt.run(JSON.stringify(override), Number(campaignId), Number(characterId));
    const payload = { level: 'campaign', campaignId: Number(campaignId), characterId: Number(characterId), changes: result.changes };
    try { io.emit('characterOverrideChanged', payload); } catch (e) { console.warn('Failed to emit characterOverrideChanged', e); }
    return res.json({ changes: result.changes });
  } else {
    const stmt = db.prepare('INSERT INTO CampaignCharacterOverrides (campaignId, characterId, overrideData) VALUES (?, ?, ?)');
    const result = stmt.run(Number(campaignId), Number(characterId), JSON.stringify(override));
    const payload = { level: 'campaign', campaignId: Number(campaignId), characterId: Number(characterId), inserted: result.lastInsertRowid };
    try { io.emit('characterOverrideChanged', payload); } catch (e) { console.warn('Failed to emit characterOverrideChanged', e); }
    return res.json({ inserted: result.lastInsertRowid });
  }
});

// Session context endpoint: build and return a SessionContext and emit session events
app.get('/api/scenes/:sceneId/session', async (req, res) => {
  const { sceneId } = req.params;
  try {
    const context = await orchestrator.buildSessionContext(Number(sceneId));
    if (!context) return res.status(404).json({ error: 'Scene not found' });
    // Emit events: sceneAdvanced and stateUpdated
    try { io.emit('sceneAdvanced', { sceneId: Number(sceneId), session: context }); } catch (e) { console.warn('Failed to emit sceneAdvanced', e); }
    try { io.emit('stateUpdated', { campaignId: context.campaign.id, state: context.worldState, trackers: context.trackers }); } catch (e) { console.warn('Failed to emit stateUpdated', e); }
    return res.json(context);
  } catch (e) {
    console.error('Error building session context:', e);
    return res.status(500).json({ error: 'Failed to build session context' });
  }
});

// Workflows listing - read backend/workflows for available .json workflows
app.get('/api/workflows', (req, res) => {
  try {
    const wfDir = path.join(__dirname, '..', 'workflows');
    if (!fs.existsSync(wfDir)) return res.json([]);
    const files = fs.readdirSync(wfDir).filter(f => f.toLowerCase().endsWith('.json'));
    return res.json(files);
  } catch (e) {
    console.warn('Failed to list workflows', e);
    return res.status(500).json({ error: 'Failed to list workflows' });
  }
});

app.get('/api/workflows/:name', (req, res) => {
  try {
    const { name } = req.params;
    const wfPath = path.join(__dirname, '..', 'workflows', name);
    if (!fs.existsSync(wfPath)) return res.status(404).json({ error: 'Not found' });
    const content = fs.readFileSync(wfPath, 'utf-8');
    return res.json(JSON.parse(content));
  } catch (e) {
    console.warn('Failed to read workflow', e);
    return res.status(500).json({ error: 'Failed to read workflow' });
  }
});

// Debug config for clients: return non-sensitive debug configuration
app.get('/api/debug-config', (req, res) => {
  try {
    const cfg = configManager.getConfig();
    // Clone minimal subset and mask secrets
    const out: any = {
      features: cfg.features || {},
      comfyui: cfg.comfyui ? { endpoint: cfg.comfyui.endpoint, workflow: cfg.comfyui.workflow } : {},
      agents: cfg.agents || {}
    };
    // Mask any apiKey values in profiles
    if (cfg.profiles) {
      out.profiles = {};
      for (const k of Object.keys(cfg.profiles)) {
        const p = { ...cfg.profiles[k] } as any;
        if ('apiKey' in p) p.apiKey = p.apiKey ? '***' : undefined;
        out.profiles[k] = p;
      }
    }
    return res.json(out);
  } catch (e) {
    console.warn('Failed to return debug config', e);
    return res.status(500).json({ error: 'Failed to load config' });
  }
});

// Preview filled workflow using current comfyui settings and optional prompt
app.get('/api/comfyui/preview', (req, res) => {
  try {
    const cfg = configManager.getConfig();
    const comfy = cfg.comfyui || {};
    const workflowName = comfy.workflow;
    if (!workflowName) return res.status(400).json({ error: 'No workflow configured in comfyui settings' });
    const wfPath = path.join(__dirname, '..', 'workflows', String(workflowName));
    if (!fs.existsSync(wfPath)) return res.status(404).json({ error: 'Workflow file not found' });
    const raw = fs.readFileSync(wfPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const userPrompt = String(req.query.prompt || req.body?.prompt || comfy.positive_prompt || 'Sample prompt');

    const positivePrefix = comfy.positive_prompt ? String(comfy.positive_prompt) : '';
    const negativeFromCfg = comfy.negative_prompt ? String(comfy.negative_prompt) : 'text, watermark';
    const finalPositive = (positivePrefix + ' ' + userPrompt).trim();

    const tokenMap: Record<string, any> = {
      prompt: finalPositive,
      positive_prompt: finalPositive,
      negative_prompt: negativeFromCfg,
      model: comfy.model || comfy.checkpoint,
      vae: comfy.vae,
      sampler: comfy.sampler,
      scheduler: comfy.scheduler,
      steps: comfy.steps ?? 20,
      seed: (comfy.seed !== undefined && comfy.seed !== null) ? comfy.seed : Math.floor(Math.random() * 1000000),
      width: comfy.width ?? 512,
      height: comfy.height ?? 512,
      scale: comfy.scale ?? comfy.cfg_scale ?? 8,
      cfg_scale: comfy.cfg_scale ?? 8,
    };

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

    const filled = replaceTokens(parsed);
    // Return filled workflow for preview (do not call ComfyUI here)
    return res.json({ workflow: filled, tokenMap });
  } catch (e) {
    console.warn('Failed to build preview workflow', e);
    const err: any = e;
    return res.status(500).json({ error: 'Failed to build preview workflow', detail: String(err?.message || err) });
  }
});

// Proxy endpoint to query ComfyUI lists (models/vaes/samplers/schedulers)
app.post('/api/comfyui/list', async (req, res) => {
  const { endpoint } = req.body;
  const ep = endpoint || (configManager.getConfig().comfyui && configManager.getConfig().comfyui.endpoint);
  if (!ep) return res.status(400).json({ error: 'ComfyUI endpoint not provided or configured' });
  console.debug('ComfyUI list requested for endpoint:', ep);
  const result: any = { models: [], vaes: [], samplers: [], schedulers: [], _debug: {} };
  try {
    // Preferred: query ComfyUI object_info endpoints for structured lists
    try {
      const r = await axios.get(`${ep}/object_info/CheckpointLoaderSimple`, { timeout: 4000 });
      result._debug.ois_checkpoints = r.data;
      const arr = r.data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      if (Array.isArray(arr)) result.models = arr;
    } catch (e) {
      const err: any = e;
      result._debug.ois_checkpoints_error = String(err?.message || err);
    }

    try {
      const r = await axios.get(`${ep}/object_info/VAELoader`, { timeout: 4000 });
      result._debug.ois_vaes = r.data;
      const arr = r.data?.VAELoader?.input?.required?.vae_name?.[0];
      if (Array.isArray(arr)) result.vaes = arr;
    } catch (e) {
      const err: any = e;
      result._debug.ois_vaes_error = String(err?.message || err);
    }

    try {
      const r = await axios.get(`${ep}/object_info/KSampler`, { timeout: 4000 });
      result._debug.ois_ksampler = r.data;
      const sam = r.data?.KSampler?.input?.required?.sampler_name?.[0];
      const sch = r.data?.KSampler?.input?.required?.scheduler?.[0];
      if (Array.isArray(sam)) result.samplers = sam;
      if (Array.isArray(sch)) result.schedulers = sch;
    } catch (e) {
      const err: any = e;
      result._debug.ois_ksampler_error = String(err?.message || err);
    }

    // If object_info provided useful results, skip older heuristics
    const haveAny = (result.models && result.models.length) || (result.vaes && result.vaes.length) || (result.samplers && result.samplers.length) || (result.schedulers && result.schedulers.length);
    if (!haveAny) {
    // models/checkpoints
    try {
      const r = await axios.get(`${ep}/checkpoints`, { timeout: 5000 });
      result._debug.checkpoints = r.data;
      if (Array.isArray(r.data)) result.models = r.data.map((x: any) => (x.name || x));
    } catch (e1) {
      const err1: any = e1;
      result._debug.checkpoints_error = String(err1?.message || err1);
      try { const r2 = await axios.get(`${ep}/models`, { timeout: 5000 }); result._debug.models_raw = r2.data; if (Array.isArray(r2.data)) result.models = r2.data; } catch (e2) { const err2: any = e2; result._debug.models_error = String(err2?.message || err2); }
    }

    // vaes
    try { const r = await axios.get(`${ep}/vae`, { timeout: 5000 }); result._debug.vae = r.data; if (Array.isArray(r.data)) result.vaes = r.data; } catch (e3) { const err3: any = e3; result._debug.vae_error = String(err3?.message || err3); try { const r2 = await axios.get(`${ep}/vaes`, { timeout: 5000 }); result._debug.vaes_raw = r2.data; if (Array.isArray(r2.data)) result.vaes = r2.data; } catch (e4) { const err4: any = e4; result._debug.vaes_error = String(err4?.message || err4); } }


    // samplers
    try { const r = await axios.get(`${ep}/samplers`, { timeout: 5000 }); result._debug.samplers = r.data; if (Array.isArray(r.data)) result.samplers = r.data; } catch (e5) { const err5: any = e5; result._debug.samplers_error = String(err5?.message || err5); try { const r2 = await axios.get(`${ep}/sampler`, { timeout: 5000 }); result._debug.sampler_raw = r2.data; if (Array.isArray(r2.data)) result.samplers = r2.data; } catch (e6) { const err6: any = e6; result._debug.sampler_error = String(err6?.message || err6); } }

    // If nothing found yet, try sdapi/v1 common prefixes used by other services
    if ((!result.models || result.models.length === 0) && !(result._debug.checkpoints && result._debug.checkpoints.length)) {
      try { const r = await axios.get(`${ep}/sdapi/v1/sd-models`, { timeout: 5000 }); result._debug.sd_models = r.data; if (Array.isArray(r.data)) result.models = r.data.map((m: any) => m.model_name || m.title || m.name || m); } catch (e9) { const err9: any = e9; result._debug.sd_models_error = String(err9?.message || err9); }
    }
    if ((!result.vaes || result.vaes.length === 0) && !(result._debug.vae && result._debug.vae.length)) {
      try { const r = await axios.get(`${ep}/sdapi/v1/vae`, { timeout: 5000 }); result._debug.sd_vae = r.data; if (Array.isArray(r.data)) result.vaes = r.data; } catch (e10) { const err10: any = e10; result._debug.sd_vae_error = String(err10?.message || err10); }
    }

    // schedulers
    try { const r = await axios.get(`${ep}/schedulers`, { timeout: 5000 }); result._debug.schedulers = r.data; if (Array.isArray(r.data)) result.schedulers = r.data; } catch (e7) { const err7: any = e7; result._debug.schedulers_error = String(err7?.message || err7); try { const r2 = await axios.get(`${ep}/scheduler`, { timeout: 5000 }); result._debug.scheduler_raw = r2.data; if (Array.isArray(r2.data)) result.schedulers = r2.data; } catch (e8) { const err8: any = e8; result._debug.scheduler_error = String(err8?.message || err8); } }
    }
  } catch (e) {
    console.warn('Error querying ComfyUI lists', e);
    const err: any = e;
    result._debug.error = String(err?.message || err);
  }
  return res.json(result);
});

// Get/Set ComfyUI settings in config.json under 'comfyui'
app.get('/api/settings/comfyui', (req, res) => {
  const cfg = configManager.getConfig();
  return res.json(cfg.comfyui || null);
});

app.put('/api/settings/comfyui', (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
    cfg.comfyui = req.body || {};
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    try { 
      configManager.reload(); 
    } catch (e) { 
      console.warn('Failed to reload configManager after saving comfyui', e);
    }
    try {
      if (typeof orchestrator !== 'undefined' && orchestrator && typeof (orchestrator as any).reloadAgent === 'function') {
        (orchestrator as any).reloadAgent('visual');
      }
      try { io.emit('comfyuiSettingsChanged', cfg.comfyui || {}); } catch (e) { console.warn('Failed to emit comfyuiSettingsChanged', e); }
    } catch (e) {
      console.warn('Failed to refresh VisualAgent after comfyui save', e);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('Failed to save comfyui settings', e);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Merged character preview
app.get('/api/characters/merged', (req, res) => {
  const worldId = req.query.worldId ? Number(req.query.worldId) : undefined;
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
  const slug = String(req.query.slug || '');
  const merged = CharacterService.getMergedCharacter({ worldId, campaignId, characterSlug: slug });
  if (!merged) return res.status(404).json({ error: 'Character not found' });
  res.json(merged);
});

// Settings endpoints (simple key/value store)
app.get('/api/settings/persona', (req, res) => {
  const row = db.prepare('SELECT value FROM Settings WHERE key = ?').get('selectedPersona') as any;
  if (row && row.value) return res.json({ persona: row.value });
  return res.json({ persona: null });
});

app.put('/api/settings/persona', (req, res) => {
  const { persona } = req.body;
  if (persona === undefined || persona === null) {
    const del = db.prepare('DELETE FROM Settings WHERE key = ?').run('selectedPersona');
    return res.json({ persona: null, changes: del.changes });
  }
  const up = db.prepare('INSERT INTO Settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const result = up.run('selectedPersona', String(persona));
  res.json({ persona, changes: (result as any).changes || 1 });
});


// Characters CRUD
app.get('/api/characters', (req, res) => {
  const characters = db.prepare('SELECT * FROM characters').all();
  res.json(characters);
});

app.post('/api/characters', (req, res) => {
  const { name, avatarUrl, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, tags, creator, character_version, extensions, character_book } = req.body;
  const stmt = db.prepare(`
    INSERT INTO characters (name, avatarUrl, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, tags, creator, character_version, extensions, character_book)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, avatarUrl || null, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, JSON.stringify(alternate_greetings), JSON.stringify(tags), creator, character_version, JSON.stringify(extensions), JSON.stringify(character_book));
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/characters/:id', (req, res) => {
  const { id } = req.params;
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as any;
  if (character) {
    character.alternate_greetings = JSON.parse(character.alternate_greetings || '[]');
    character.tags = JSON.parse(character.tags || '[]');
    character.extensions = JSON.parse(character.extensions || '{}');
    character.character_book = JSON.parse(character.character_book || '{}');
    res.json(character);
  } else {
    res.status(404).json({ error: 'Character not found' });
  }
});

app.put('/api/characters/:id', (req, res) => {
  const { id } = req.params;
  const { name, avatarUrl, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, tags, creator, character_version, extensions, character_book } = req.body;
  const stmt = db.prepare(`
    UPDATE characters SET name = ?, avatarUrl = ?, description = ?, personality = ?, scenario = ?, first_mes = ?, mes_example = ?, creator_notes = ?, system_prompt = ?, post_history_instructions = ?, alternate_greetings = ?, tags = ?, creator = ?, character_version = ?, extensions = ?, character_book = ? WHERE id = ?
  `);
  const result = stmt.run(name, avatarUrl || null, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, JSON.stringify(alternate_greetings), JSON.stringify(tags), creator, character_version, JSON.stringify(extensions), JSON.stringify(character_book), id);
  res.json({ changes: result.changes });
});

// Avatar upload endpoint - accepts multipart/form-data with field 'avatar'
app.post('/api/characters/:id/avatar', upload.single('avatar'), (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filepath = req.file.path;
  // Validate and resize using sharp to 256x256
  (async () => {
    try {
      await sharp(filepath).resize(256, 256, { fit: 'cover' }).toFile(filepath + '.tmp');
      // replace original
      fs.renameSync(filepath + '.tmp', filepath);
    } catch (e) {
      console.warn('Sharp processing failed, continuing with original file', e);
    }
    const avatarUrl = `${req.protocol}://${req.get('host')}/public/avatars/${req.file.filename}`;
    const stmt = db.prepare('UPDATE characters SET avatarUrl = ? WHERE id = ?');
    const result = stmt.run(avatarUrl, id);
    res.json({ avatarUrl, changes: result.changes });
  })();
});

// Remove avatar for character
app.delete('/api/characters/:id/avatar', (req, res) => {
  const { id } = req.params;
  const char = db.prepare('SELECT avatarUrl FROM characters WHERE id = ?').get(id) as any;
  if (!char || !char.avatarUrl) return res.status(404).json({ error: 'No avatar' });
  // avatarUrl may be absolute (http://host/public/avatars/...) - parse pathname
  let relPath = char.avatarUrl;
  try {
    const parsed = new URL(char.avatarUrl);
    relPath = parsed.pathname.replace(/^\//, '');
  } catch (e) {
    relPath = char.avatarUrl.replace(/^\//, '');
  }
  const fp = path.join(process.cwd(), relPath);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { console.warn('Failed to delete avatar file', e); }
  const stmt = db.prepare('UPDATE characters SET avatarUrl = NULL WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

// Persona avatar upload
app.post('/api/personas/:id/avatar', upload.single('avatar'), (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filepath = req.file.path;
  (async () => {
    try {
      await sharp(filepath).resize(256, 256, { fit: 'cover' }).toFile(filepath + '.tmp');
      fs.renameSync(filepath + '.tmp', filepath);
    } catch (e) {
      console.warn('Sharp processing failed for persona avatar, continuing with original file', e);
    }
    const avatarUrl = `${req.protocol}://${req.get('host')}/public/avatars/${req.file.filename}`;
    const stmt = db.prepare('UPDATE personas SET avatarUrl = ? WHERE id = ?');
    const result = stmt.run(avatarUrl, id);
    res.json({ avatarUrl, changes: result.changes });
  })();
});

// Delete persona avatar
app.delete('/api/personas/:id/avatar', (req, res) => {
  const { id } = req.params;
  const p = db.prepare('SELECT avatarUrl FROM personas WHERE id = ?').get(id) as any;
  if (!p || !p.avatarUrl) return res.status(404).json({ error: 'No avatar' });
  let relPath = p.avatarUrl;
  try { const parsed = new URL(p.avatarUrl); relPath = parsed.pathname.replace(/^\//, ''); } catch { relPath = p.avatarUrl.replace(/^\//, ''); }
  const fp = path.join(process.cwd(), relPath);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { console.warn('Failed to delete persona avatar file', e); }
  const stmt = db.prepare('UPDATE personas SET avatarUrl = NULL WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

app.delete('/api/characters/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM characters WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

// Lorebooks CRUD
app.get('/api/lorebooks', (req, res) => {
  const lorebooks = db.prepare('SELECT * FROM lorebooks').all();
  res.json(lorebooks);
});

app.post('/api/lorebooks', (req, res) => {
  const { name, description, scan_depth, token_budget, recursive_scanning, extensions, entries } = req.body;
  const stmt = db.prepare(`
    INSERT INTO lorebooks (name, description, scan_depth, token_budget, recursive_scanning, extensions, entries)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, description, scan_depth, token_budget, recursive_scanning ? 1 : 0, JSON.stringify(extensions), JSON.stringify(entries));
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/lorebooks/:id', (req, res) => {
  const { id } = req.params;
  const lorebook = db.prepare('SELECT * FROM lorebooks WHERE id = ?').get(id) as any;
  if (lorebook) {
    lorebook.extensions = JSON.parse(lorebook.extensions || '{}');
    lorebook.entries = JSON.parse(lorebook.entries || '[]');
    res.json(lorebook);
  } else {
    res.status(404).json({ error: 'Lorebook not found' });
  }
});

app.put('/api/lorebooks/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, scan_depth, token_budget, recursive_scanning, extensions, entries } = req.body;
  const stmt = db.prepare(`
    UPDATE lorebooks SET name = ?, description = ?, scan_depth = ?, token_budget = ?, recursive_scanning = ?, extensions = ?, entries = ? WHERE id = ?
  `);
  const result = stmt.run(name, description, scan_depth, token_budget, recursive_scanning ? 1 : 0, JSON.stringify(extensions), JSON.stringify(entries), id);
  res.json({ changes: result.changes });
});

app.delete('/api/lorebooks/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM lorebooks WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

// Personas CRUD
app.get('/api/personas', (req, res) => {
  const personas = db.prepare('SELECT * FROM personas').all();
  res.json(personas);
});

app.post('/api/personas', (req, res) => {
  const { name, description, details } = req.body;
  const stmt = db.prepare(`
    INSERT INTO personas (name, description, details)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(name, description, JSON.stringify(details));
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any;
  if (persona) {
    persona.details = JSON.parse(persona.details || '{}');
    res.json(persona);
  } else {
    res.status(404).json({ error: 'Persona not found' });
  }
});

app.put('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, details } = req.body;
  const stmt = db.prepare(`
    UPDATE personas SET name = ?, description = ?, details = ? WHERE id = ?
  `);
  const result = stmt.run(name, description, JSON.stringify(details), id);
  res.json({ changes: result.changes });
});

app.delete('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM personas WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

// Load config
const configManager = new ConfigManager();

// Initialize Orchestrator
let orchestrator: Orchestrator;
try {
  orchestrator = new Orchestrator(configManager, env, db);
} catch (error) {
  console.error('Error initializing Orchestrator:', error);
  process.exit(1);
}

// Helper: download image URL and store under public/generated/<worldId>/<campaignId>/<arcId>/<sceneId>/
async function downloadAndStoreImageForScene(originalUrl: string, sceneId: number): Promise<{ localUrl: string; size: number; width?: number; height?: number; path?: string }> {
  try {
    const sceneRow = db.prepare('SELECT * FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!sceneRow) throw new Error('Scene not found');
    const arcRow = db.prepare('SELECT * FROM Arcs WHERE id = ?').get(sceneRow.arcId) as any;
    const campaignRow = db.prepare('SELECT * FROM Campaigns WHERE id = ?').get(arcRow.campaignId) as any;
    const worldRow = db.prepare('SELECT * FROM Worlds WHERE id = ?').get(campaignRow.worldId) as any;

    const baseDir = path.join(process.cwd(), 'public', 'generated', String(worldRow.id), String(campaignRow.id), String(arcRow.id), String(sceneRow.id));
    fs.mkdirSync(baseDir, { recursive: true });

    // Stream download to file to avoid buffering large images
    const resp = await axios.get(originalUrl, { responseType: 'stream', timeout: 60000 });
    const ct = (resp.headers['content-type'] || '').split(';')[0];
    let ext = 'png';
    if (ct === 'image/jpeg' || ct === 'image/jpg') ext = 'jpg';
    else if (ct === 'image/webp') ext = 'webp';
    else if (ct === 'image/png') ext = 'png';
    else {
      const m = originalUrl.match(/\.([a-zA-Z0-9]{3,4})(?:\?|$)/);
      if (m) ext = m[1];
    }

    const fname = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
    const fp = path.join(baseDir, fname);
    const writer = fs.createWriteStream(fp);
    await new Promise((resolve, reject) => {
      resp.data.pipe(writer);
      let errored = false;
      writer.on('error', err => { errored = true; writer.close(); reject(err); });
      writer.on('close', () => { if (!errored) resolve(null); });
    });

    // gather metadata (file size and image dimensions)
    let size = 0;
    try { const st = fs.statSync(fp); size = st.size; } catch (e) { /* ignore */ }
    let width: number | undefined = undefined;
    let height: number | undefined = undefined;
    try {
      const meta = await sharp(fp).metadata();
      width = meta.width || undefined;
      height = meta.height || undefined;
    } catch (e) {
      // ignore if sharp fails
    }

    // Return absolute URL for serving
    const port = process.env.PORT || '3001';
    const host = process.env.SERVER_BASE || `http://localhost:${port}`;
    const rel = `/public/generated/${worldRow.id}/${campaignRow.id}/${arcRow.id}/${sceneRow.id}/${fname}`;
    return { localUrl: `${host}${rel}`, size, width, height, path: fp };
  } catch (e) {
    console.warn('Failed to download/store image for scene:', e);
    return { localUrl: originalUrl, size: 0 };
  }
}

// Macro preprocessor: resolve dynamic variables with nested expansions
function preprocessTemplate(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const value = getNestedValue(context, key.trim());
    return value !== undefined ? String(value) : match;
  });
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

io.on('connection', (socket) => {
  try {
    const _cfg = configManager.getConfig();
    const _logAcks = Boolean(_cfg && _cfg.features && ((_cfg.features as any).socketAckLogs));
    if (_logAcks) console.log('Client connected', socket.id);
  } catch (e) {
    console.log('Client connected');
  }

  socket.on('userMessage', async (data: { input: string; persona?: string; activeCharacters?: string[]; sceneId?: number }) => {
    const { input, persona = 'default', activeCharacters, sceneId } = data;
    if (sceneId) {
      socket.join(`scene-${sceneId}`);
    }
    try {
      console.log('User:', input);

      // Log user message if scene provided
      if (sceneId) {
        try { MessageService.logMessage(sceneId, `user:${persona}`, input, activeCharacters || [], {}); } catch (e) { console.warn('Failed to log user message', e); }
      }

      // Process through Orchestrator
      const response = await orchestrator.processUserInput(input, persona, activeCharacters);

      // Persist responses to messages if scene provided
      if (sceneId && Array.isArray(response)) {
        for (const r of response) {
          try {
            let content = r.content;
            // If the response contains an image URL (markdown), download and store locally and replace URL
            try {
              const imgMatch = String(content).match(/!\[(.*?)\]\((.*?)\)/);
              if (imgMatch) {
                const origUrl = imgMatch[2];
                const stored = await downloadAndStoreImageForScene(origUrl, Number(sceneId));
                // Try to parse alt text as JSON metadata and update urls to point to stored.localUrl where applicable
                let altData: any = null;
                try {
                  altData = JSON.parse(imgMatch[1]);
                } catch (e) { altData = null; }
                if (altData && Array.isArray(altData.urls)) {
                  for (let i = 0; i < altData.urls.length; i++) {
                    if (altData.urls[i] === origUrl) altData.urls[i] = stored.localUrl;
                  }
                  // Ensure current index points to the last added url if present
                  const newContent = `![${JSON.stringify(altData)}](${altData.urls[altData.current] || stored.localUrl})`;
                  content = newContent;
                } else {
                  // Create a minimal metadata object to store in alt
                  const dataObj = { prompt: imgMatch[1], urls: [stored.localUrl], current: 0 };
                  content = `![${JSON.stringify(dataObj)}](${stored.localUrl})`;
                }
                // Save message content and metadata separately
                let metaObj: any = null;
                try { metaObj = altData && typeof altData === 'object' ? altData : null; } catch { metaObj = null; }
                const saved = MessageService.logMessage(sceneId, r.sender, `![](${stored.localUrl})`, [], metaObj || { prompt: imgMatch[1], urls: [stored.localUrl], current: 0 });
                try { io.to(`scene-${sceneId}`).emit('imageStored', { message: saved, originalUrl: origUrl, localUrl: stored.localUrl, size: stored.size, width: stored.width, height: stored.height }); } catch (e) { console.warn('Failed to emit imageStored', e); }
                continue;
              }
            } catch (e) {
              console.warn('Failed to download/replace image for message logging', e);
            }
            MessageService.logMessage(sceneId, r.sender, content, [], {});
          } catch (e) { console.warn('Failed to log AI response', e); }
        }
      }

      // Emit full response (streaming can be added later)
      socket.emit('aiResponse', response);
    } catch (error) {
      console.error('Error processing message:', error);
      socket.emit('aiResponse', [{ sender: 'System', content: 'Sorry, an error occurred.' }]);
    }
  });

  socket.on('joinScene', (data: { sceneId: number }) => {
    try {
      const sid = data && data.sceneId;
      if (sid) {
        socket.join(`scene-${sid}`);
        console.log('Socket joined scene', sid);
      }
    } catch (e) {
      console.warn('joinScene failed', e);
    }
  });

  socket.on('leaveScene', (data: { sceneId: number }) => {
    try {
      const sid = data && data.sceneId;
      if (sid) {
        socket.leave(`scene-${sid}`);
        console.log('Socket left scene', sid);
      }
    } catch (e) {
      console.warn('leaveScene failed', e);
    }
  });

  socket.on('regenImage', async (data: { messageId: number; prompt: string; sceneId: number; requestId?: string|number }, cb?: (ack: any) => void) => {
    try {
      const cfg = configManager.getConfig();
      const logAcks = Boolean(cfg && cfg.features && ((cfg.features as any).socketAckLogs));
      try { if (logAcks) console.info('regenImage handler invoked', { messageId: data.messageId, promptLength: (data.prompt || '').length, sceneId: data.sceneId, socketId: socket.id, requestId: data.requestId }); } catch (e) {}
      // Immediately acknowledge receipt back to the emitter (if they provided a callback)
      try { cb && cb({ ok: true, receivedAt: Date.now(), requestId: data.requestId || null, socketId: socket.id }); } catch (e) {}
      // notify clients that regen started
      try { io.to(`scene-${data.sceneId}`).emit('regenStarted', { messageId: data.messageId }); } catch (err) { console.warn('Failed to emit regenStarted', err); }
      // If client didn't provide a prompt, try to read it from the message metadata or alt JSON
      let providedPrompt = (data && typeof data.prompt === 'string') ? data.prompt : '';
      if (!providedPrompt || String(providedPrompt).trim() === '') {
        try {
          const msgRow = db.prepare('SELECT message, metadata FROM Messages WHERE id = ?').get(data.messageId) as any;
          if (msgRow) {
            // try metadata column first
            try {
              const meta = (typeof msgRow.metadata === 'string') ? JSON.parse(msgRow.metadata || '{}') : (msgRow.metadata || {});
              if (meta && meta.prompt) providedPrompt = String(meta.prompt);
            } catch (e) {
              // ignore
            }
            // fallback: try to extract from alt JSON embedded in the message body
            if (!providedPrompt) {
              const m = String(msgRow.message || '').match(/!\[(.*?)\]\((.*?)\)/);
              if (m) {
                const alt = m[1] || '';
                const un = unwrapPrompt(alt);
                if (typeof un === 'string') providedPrompt = un;
                else if (un && typeof un === 'object' && un.prompt) providedPrompt = String(un.prompt);
              }
            }
          }
        } catch (e) {
          /* ignore DB read errors here and proceed with empty prompt */
        }
      }
      // Use shared unwrap/parse utilities to get the innermost prompt and a clean metadata object
      const parsedPrompt = unwrapPrompt(providedPrompt);
      let cleanPromptObj: any = {};
      if (parsedPrompt && typeof parsedPrompt === 'object') {
        for (const k of Object.keys(parsedPrompt)) if (k !== 'urls') cleanPromptObj[k] = parsedPrompt[k];
      }
      const innerPromptString = (typeof parsedPrompt === 'string') ? parsedPrompt : (typeof cleanPromptObj.prompt === 'string' ? cleanPromptObj.prompt : JSON.stringify(cleanPromptObj.prompt || cleanPromptObj || ''));
      // Escape backslashes and double quotes so the prompt can be safely embedded in JSON metadata
      const escapeForJson = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const escapedInnerPromptString = escapeForJson(innerPromptString);

      const visualAgent = new VisualAgent(configManager, env);
      const context: any = { narration: escapedInnerPromptString, metadata: cleanPromptObj, sceneElements: [] };
      let result: any = null;
      try {
        result = await visualAgent.run(context);
      } catch (vaErr) {
        const verr: any = vaErr;
        try { io.to(`scene-${data.sceneId}`).emit('regenFailed', { messageId: data.messageId, error: String(verr?.message || verr) }); } catch (err) { console.warn('Failed to emit regenFailed after VisualAgent error', err); }
        return;
      }
      const match = result && result.match ? result.match(/!\[.*?\]\((.*?)\)/) : null;
      if (match) {
        const newUrl = match[1];
        const msg = db.prepare('SELECT message FROM Messages WHERE id = ?').get(data.messageId) as any;
        if (msg) {
          const content = msg.message;
          const imgMatch = content.match(/!\[(.*?)\]\((.*?)\)/);
          if (imgMatch) {
            // Parse existing alt JSON (if any) and extract existing URLs using tryParse
            let existingUrls: string[] = [];
            try {
              const maybe = tryParse(imgMatch[1]);
              let existingObj = maybe;
              if (typeof existingObj === 'string') {
                // try parse again if it's a stringified object
                existingObj = tryParse(existingObj);
              }
              if (existingObj && Array.isArray(existingObj.urls)) existingUrls = existingObj.urls.slice();
            } catch {
              const alt = imgMatch[1] || '';
              const urlRe = /https?:\/\/[^\s"')\]]+/g;
              const found = Array.from(new Set(Array.from(String(alt).matchAll(urlRe)).map(m => m[0])));
              existingUrls = found;
            }
            // Download and store the new image locally for this scene
            let stored = { localUrl: newUrl, size: 0, width: undefined, height: undefined } as any;
            try {
              stored = await downloadAndStoreImageForScene(newUrl, Number(data.sceneId));
            } catch (e) {
              console.warn('Failed to store regenerated image locally, using remote URL', e);
            }
            // Build updated clean metadata object: use cleanPromptObj and set prompt to an escaped plain string
            const updatedMeta: any = { ...cleanPromptObj };
            updatedMeta.prompt = escapedInnerPromptString;
            const merged = Array.from(new Set([...(existingUrls || []), stored.localUrl]));
            updatedMeta.urls = merged;
            updatedMeta.current = merged.length - 1;
            const newContent = `![${JSON.stringify(updatedMeta)}](${stored.localUrl})`;
            // First emit imageStored so clients can preload the localUrl, then update message
            try { io.to(`scene-${data.sceneId}`).emit('imageStored', { messageId: data.messageId, sceneId: Number(data.sceneId), originalUrl: newUrl, localUrl: stored.localUrl, size: stored.size, width: stored.width, height: stored.height }); } catch (e) { console.warn('Failed to emit imageStored after regen', e); }
            db.prepare('UPDATE Messages SET message = ? WHERE id = ?').run(newContent, data.messageId);
            io.to(`scene-${data.sceneId}`).emit('messageUpdated', { messageId: data.messageId, newContent });
            console.log('Emitted messageUpdated for', { messageId: data.messageId, sceneId: data.sceneId, preview: newContent.slice(0,120) });
          }
        }
      } else {
        // no image returned
        try { io.to(`scene-${data.sceneId}`).emit('regenFailed', { messageId: data.messageId, error: 'No image generated' }); } catch (err) { console.warn('Failed to emit regenFailed for no-match', err); }
      }
    } catch (e) {
      console.error('Regen failed', e);
      try { io.to(`scene-${data.sceneId}`).emit('regenFailed', { messageId: data.messageId, error: (e && (e as any).message) ? (e as any).message : String(e) }); } catch (err) { console.warn('Failed to emit regenFailed', err); }
    }
  });

  socket.on('disconnect', () => {
    orchestrator.clearHistory();
    console.log('Client disconnected, history cleared');
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

// Periodic cleanup job: remove orphaned generated images not referenced in Messages
async function cleanupOrphanedGeneratedFiles() {
  try {
    const base = path.join(process.cwd(), 'public', 'generated');
    if (!fs.existsSync(base)) return;
    const filesToCheck: string[] = [];
    const walk = (dir: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const it of items) {
        const fp = path.join(dir, it.name);
        if (it.isDirectory()) walk(fp);
        else if (it.isFile()) filesToCheck.push(fp);
      }
    };
    walk(base);

    let deleted = 0;
    for (const fp of filesToCheck) {
      const name = path.basename(fp);
      // Check DB for references to this filename
      const row = db.prepare('SELECT COUNT(1) as c FROM Messages WHERE message LIKE ?').get(`%${name}%`) as any;
      const count = row?.c ?? 0;
      if (count === 0) {
        try { fs.unlinkSync(fp); deleted++; } catch (e) { /* ignore */ }
      }
    }

    // Remove empty directories under base
    const removeEmptyDirs = (dir: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      if (items.length === 0) { try { fs.rmdirSync(dir); } catch (e) {} ; return; }
      for (const it of items) if (it.isDirectory()) removeEmptyDirs(path.join(dir, it.name));
      // re-check
      const after = fs.readdirSync(dir, { withFileTypes: true });
      if (after.length === 0) try { fs.rmdirSync(dir); } catch (e) {}
    };
    removeEmptyDirs(base);

    if (deleted > 0) console.log(`Cleanup removed ${deleted} orphaned generated files`);
  } catch (e) {
    console.warn('Scheduled cleanup failed', e);
  }
}

// Run cleanup on startup and periodically (default 6 hours)
cleanupOrphanedGeneratedFiles().catch(() => {});
const CLEANUP_INTERVAL = Number(process.env.GENERATED_CLEANUP_MS || process.env.CLEANUP_INTERVAL_MS || 1000 * 60 * 60 * 6);
setInterval(() => { cleanupOrphanedGeneratedFiles().catch(() => {}); }, CLEANUP_INTERVAL);
