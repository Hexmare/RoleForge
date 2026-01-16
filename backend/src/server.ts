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
import multer from 'multer';
import { dirname } from 'path';
import { Orchestrator } from './agents/Orchestrator';
import { AgentContext } from './agents/BaseAgent';
import db, { charactersDb } from './database';
import sharp from 'sharp';
import WorldService from './services/WorldService';
import CampaignService from './services/CampaignService';
import ArcService from './services/ArcService';
import SceneService from './services/SceneService';
import MessageService from './services/MessageService';
import CharacterService from './services/CharacterService';
import LorebookService from './services/LorebookService';
import { VisualAgent } from './agents/VisualAgent';
import { tryParse, unwrapPrompt } from './utils/unpackPrompt';
import axios from 'axios';
import { randomBytes, randomUUID } from 'crypto';
import { countTokens } from './utils/tokenCounter.js';
import * as jobStore from './jobs/jobStore.js';
import * as auditLog from './jobs/auditLog.js';
import { getNestedField } from './utils/memoryHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Multer setup for avatar uploads
const avatarStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'frontend', 'public', 'avatars'),
  filename: (req: any, file: any, cb: any) => {
    cb(null, `avatar-${req.params.id}.png`);
  }
});
const uploadAvatar = multer({ storage: avatarStorage });

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
// Capture raw body while parsing JSON so we can attempt a tolerant reparse
app.use(express.json({ verify: (req: any, _res, buf: Buffer) => { try { req.rawBody = buf.toString(); } catch { req.rawBody = undefined; } } }));

// Error handler for JSON parse errors: try a tolerant reparse for common Windows/curl quoting issues
app.use((err: any, req: any, res: any, next: any) => {
  if (!err) return next();
  const isBodyParserError = err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError || (err.status === 400 && /json/i.test(String(err.message || ''))));
  if (!isBodyParserError) return next(err);

  const raw = req && req.rawBody ? String(req.rawBody) : '';
  if (!raw) {
    // Nothing to recover from
    return res.status(400).json({ error: 'Invalid JSON body', detail: err.message });
  }

  // Try a tolerant parse: first try JSON.parse, then apply simple sanitization and retry
  const tryParse = (s: string) => {
    try { return JSON.parse(s); } catch (e) { /* fallthrough */ }
    // Add quotes around unquoted object keys: { key: -> { "key":
    try {
      // Remove stray backslashes that often appear from Windows/curl/PowerShell escaping
      const sNoSlashes = s.replace(/\\(?=[\s\w":,{}\[\]])/g, '');
      let s2 = sNoSlashes.replace(/([,{\s])(\w+)\s*:/g, '$1"$2":');
      // Replace single quotes with double quotes for strings
      s2 = s2.replace(/'([^']*)'/g, '"$1"');
      return JSON.parse(s2);
    } catch (e) {
      throw e;
    }
  };

  try {
    const parsed = tryParse(raw);
    // Attach parsed body and continue to routes
    req.body = parsed;
    return next();
  } catch (e) {
    // Debug: include a short preview of the raw body in the response to help diagnose quoting/encoding issues
    const rawPreview = (raw || '').slice(0, 400);
    try { console.warn('[DEBUG] Raw request body preview:', rawPreview); } catch (_) {}
    return res.status(400).json({ error: 'Invalid JSON body', detail: String(err.message || err), recoverError: String((e as any)?.message || e), rawPreview });
  }
});

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
  try {
    const { worldId } = req.params;
    res.json(CampaignService.listByWorld(Number(worldId)));
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
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

app.get('/api/campaigns/:campaignId/state', (req, res) => {
  const { campaignId } = req.params;
  res.json(CampaignService.getState(Number(campaignId)));
});

app.put('/api/campaigns/:campaignId/state', (req, res) => {
  const { campaignId } = req.params;
  const updates = req.body;
  res.json(CampaignService.updateState(Number(campaignId), updates));
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

app.get('/api/scenes/:id', (req, res) => {
  const { id } = req.params;
  const scene = SceneService.getById(Number(id));
  if (!scene) return res.status(404).json({ error: 'Scene not found' });
  res.json(scene);
});

// Global scenes list for admin UIs (id + title)
app.get('/api/scenes', (req, res) => {
  try {
    const scenes = db.prepare('SELECT id, title, arcId, description FROM Scenes ORDER BY id').all();
    res.json(scenes.map((s: any) => ({ id: s.id, title: s.title, arcId: s.arcId, description: s.description })));
  } catch (e) {
    console.error('Failed to list scenes:', e);
    res.status(500).json({ error: 'Failed to list scenes' });
  }
});

app.delete('/api/scenes/:id', (req, res) => {
  const { id } = req.params;
  res.json(SceneService.delete(Number(id)));
});

app.post('/api/scenes/:id/reset', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await SceneService.reset(Number(id));
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, message: `Scene reset successfully. Round number reset to 1. Vector data for this scene cleared.`, ...result });
  } catch (error) {
    console.error('Failed to reset scene:', error);
    res.status(500).json({ error: 'Failed to reset scene', detail: String(error) });
  }
});

// Lorebooks API
app.get('/api/lorebooks', (req, res) => {
  try {
    res.json((LorebookService as any).listAll());
  } catch (e) {
    console.error('Failed to list lorebooks', e);
    res.status(500).json({ error: 'Failed to list lorebooks' });
  }
});

app.post('/api/lorebooks', (req, res) => {
  try {
    const { name, description, settings } = req.body;
    const lb = (LorebookService as any).createLorebook({ name, description, settings });
    res.json(lb);
  } catch (e) {
    console.error('Failed to create lorebook', e);
    res.status(500).json({ error: 'Failed to create lorebook' });
  }
});

app.get('/api/lorebooks/:uuid', (req, res) => {
  const { uuid } = req.params;
  const lb = (LorebookService as any).getLorebook(uuid);
  if (!lb) return res.status(404).json({ error: 'Lorebook not found' });
  res.json(lb);
});

app.put('/api/lorebooks/:uuid', (req, res) => {
  const { uuid } = req.params;
  const updated = (LorebookService as any).updateLorebook(uuid, req.body);
  if (!updated) return res.status(404).json({ error: 'Lorebook not found' });
  res.json(updated);
});

app.delete('/api/lorebooks/:uuid', (req, res) => {
  const { uuid } = req.params;
  res.json((LorebookService as any).deleteLorebook(uuid));
});

// Entries
app.get('/api/lorebooks/:uuid/entries', (req, res) => {
  const { uuid } = req.params;
  try {
    res.json((LorebookService as any).getEntries(uuid));
  } catch (e) {
    res.status(500).json({ error: 'Failed to get entries' });
  }
});

app.post('/api/lorebooks/:uuid/entries', (req, res) => {
  const { uuid } = req.params;
  try {
    const entry = (LorebookService as any).addEntry(uuid, req.body);
    res.json(entry);
  } catch (e) {
    console.error('Failed to add entry', e);
    res.status(500).json({ error: 'Failed to add entry' });
  }
});

app.put('/api/lorebooks/:uuid/entries/:entryId', (req, res) => {
  const { uuid, entryId } = req.params;
  const updated = (LorebookService as any).updateEntry(uuid, Number(entryId), req.body);
  if (!updated) return res.status(404).json({ error: 'Entry not found' });
  res.json(updated);
});

app.delete('/api/lorebooks/:uuid/entries/:entryId', (req, res) => {
  const { uuid, entryId } = req.params;
  res.json((LorebookService as any).deleteEntry(uuid, Number(entryId)));
});

// Import/Export endpoints for SillyTavern-compatible lorebooks
app.post('/api/lorebooks/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const raw = fs.readFileSync(req.file.path, 'utf-8');
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch (e) { try { fs.unlinkSync(req.file.path); } catch (_){}; return res.status(400).json({ error: 'invalid JSON' }); }
  try {
    // Accept SillyTavern style where `entries` may be an object with numeric keys
    if (parsed && parsed.entries && !Array.isArray(parsed.entries) && typeof parsed.entries === 'object') {
      parsed.entries = Object.values(parsed.entries);
    }

    // Basic runtime validation: entries must be an array and non-empty
    if (!parsed || typeof parsed !== 'object') {
      try { fs.unlinkSync(req.file.path); } catch (_){}
      return res.status(400).json({ error: 'invalid payload' });
    }
    if (!parsed.entries || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch (_){}
      return res.status(400).json({ error: 'import must contain entries array or object' });
    }

    // Validate each entry minimally to provide helpful errors to the user
    const errors: string[] = [];
    parsed.entries.forEach((e: any, idx: number) => {
      if (!e || typeof e !== 'object') errors.push(`entry[${idx}] is not an object`);
      const key = e.key || e.keys || e.match || e.trigger;
      if (!key || (Array.isArray(key) && key.length === 0) || (typeof key === 'string' && key.trim() === '')) {
        errors.push(`entry[${idx}] missing key(s)`);
      }
      const content = e.content || e.value || e.text || e.value;
      if (!content || typeof content !== 'string' || content.trim() === '') errors.push(`entry[${idx}] missing content`);
    });
    if (errors.length) {
      try { fs.unlinkSync(req.file.path); } catch (_){}
      return res.status(400).json({ error: 'validation failed', detail: errors });
    }

    // Ensure we have a name — prefer provided name, else use uploaded filename or fallback
    if (!parsed.name || typeof parsed.name !== 'string' || parsed.name.trim() === '') {
      try {
        const base = req.file.originalname ? path.basename(req.file.originalname, path.extname(req.file.originalname)) : 'Imported Lorebook';
        parsed.name = base;
      } catch (e) {
        parsed.name = 'Imported Lorebook';
      }
    }

    const created = (LorebookService as any).importFromSillyTavern(parsed);
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    return res.json(created);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    const em = (err as any)?.message || String(err);
    console.warn('Import validation failed:', em);
    return res.status(400).json({ error: 'import validation failed', detail: em });
  }
});

app.get('/api/lorebooks/:uuid/export', (req, res) => {
  try {
    const { uuid } = req.params;
    const out = (LorebookService as any).exportForSillyTavern(uuid);
    if (!out) return res.status(404).json({ error: 'Lorebook not found' });
    const filename = `${out.name.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'lorebook'}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Export failed', e);
    return res.status(500).json({ error: 'Export failed', detail: String((e as any).message || e) });
  }
});

// Manual summarization endpoint
app.post('/api/scenes/:sceneId/summarize', async (req, res) => {
  const { sceneId } = req.params;
  try {
    const cfg = configManager.getConfig();
    const sceneData = db.prepare('SELECT summary, lastSummarizedMessageId FROM Scenes WHERE id = ?').get(sceneId) as any;
    if (!sceneData) return res.status(404).json({ error: 'Scene not found' });

    const existingSummary = sceneData?.summary || '';
    const lastSummarizedId = sceneData?.lastSummarizedMessageId || 0;
    
    // Get new messages since last summarization
    const newMessages = MessageService.getMessages(Number(sceneId), 1000, 0).filter((m: any) => m.id > lastSummarizedId);
    const history = newMessages.map((m: any) => `${m.sender}: ${m.message}`).join('\n');
    
    const context = {
      userInput: '', // Not needed for summarization
      history: [history],
      worldState: {},
      existingSummary: existingSummary || undefined,
      maxSummaryTokens: cfg.features?.maxSummaryTokens || 500
    };

    // Emit agent status start
    io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'start' });
    
    const summary = await orchestrator.getAgent('summarize')?.run(context);
    
    if (summary) {
      // Calculate token count using proper GPT tokenization
      const tokenCount = countTokens(summary);
      
      // Get the latest message ID
      const latestMessage = db.prepare('SELECT id FROM Messages WHERE sceneId = ? ORDER BY id DESC LIMIT 1').get(sceneId) as any;
      
      // Update scene with new summary
      db.prepare('UPDATE Scenes SET summary = ?, summaryTokenCount = ?, lastSummarizedMessageId = ? WHERE id = ?').run(
        summary, tokenCount, latestMessage?.id || 0, sceneId
      );
      
      // Emit agent status complete
      io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'complete' });
      
      // Emit scene update to clients
      io.to(`scene-${sceneId}`).emit('sceneUpdated', { sceneId: Number(sceneId), summary, summaryTokenCount: tokenCount });
      
      res.json({ success: true, summary, tokenCount });
    } else {
      // Emit agent status complete on failure too
      io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'complete' });
      res.status(500).json({ error: 'Failed to generate summary' });
    }
  } catch (e) {
    console.error('Manual summarization failed:', e);
    // Emit agent status complete on error
    io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'complete' });
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// Messages
// Regenerate all AI messages in the current round (excluding user messages)
app.post('/api/scenes/:sceneId/messages/regenerate', async (req, res) => {
  const { sceneId } = req.params;
  try {
    const sceneIdNum = Number(sceneId);
    
    // Get the current scene to find current round
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?').get(sceneIdNum) as any;
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }
    
    let roundToRegenerate = scene.currentRoundNumber;
    
    // Get all messages in the current round
    let currentRoundMessages = MessageService.getRoundMessages(sceneIdNum, roundToRegenerate);
    
    // If current round has no messages, try the previous round (last completed round)
    if (currentRoundMessages.length === 0 && roundToRegenerate > 1) {
      roundToRegenerate = roundToRegenerate - 1;
      currentRoundMessages = MessageService.getRoundMessages(sceneIdNum, roundToRegenerate);
    }
    
    if (currentRoundMessages.length === 0) {
      return res.json({ regenerated: [], message: 'No messages to regenerate in current round.' });
    }
    
    // Find the user message in the current round (if any) - check source column instead of sender format
    const userMessageInRound = currentRoundMessages.find((m: any) => m.source === 'user');
    
    let triggerMessage: string;
    let persona: string;
    
    if (userMessageInRound) {
      // Normal round: regenerate based on user message
      triggerMessage = userMessageInRound.message;
      persona = userMessageInRound.sender; // sender now contains just the persona name (e.g., 'hex')
    } else {
      // AI-only round (continue round): regenerate based on previous round's character messages
      const previousRound = roundToRegenerate - 1;
      if (previousRound < 1) {
        return res.json({ regenerated: [], message: 'No previous round to continue from.' });
      }
      
      const previousRoundMessages = MessageService.getRoundMessages(sceneIdNum, previousRound);
      // Get only character messages (not user) from previous round
      const characterMessagesFromLastRound = previousRoundMessages
        .filter((msg: any) => msg.source !== 'user')
        .map((msg: any) => `${msg.sender}: ${msg.message}`)
        .join('\n\n');
      
      triggerMessage = characterMessagesFromLastRound 
        ? `[System: Continue scene. Previous character messages:\n${characterMessagesFromLastRound}\n\nRegenerating this round.]`
        : '[System: Regenerate scene continuation]';
      
      persona = 'system';
    }
    
    // Get all messages BEFORE the round being regenerated as history
    const allPreviousMessages = db.prepare('SELECT * FROM Messages WHERE sceneId = ? AND roundNumber < ? ORDER BY messageNumber ASC').all(sceneIdNum, roundToRegenerate) as any[];
    const history = allPreviousMessages.map(m => `${m.sender}: ${m.message}`);
    
    // Build session context
    const sessionContext = await orchestrator.buildSessionContext(sceneIdNum);
    
    // Patch orchestrator's history to use all previous messages
    if (orchestrator && typeof orchestrator === 'object' && (orchestrator as any).history) {
      (orchestrator as any).history = history.slice();
    }
    
    // Get active characters from context
    const activeCharacters = sessionContext?.activeCharacters?.map(c => c.id || c.name) || [];
    
    // Set the orchestrator's current round for proper tracking
    const previousOrchRound = (orchestrator as any).currentRoundNumber;
    (orchestrator as any).currentRoundNumber = roundToRegenerate;
    
    // Call orchestrator.processUserInput to regenerate responses
    const result = await orchestrator.processUserInput(triggerMessage, persona, activeCharacters, sceneIdNum);
    
    // Restore previous round state
    (orchestrator as any).currentRoundNumber = previousOrchRound;
    
    // Delete all AI messages from current round (keep user messages)
    const aiMessagesInRound = currentRoundMessages.filter((m: any) => m.source !== 'user');
    for (const msg of aiMessagesInRound) {
      MessageService.deleteMessage(msg.id);
    }
    
    // Determine where to start messageNumbers
    let nextMsgNum: number;
    if (userMessageInRound) {
      // For user-triggered rounds, start after the user message
      nextMsgNum = userMessageInRound.messageNumber + 1;
    } else {
      // For AI-only rounds, start after the last message before current round
      const lastPreviousMessage = allPreviousMessages[allPreviousMessages.length - 1];
      nextMsgNum = lastPreviousMessage ? lastPreviousMessage.messageNumber + 1 : 1;
    }
    
    const regenerated = [];
    
    // Insert new messages from orchestrator response
    for (const r of result.responses) {
      const saved = MessageService.logMessage(
        sceneIdNum,
        r.sender,
        r.content,
        [],
        {},
        r.sender === 'Narrator' ? 'narrator' : 'character',
        roundToRegenerate // Ensure messages are logged to the round being regenerated
      );
      // Update messageNumber to keep sequence
      db.prepare('UPDATE Messages SET messageNumber = ? WHERE id = ?').run(nextMsgNum, saved.id);
      regenerated.push({ id: saved.id, newContent: r.content });
      nextMsgNum++;
    }
    
    // Emit socket event to update clients
    try { io.to(`scene-${sceneIdNum}`).emit('messagesRegenerated', { sceneId: sceneIdNum, regenerated }); } catch (e) { console.warn('Failed to emit messagesRegenerated', e); }
    
    // Task 6.2: Re-vectorize the regenerated round
    // Fetch the regenerated messages and vectorize them
    try {
      const regeneratedMessages = MessageService.getRoundMessages(sceneIdNum, roundToRegenerate);
      const vectorizationAgent = orchestrator.getAgents().get('vectorization');
      if (vectorizationAgent && regeneratedMessages.length > 0) {
        const vectorContext: any = {
          sceneId: sceneIdNum,
          roundNumber: roundToRegenerate,
          messages: regeneratedMessages,
          activeCharacters: activeCharacters,
          userInput: '',
          history: [],
          worldState: sessionContext?.world || {},
          trackers: {},
          characterStates: sessionContext?.scene?.characterStates || {},
          lore: [],
          formattedLore: '',
          userPersona: {}
        };
        
        await vectorizationAgent.run(vectorContext).catch((err: any) => {
          console.warn(`[REGENERATE] VectorizationAgent failed for round ${roundToRegenerate}:`, err);
        });
        console.log(`[REGENERATE] Re-vectorized round ${roundToRegenerate} with ${regeneratedMessages.length} messages`);
      }
    } catch (e) {
      console.warn('[REGENERATE] Failed to re-vectorize round:', e);
      // Non-blocking - don't fail the regenerate if vectorization fails
    }
    
    return res.json({ regenerated });
  } catch (e) {
    console.error('Failed to regenerate messages:', e);
    return res.status(500).json({ error: 'Failed to regenerate messages', detail: String(e) });
  }
});
app.get('/api/scenes/:sceneId/messages', (req, res) => {
  const { sceneId } = req.params;
  const limit = Number(req.query.limit || 100);
  const offset = Number(req.query.offset || 0);
  res.json(MessageService.getMessages(Number(sceneId), limit, offset));
});

app.post('/api/scenes/:sceneId/messages', (req, res) => {
  const { sceneId } = req.params;
  const { sender, message, metadata, source, sourceId, roundNumber } = req.body;
  // Preserve backward compatibility: pass provided source/sourceId/roundNumber if present
  // Note: charactersPresent is no longer persisted on Messages; active characters are sourced from SceneRounds
  res.json(MessageService.logMessage(Number(sceneId), sender, message, metadata || {}, source || '', Number(roundNumber) || 1, sourceId || null));
});

// Task 5.1: Chat endpoint with round tracking
app.post('/api/scenes/:sceneId/chat', async (req, res) => {
  const { sceneId } = req.params;
  const { message: userMessage, persona = 'default', activeCharacters } = req.body;

  try {
    const sceneIdNum = Number(sceneId);
    
    // Read the current round number from Scenes table (the AUTHORITY)
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneIdNum) as any;
    const currentRound = scene?.currentRoundNumber || 1;

    // Check if this round record exists, if not create it
    const roundExists = db.prepare(
      'SELECT id FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
    ).get(sceneIdNum, currentRound) as any;
    
    if (!roundExists) {
      db.prepare(`
        INSERT INTO SceneRounds (sceneId, roundNumber, status, activeCharacters)
        VALUES (?, ?, 'in-progress', ?)
      `).run(sceneIdNum, currentRound, JSON.stringify(activeCharacters || []));
      console.log(`[CHAT] Created round ${currentRound} record for scene ${sceneIdNum}`);
    }

    // Create user message with roundNumber — use persona as sender and sourceId
    const userMsg = MessageService.logMessage(
      sceneIdNum,
      persona,
      userMessage,
      { source: 'user-input' },
      'user',
      currentRound,
      persona || null
    );

    // Generate character responses with callback to log them
    const result = await orchestrator.processUserInput(
      userMessage,
      persona,
      activeCharacters,
      sceneIdNum,
      (response: { sender: string; content: string }) => {
        // Log character response with current round number
        // Log character response; MessageService will canonicalize 'user-input'/'character' values
        MessageService.logMessage(
          sceneIdNum,
          response.sender,
          response.content,
          {},
          'character',
          currentRound,
          null
        );
      }
    );

    // Task 6.1: Complete the round after all characters have responded
    // completeRound() now handles: completing previous round, incrementing round number, creating new round
    const nextRoundNumber = await orchestrator.completeRound(sceneIdNum, activeCharacters || []);
    console.log(`[CHAT] Round ${currentRound} completed. Next round is ${nextRoundNumber}`);

    // Return response with round information
    res.json({
      success: true,
      roundNumber: currentRound,
      userMessage: userMsg,
      characterResponses: result.responses,
      nextRoundNumber: nextRoundNumber
    });
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Task 5.2: Continue Round endpoint
app.post('/api/scenes/:sceneId/continue-round', async (req, res) => {
  const { sceneId } = req.params;

  try {
    const sceneIdNum = Number(sceneId);

    // Trigger orchestrator to continue
    // This will emit agentStatus, characterResponse, stateUpdated, and roundCompleted via Socket.io
    await orchestrator.continueRound(sceneIdNum);

    // Get updated scene
    const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
      .get(sceneIdNum) as any;
    
    // The messages that were just created are in the round that was JUST COMPLETED
    // Since completeRound increments the round, we need to subtract 1 to get the round that was completed
    const completedRound = (scene?.currentRoundNumber || 2) - 1;
    const messages = MessageService.getRoundMessages(sceneIdNum, completedRound);
    
    res.json({
      success: true,
      roundNumber: completedRound,
      messages
    });
  } catch (error) {
    console.error('Continue round error:', error);
    res.status(500).json({ error: String(error) });
  }
});

// Task 5.4: Get all messages for a specific round
app.get('/api/scenes/:sceneId/rounds/:roundNumber', (req, res) => {
  const { sceneId, roundNumber } = req.params;
  try {
    const messages = MessageService.getRoundMessages(Number(sceneId), Number(roundNumber));
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Task 5.4: Get all rounds for a scene
app.get('/api/scenes/:sceneId/rounds', (req, res) => {
  const { sceneId } = req.params;
  try {
    const rounds = db.prepare(`
      SELECT DISTINCT roundNumber 
      FROM Messages 
      WHERE sceneId = ? 
      ORDER BY roundNumber DESC
    `).all(Number(sceneId));
    res.json({ rounds });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Task 5.4: Get round metadata
app.get('/api/scenes/:sceneId/rounds/:roundNumber/metadata', (req, res) => {
  const { sceneId, roundNumber } = req.params;
  try {
    const metadata = SceneService.getRoundData(Number(sceneId), Number(roundNumber));
    res.json({ metadata });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
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

// Delete a message and reorder subsequent messages, then revectorize the round
app.delete('/api/messages/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Get message info before deleting (need roundNumber for revectorization)
    const messageRow = db.prepare('SELECT sceneId, roundNumber FROM Messages WHERE id = ?').get(Number(id)) as any;
    
    const result = MessageService.deleteMessage(Number(id));
    
    // Revectorize the round if message belonged to a round
    if (messageRow && messageRow.sceneId && messageRow.roundNumber) {
      try {
        const remainingMessages = MessageService.getRoundMessages(messageRow.sceneId, messageRow.roundNumber);
        if (remainingMessages.length > 0) {
          const vectorizationAgent = orchestrator.getAgents().get('vectorization');
          if (vectorizationAgent) {
            const sessionContext = await orchestrator.buildSessionContext(messageRow.sceneId);
            const activeCharacters = sessionContext?.activeCharacters?.map((c: any) => c.id || c.name) || [];
            
            const vectorContext: any = {
              sceneId: messageRow.sceneId,
              roundNumber: messageRow.roundNumber,
              messages: remainingMessages,
              activeCharacters: activeCharacters,
              userInput: '',
              history: [],
              worldState: sessionContext?.world || {},
              trackers: {},
              characterStates: sessionContext?.scene?.characterStates || {},
              lore: [],
              formattedLore: '',
              userPersona: {}
            };
            
            await vectorizationAgent.run(vectorContext).catch((err: any) => {
              console.warn(`[DELETE] VectorizationAgent failed for round ${messageRow.roundNumber}:`, err);
            });
            console.log(`[DELETE] Re-vectorized round ${messageRow.roundNumber} after message deletion`);
          }
        }
      } catch (e) {
        console.warn('[DELETE] Failed to re-vectorize round:', e);
        // Non-blocking - don't fail the delete if vectorization fails
      }
    }
    
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

// Update active characters for a scene
app.put('/api/scenes/:sceneId/active-characters', (req, res) => {
  const { sceneId } = req.params;
  const { activeCharacters } = req.body;
  console.log(`Updating active characters for scene ${sceneId} to:`, activeCharacters);
  try {
    const stmt = db.prepare('UPDATE Scenes SET activeCharacters = ? WHERE id = ?');
    const result = stmt.run(JSON.stringify(activeCharacters || []), Number(sceneId));
    if (result.changes > 0) {
      console.log('Successfully updated active characters in database');
      // Emit update
      try { io.emit('activeCharactersUpdated', { sceneId: Number(sceneId), activeCharacters }); } catch (e) { console.warn('Failed to emit activeCharactersUpdated', e); }
      res.json({ success: true });
    } else {
      console.log('No scene found with id:', sceneId);
      res.status(404).json({ error: 'Scene not found' });
    }
  } catch (e) {
    console.error('Error updating active characters:', e);
    res.status(500).json({ error: 'Failed to update active characters' });
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
  const merged = CharacterService.getMergedCharacter({ worldId, campaignId, characterId: slug });
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

// LLM Configuration API
app.get('/api/llm/config', (req, res) => {
  try {
    const config = configManager.getConfig();
    res.json({
      defaultProfile: config.defaultProfile,
      profiles: config.profiles,
      agents: config.agents
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/llm/config', express.json(), (req, res) => {
  try {
    const { defaultProfile, profiles, agents } = req.body;
    
    // Validate that profiles exist
    if (profiles && typeof profiles === 'object') {
      const defaultProfExists = Object.keys(profiles).includes(defaultProfile);
      if (!defaultProfExists) {
        return res.status(400).json({ error: `Default profile "${defaultProfile}" not found in profiles` });
      }
    }
    
    // Read current config
    const configPath = path.join(__dirname, '..', 'config.json');
    const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Update with new values
    if (defaultProfile !== undefined) currentConfig.defaultProfile = defaultProfile;
    if (profiles !== undefined) currentConfig.profiles = profiles;
    if (agents !== undefined) currentConfig.agents = agents;
    
    // Write back
    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
    
    // Reload config manager
    configManager.reload();
    
    res.json({ success: true, config: currentConfig });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/llm/profiles', (req, res) => {
  try {
    const config = configManager.getConfig();
    const profiles = Object.entries(config.profiles || {}).map(([name, profile]: any) => ({
      name,
      ...profile
    }));
    res.json(profiles);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/llm/profiles', express.json(), (req, res) => {
  try {
    const { name, profile } = req.body;
    
    if (!name || !profile) {
      return res.status(400).json({ error: 'Name and profile data required' });
    }
    
    const configPath = path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    config.profiles[name] = profile;
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    configManager.reload();
    
    res.json({ success: true, profile: { name, ...profile } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/llm/profiles/:name', express.json(), (req, res) => {
  try {
    const { name } = req.params;
    const profileData = req.body;
    
    const configPath = path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    if (!config.profiles[name]) {
      return res.status(404).json({ error: `Profile "${name}" not found` });
    }
    
    config.profiles[name] = { ...config.profiles[name], ...profileData };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    configManager.reload();
    
    res.json({ success: true, profile: { name, ...config.profiles[name] } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/llm/profiles/:name', (req, res) => {
  try {
    const { name } = req.params;
    
    const configPath = path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    if (!config.profiles[name]) {
      return res.status(404).json({ error: `Profile "${name}" not found` });
    }
    
    delete config.profiles[name];
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    configManager.reload();
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/llm/templates', (req, res) => {
  try {
    const templatesDir = path.join(__dirname, 'llm_templates');
    const templates = fs.readdirSync(templatesDir)
      .filter(f => f.endsWith('.njk'))
      .map(f => f.replace('.njk', ''));
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Characters CRUD
app.get('/api/characters', (req, res) => {
  const characters = CharacterService.getAllCharacters();
  res.json(characters);
});

app.get('/api/characters/:id', (req, res) => {
  const id = req.params.id;
  const character = CharacterService.getBaseById(id);
  if (character) {
    res.json(character);
  } else {
    res.status(404).json({ error: 'Character not found' });
  }
});

app.post('/api/characters', (req, res) => {
  const characterData = req.body;
  const id = characterData.id || CharacterService.saveBaseCharacter(characterData.name, characterData, characterData.avatarUrl || characterData.avatar);
  if (characterData.id) {
    // If a UUID was provided, save it with that ID
    CharacterService.saveBaseCharacter(characterData.id, characterData, characterData.avatarUrl || characterData.avatar);
  }
  res.json({ id });
});

app.put('/api/characters/:id', (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const { name, avatarUrl, ...rest } = data;
  let updateFields = 'name = ?, data = ?';
  let params = [name, JSON.stringify(rest)];
  if (avatarUrl !== undefined) {
    updateFields += ', avatar = ?';
    params.push(avatarUrl);
  }
  charactersDb.prepare(`UPDATE Characters SET ${updateFields} WHERE id = ?`).run(...params, id);
  res.json({ success: true });
});

app.post('/api/characters/import', async (req, res) => {
  const { card, directions } = req.body;
  try {
    // Call CreatorAgent
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context: AgentContext = {
      userInput: '',
      history: [],
      worldState: {},
      character: card,
      creationRequest: directions,
      maxCompletionTokens: 2000
    };
    const result = await orchestrator.createCharacter(context);
    const generatedChar = JSON.parse(result);
    // Save to charactersDb
    const id = generatedChar.id || `char-${Date.now()}`;
    CharacterService.saveBaseCharacter(id, generatedChar);
    res.json({ id });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import character' });
  }
});

app.post('/api/characters/generate', async (req, res) => {
  const { name, description, instructions } = req.body;
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Character_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'create',
      name,
      description,
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const generatedChar = JSON.parse(result);
    // Generate UUID for new character
    const charWithId = { ...generatedChar, id: randomUUID() };
    const id = CharacterService.saveBaseCharacter(charWithId.id, charWithId, charWithId.avatarUrl || charWithId.avatar);
    res.json({ id });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: 'Failed to generate character' });
  }
});

app.post('/api/characters/import', async (req, res) => {
  const { card, directions } = req.body;
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Character_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'import',
      cardData: JSON.stringify(card),
      userDirections: directions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const importedChar = JSON.parse(result);
    // Generate UUID for imported character
    const charWithId = { ...importedChar, id: randomUUID() };
    const id = CharacterService.saveBaseCharacter(charWithId.id, charWithId, charWithId.avatarUrl || charWithId.avatar);
    res.json({ id });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import character' });
  }
});

app.post('/api/characters/:id/update', async (req, res) => {
  const { instructions, selectedFields } = req.body;
  const id = req.params.id;
  try {
    const existing = CharacterService.getBaseById(id);
    if (!existing) return res.status(404).json({ error: 'Character not found' });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Character_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'update',
      existingData: existing,
      selectedFields: selectedFields || [],
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const updatedChar = JSON.parse(result);
    CharacterService.saveBaseCharacter(id, updatedChar);
    res.json({ id });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

app.post('/api/characters/:id/field', async (req, res) => {
  const { field, instructions } = req.body;
  const id = req.params.id;
  try {
    const existing = CharacterService.getBaseById(id);
    if (!existing) return res.status(404).json({ error: 'Character not found' });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Character_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'field',
      existingData: existing,
      field,
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    // For field, result is the value
    let value = result;
    try { value = JSON.parse(result); } catch {}
    
    // Return the generated value to frontend for local state management
    res.json({ value });
  } catch (error) {
    console.error('Field update error:', error);
    res.status(500).json({ error: 'Failed to update field' });
  }
});

app.get('/api/characters/:id', (req, res) => {
  const character = CharacterService.getBaseById(req.params.id);
  if (character) {
    res.json(character);
  } else {
    res.status(404).json({ error: 'Character not found' });
  }
});

app.put('/api/characters/:id', (req, res) => {
  const characterData = req.body;
  CharacterService.saveBaseCharacter(req.params.id, characterData);
  res.json({ id: req.params.id });
});

// Avatar upload endpoint - accepts multipart/form-data with field 'avatar'
app.post('/api/characters/:id/avatar', uploadAvatar.single('avatar'), (req, res) => {
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
    const avatarPath = `/avatars/${req.file.filename}`;
    charactersDb.prepare('UPDATE Characters SET avatar = ? WHERE id = ?').run(avatarPath, id);
    res.json({ avatar: avatarPath });
  })();
});

// Remove avatar for character
app.delete('/api/characters/:id/avatar', (req, res) => {
  const { id } = req.params;
  const char = charactersDb.prepare('SELECT avatar FROM Characters WHERE id = ?').get(id) as any;
  if (!char || !char.avatar) return res.status(404).json({ error: 'No avatar' });
  // avatar is /avatars/filename - parse
  let relPath = char.avatar;
  if (relPath.startsWith('/')) {
    relPath = relPath.substring(1);
  }
  const fp = path.join(__dirname, '..', '..', 'frontend', 'public', relPath);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { console.warn('Failed to delete avatar file', e); }
  charactersDb.prepare('UPDATE Characters SET avatar = NULL WHERE id = ?').run(id);
  res.json({ success: true });
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
  CharacterService.deleteCharacter(req.params.id);
  res.json({ id: req.params.id });
});

// Character array management endpoints
app.post('/api/characters/:id/family-members', (req, res) => {
  const { id } = req.params;
  const { member } = req.body;
  if (!member || typeof member !== 'string') return res.status(400).json({ error: 'Invalid member' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const familyMembers = char.familyMembers || [];
  familyMembers.push(member);
  char.familyMembers = familyMembers;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ familyMembers });
});

app.delete('/api/characters/:id/family-members/:index', (req, res) => {
  const { id, index } = req.params;
  const idx = parseInt(index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const familyMembers = char.familyMembers || [];
  if (idx < 0 || idx >= familyMembers.length) return res.status(400).json({ error: 'Index out of range' });
  familyMembers.splice(idx, 1);
  char.familyMembers = familyMembers;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ familyMembers });
});

app.post('/api/characters/:id/secrets', (req, res) => {
  const { id } = req.params;
  const { secret } = req.body;
  if (!secret || typeof secret !== 'string') return res.status(400).json({ error: 'Invalid secret' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const secrets = char.secrets || [];
  secrets.push(secret);
  char.secrets = secrets;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ secrets });
});

app.delete('/api/characters/:id/secrets/:index', (req, res) => {
  const { id, index } = req.params;
  const idx = parseInt(index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const secrets = char.secrets || [];
  if (idx < 0 || idx >= secrets.length) return res.status(400).json({ error: 'Index out of range' });
  secrets.splice(idx, 1);
  char.secrets = secrets;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ secrets });
});

app.post('/api/characters/:id/goals', (req, res) => {
  const { id } = req.params;
  const { goal } = req.body;
  if (!goal || typeof goal !== 'string') return res.status(400).json({ error: 'Invalid goal' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const goals = char.goals || [];
  goals.push(goal);
  char.goals = goals;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ goals });
});

app.delete('/api/characters/:id/goals/:index', (req, res) => {
  const { id, index } = req.params;
  const idx = parseInt(index);
  if (isNaN(idx)) return res.status(400).json({ error: 'Invalid index' });
  const char = CharacterService.getBaseById(id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  const goals = char.goals || [];
  if (idx < 0 || idx >= goals.length) return res.status(400).json({ error: 'Index out of range' });
  goals.splice(idx, 1);
  char.goals = goals;
  CharacterService.saveBaseCharacter(id, char);
  res.json({ goals });
});

// Worlds CRUD
app.get('/api/worlds', (req, res) => {
  try {
    const worlds = WorldService.getAll();
    res.json(worlds);
  } catch (error) {
    console.error('Error fetching worlds:', error);
    res.status(500).json({ error: 'Failed to fetch worlds' });
  }
});

app.post('/api/worlds', (req, res) => {
  try {
    const { name, description } = req.body;
    const world = WorldService.create(name, description);
    res.json(world);
  } catch (error) {
    console.error('Error creating world:', error);
    res.status(500).json({ error: 'Failed to create world' });
  }
});

app.get('/api/worlds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const world = WorldService.getById(Number(id));
    if (world) {
      res.json(world);
    } else {
      res.status(404).json({ error: 'World not found' });
    }
  } catch (error) {
    console.error('Error fetching world:', error);
    res.status(500).json({ error: 'Failed to fetch world' });
  }
});

app.put('/api/worlds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = WorldService.update(Number(id), { name, description });
    res.json(result);
  } catch (error) {
    console.error('Error updating world:', error);
    res.status(500).json({ error: 'Failed to update world' });
  }
});

app.delete('/api/worlds/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = WorldService.delete(Number(id));
    res.json(result);
  } catch (error) {
    console.error('Error deleting world:', error);
    res.status(500).json({ error: 'Failed to delete world' });
  }
});

// Campaigns CRUD
app.get('/api/worlds/:worldId/campaigns', (req, res) => {
  try {
    const { worldId } = req.params;
    const campaigns = CampaignService.listByWorld(Number(worldId));
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

app.post('/api/worlds/:worldId/campaigns', (req, res) => {
  try {
    const { worldId } = req.params;
    const { name, description } = req.body;
    const campaign = CampaignService.create(Number(worldId), name, description);
    res.json(campaign);
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

app.get('/api/campaigns/:id', (req, res) => {
  try {
    const { id } = req.params;
    const campaign = CampaignService.getById(Number(id));
    if (campaign) {
      res.json(campaign);
    } else {
      res.status(404).json({ error: 'Campaign not found' });
    }
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

app.put('/api/campaigns/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = CampaignService.update(Number(id), { name, description });
    res.json(result);
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

app.delete('/api/campaigns/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = CampaignService.delete(Number(id));
    res.json(result);
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Campaign state
app.get('/api/campaigns/:campaignId/state', (req, res) => {
  try {
    const { campaignId } = req.params;
    const state = CampaignService.getState(Number(campaignId));
    res.json(state);
  } catch (error) {
    console.error('Error fetching campaign state:', error);
    res.status(500).json({ error: 'Failed to fetch campaign state' });
  }
});

// Arcs CRUD
app.get('/api/campaigns/:campaignId/arcs', (req, res) => {
  try {
    const { campaignId } = req.params;
    const arcs = ArcService.listByCampaign(Number(campaignId));
    res.json(arcs);
  } catch (error) {
    console.error('Error fetching arcs:', error);
    res.status(500).json({ error: 'Failed to fetch arcs' });
  }
});

app.post('/api/campaigns/:campaignId/arcs', (req, res) => {
  try {
    const { campaignId } = req.params;
    const { name, description } = req.body;
    const arc = ArcService.create(Number(campaignId), name, description);
    res.json(arc);
  } catch (error) {
    console.error('Error creating arc:', error);
    res.status(500).json({ error: 'Failed to create arc' });
  }
});

app.get('/api/arcs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const arc = ArcService.getById(Number(id));
    if (arc) {
      res.json(arc);
    } else {
      res.status(404).json({ error: 'Arc not found' });
    }
  } catch (error) {
    console.error('Error fetching arc:', error);
    res.status(500).json({ error: 'Failed to fetch arc' });
  }
});

app.put('/api/arcs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const result = ArcService.update(Number(id), { name, description });
    res.json(result);
  } catch (error) {
    console.error('Error updating arc:', error);
    res.status(500).json({ error: 'Failed to update arc' });
  }
});

app.delete('/api/arcs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = ArcService.delete(Number(id));
    res.json(result);
  } catch (error) {
    console.error('Error deleting arc:', error);
    res.status(500).json({ error: 'Failed to delete arc' });
  }
});

// Scenes CRUD
app.get('/api/arcs/:arcId/scenes', (req, res) => {
  try {
    const { arcId } = req.params;
    const scenes = SceneService.listByArc(Number(arcId));
    res.json(scenes);
  } catch (error) {
    console.error('Error fetching scenes:', error);
    res.status(500).json({ error: 'Failed to fetch scenes' });
  }
});

app.post('/api/arcs/:arcId/scenes', (req, res) => {
  try {
    const { arcId } = req.params;
    const { title, description, location } = req.body;
    const scene = SceneService.create(Number(arcId), title, description, location);
    res.json(scene);
  } catch (error) {
    console.error('Error creating scene:', error);
    res.status(500).json({ error: 'Failed to create scene' });
  }
});

app.get('/api/scenes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const scene = SceneService.getById(Number(id));
    if (scene) {
      res.json(scene);
    } else {
      res.status(404).json({ error: 'Scene not found' });
    }
  } catch (error) {
    console.error('Error fetching scene:', error);
    res.status(500).json({ error: 'Failed to fetch scene' });
  }
});

app.put('/api/scenes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, location } = req.body;
    const result = SceneService.update(Number(id), { title, description, location });
    res.json(result);
  } catch (error) {
    console.error('Error updating scene:', error);
    res.status(500).json({ error: 'Failed to update scene' });
  }
});

app.delete('/api/scenes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = SceneService.delete(Number(id));
    res.json(result);
  } catch (error) {
    console.error('Error deleting scene:', error);
    res.status(500).json({ error: 'Failed to delete scene' });
  }
});

// Lorebooks CRUD (using LorebookService with uuid)
app.get('/api/lorebooks', (req, res) => {
  try {
    const lorebooks: any[] = LorebookService.listAll();
    const simplified = lorebooks.map(lb => ({ uuid: lb.uuid, name: lb.name, description: lb.description }));
    res.json(simplified);
  } catch (error) {
    console.error('Error fetching lorebooks:', error);
    res.status(500).json({ error: 'Failed to fetch lorebooks' });
  }
});

app.post('/api/lorebooks', (req, res) => {
  try {
    const { name, description, settings } = req.body;
    const lb = LorebookService.createLorebook({ name, description, settings });
    res.json({ uuid: lb.uuid, name: lb.name, description: lb.description });
  } catch (error) {
    console.error('Error creating lorebook:', error);
    res.status(500).json({ error: 'Failed to create lorebook' });
  }
});

app.get('/api/lorebooks/:uuid', (req, res) => {
  try {
    const { uuid } = req.params;
    const lb = LorebookService.getLorebook(uuid);
    if (lb) {
      res.json(lb);
    } else {
      res.status(404).json({ error: 'Lorebook not found' });
    }
  } catch (error) {
    console.error('Error fetching lorebook:', error);
    res.status(500).json({ error: 'Failed to fetch lorebook' });
  }
});

app.put('/api/lorebooks/:uuid', (req, res) => {
  try {
    const { uuid } = req.params;
    const { name, description, settings } = req.body;
    const lb = LorebookService.updateLorebook(uuid, { name, description, settings });
    if (lb) {
      res.json(lb);
    } else {
      res.status(404).json({ error: 'Lorebook not found' });
    }
  } catch (error) {
    console.error('Error updating lorebook:', error);
    res.status(500).json({ error: 'Failed to update lorebook' });
  }
});

app.delete('/api/lorebooks/:uuid', (req, res) => {
  try {
    const { uuid } = req.params;
    const result = LorebookService.deleteLorebook(uuid);
    res.json(result);
  } catch (error) {
    console.error('Error deleting lorebook:', error);
    res.status(500).json({ error: 'Failed to delete lorebook' });
  }
});

// Lorebook entries
app.get('/api/lorebooks/:uuid/entries', (req, res) => {
  try {
    const { uuid } = req.params;
    const entries = LorebookService.getEntries(uuid);
    res.json(entries);
  } catch (error) {
    console.error('Error fetching lorebook entries:', error);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

app.post('/api/lorebooks/:uuid/entries', (req, res) => {
  try {
    const { uuid } = req.params;
    const entry = req.body;
    const newEntry = LorebookService.addEntry(uuid, entry);
    res.json(newEntry);
  } catch (error) {
    console.error('Error adding entry:', error);
    res.status(500).json({ error: 'Failed to add entry' });
  }
});

app.put('/api/lorebooks/:uuid/entries/:entryId', (req, res) => {
  try {
    const { uuid, entryId } = req.params;
    const entry = req.body;
    const updated = LorebookService.updateEntry(uuid, Number(entryId), entry);
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).json({ error: 'Entry not found' });
    }
  } catch (error) {
    console.error('Error updating entry:', error);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

app.delete('/api/lorebooks/:uuid/entries/:entryId', (req, res) => {
  try {
    const { uuid, entryId } = req.params;
    const result = LorebookService.deleteEntry(uuid, Number(entryId));
    res.json(result);
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// Import/Export
app.post('/api/lorebooks/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const json = JSON.parse(fs.readFileSync(req.file.path, 'utf-8'));
    const lb = LorebookService.importFromSillyTavern(json);
    // Clean up temp file
    fs.unlinkSync(req.file.path);
    res.json({ uuid: lb.uuid, name: lb.name });
  } catch (error) {
    console.error('Error importing lorebook:', error);
    res.status(500).json({ error: 'Failed to import lorebook' });
  }
});

app.get('/api/lorebooks/:uuid/export', (req, res) => {
  try {
    const { uuid } = req.params;
    const json = LorebookService.exportForSillyTavern(uuid);
    if (!json) return res.status(404).json({ error: 'Lorebook not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${json.name || 'lorebook'}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(json);
  } catch (error) {
    console.error('Error exporting lorebook:', error);
    res.status(500).json({ error: 'Failed to export lorebook' });
  }
});

// World lorebook associations
app.get('/api/worlds/:id/lorebooks', (req, res) => {
  try {
    const { id } = req.params;
    const lorebookUuids = WorldService.getLorebooks(Number(id));
    res.json(lorebookUuids);
  } catch (error) {
    console.error('Error fetching world lorebooks:', error);
    res.status(500).json({ error: 'Failed to fetch lorebooks' });
  }
});

app.post('/api/worlds/:id/lorebooks', (req, res) => {
  try {
    const { id } = req.params;
    const { lorebookUuid } = req.body;
    const result = WorldService.addLorebook(Number(id), lorebookUuid);
    res.json(result);
  } catch (error) {
    console.error('Error adding lorebook to world:', error);
    res.status(500).json({ error: 'Failed to add lorebook' });
  }
});

app.delete('/api/worlds/:id/lorebooks/:lorebookUuid', (req, res) => {
  try {
    const { id, lorebookUuid } = req.params;
    const result = WorldService.removeLorebook(Number(id), lorebookUuid);
    res.json(result);
  } catch (error) {
    console.error('Error removing lorebook from world:', error);
    res.status(500).json({ error: 'Failed to remove lorebook' });
  }
});

// Campaign lorebook associations
app.get('/api/campaigns/:id/lorebooks', (req, res) => {
  try {
    const { id } = req.params;
    const lorebookUuids = CampaignService.getLorebooks(Number(id));
    res.json(lorebookUuids);
  } catch (error) {
    console.error('Error fetching campaign lorebooks:', error);
    res.status(500).json({ error: 'Failed to fetch lorebooks' });
  }
});

app.post('/api/campaigns/:id/lorebooks', (req, res) => {
  try {
    const { id } = req.params;
    const { lorebookUuid } = req.body;
    const result = CampaignService.addLorebook(Number(id), lorebookUuid);
    res.json(result);
  } catch (error) {
    console.error('Error adding lorebook to campaign:', error);
    res.status(500).json({ error: 'Failed to add lorebook' });
  }
});

app.delete('/api/campaigns/:id/lorebooks/:lorebookUuid', (req, res) => {
  try {
    const { id, lorebookUuid } = req.params;
    const result = CampaignService.removeLorebook(Number(id), lorebookUuid);
    res.json(result);
  } catch (error) {
    console.error('Error removing lorebook from campaign:', error);
    res.status(500).json({ error: 'Failed to remove lorebook' });
  }
});

// Personas CRUD
app.get('/api/personas', (req, res) => {
  const personas = db.prepare('SELECT * FROM personas').all();
  res.json(personas.map((p: any) => ({ ...p, data: JSON.parse(p.data || '{}') })));
});

app.post('/api/personas', (req, res) => {
  const personaData = req.body;
  const stmt = db.prepare(`
    INSERT INTO personas (name, data, race, skinTone)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    personaData.name,
    JSON.stringify(personaData),
    personaData.race || 'Caucasian',
    personaData.skinTone || 'white'
  );
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any;
  if (persona) {
    persona.data = JSON.parse(persona.data || '{}');
    res.json(persona);
  } else {
    res.status(404).json({ error: 'Persona not found' });
  }
});

app.put('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const personaData = req.body;
  const stmt = db.prepare(`
    UPDATE personas SET name = ?, data = ?, race = ?, skinTone = ? WHERE id = ?
  `);
  const result = stmt.run(
    personaData.name,
    JSON.stringify(personaData),
    personaData.race || 'Caucasian',
    personaData.skinTone || 'white',
    id
  );
  res.json({ changes: result.changes });
});

app.delete('/api/personas/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM personas WHERE id = ?');
  const result = stmt.run(id);
  res.json({ changes: result.changes });
});

app.post('/api/personas/generate', async (req, res) => {
  const { name, description, instructions } = req.body;
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Persona_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'create',
      name,
      description,
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const generatedPersona = JSON.parse(result);
    const stmt = db.prepare('INSERT INTO personas (name, data, race, skinTone) VALUES (?, ?, ?, ?)');
    const dbResult = stmt.run(
      generatedPersona.name,
      JSON.stringify(generatedPersona),
      generatedPersona.race || 'Caucasian',
      generatedPersona.appearance?.skinTone || generatedPersona.skinTone || 'white'
    );
    res.json({ id: dbResult.lastInsertRowid });
  } catch (error) {
    console.error('Generate persona error:', error);
    res.status(500).json({ error: 'Failed to generate persona' });
  }
});

app.post('/api/personas/:id/update', async (req, res) => {
  const { instructions, selectedFields } = req.body;
  const id = req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Persona not found' });
    const existingData = JSON.parse(existing.data || '{}');
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Persona_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'update',
      existingData,
      selectedFields: selectedFields || [],
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const updatedPersona = JSON.parse(result);
    const stmt = db.prepare('UPDATE personas SET name = ?, data = ?, race = ?, skinTone = ? WHERE id = ?');
    const dbResult = stmt.run(
      updatedPersona.name,
      JSON.stringify(updatedPersona),
      updatedPersona.race || existing.race || 'Caucasian',
      updatedPersona.appearance?.skinTone || updatedPersona.skinTone || existing.skinTone || 'white',
      id
    );
    res.json({ changes: dbResult.changes });
  } catch (error) {
    console.error('Update persona error:', error);
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

app.post('/api/personas/:id/field', async (req, res) => {
  const { field, instructions } = req.body;
  const id = req.params.id;
  try {
    const existing = db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as any;
    if (!existing) return res.status(404).json({ error: 'Persona not found' });
    const existingData = JSON.parse(existing.data || '{}');
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'Persona_Schema.json'), 'utf8'));
    const orchestrator = new Orchestrator(configManager, env, db, io);
    const context = {
      mode: 'field',
      existingData,
      field,
      instructions,
      schema: JSON.stringify(schema),
      maxCompletionTokens: 2000,
      userInput: '',
      history: [],
      worldState: {}
    };
    const result = await orchestrator.createCharacter(context);
    const updatedPersona = { ...existingData };
    let value = result;
    try { value = JSON.parse(result); } catch {}
    updatedPersona[field] = value;
    const stmt = db.prepare('UPDATE personas SET name = ?, data = ?, race = ?, skinTone = ? WHERE id = ?');
    const dbResult = stmt.run(
      updatedPersona.name,
      JSON.stringify(updatedPersona),
      updatedPersona.race || existing.race || 'Caucasian',
      updatedPersona.appearance?.skinTone || updatedPersona.skinTone || existing.skinTone || 'white',
      id
    );
    res.json({ changes: dbResult.changes });
  } catch (error) {
    console.error('Field update persona error:', error);
    res.status(500).json({ error: 'Failed to update field' });
  }
});

// Load config
const configManager = new ConfigManager();

// Initialize Orchestrator (after io is defined)
let orchestrator: Orchestrator;
try {
  orchestrator = new Orchestrator(configManager, env, db, io);
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
    const value = getNestedField(context, key.trim());
    return value !== undefined ? String(value) : match;
  });
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

      let currentRound = 1;
      
      // Get current round number from database and ensure round record exists
      if (sceneId) {
        const scene = db.prepare('SELECT currentRoundNumber FROM Scenes WHERE id = ?')
          .get(sceneId) as any;
        currentRound = scene?.currentRoundNumber || 1;
        
        // Check if this round record exists, if not create it
        const roundExists = db.prepare(
          'SELECT id FROM SceneRounds WHERE sceneId = ? AND roundNumber = ?'
        ).get(sceneId, currentRound) as any;
        
        if (!roundExists) {
          db.prepare(`
            INSERT INTO SceneRounds (sceneId, roundNumber, status, activeCharacters)
            VALUES (?, ?, 'in-progress', ?)
          `).run(sceneId, currentRound, JSON.stringify(activeCharacters || []));
          console.log(`[SOCKET] Created round ${currentRound} record for scene ${sceneId}`);
        }
      }

      // Log user message if scene provided
      if (sceneId && !input.startsWith('/')) {
          try { 
          // Use persona as sender and as sourceId (if persona encodes an id it will be preserved)
          MessageService.logMessage(sceneId, persona, input, {}, 'user', currentRound, persona || null);
        } catch (e) { console.warn('Failed to log user message', e); }
      }

      // Callback for streaming character responses
      const onCharacterResponse = (response: { sender: string; content: string }) => {
        socket.emit('characterResponse', response);
      };

      // Process through Orchestrator
      const result = await orchestrator.processUserInput(input, persona, activeCharacters, sceneId, onCharacterResponse);
      const { responses, lore } = result;

      // Persist responses to messages if scene provided
      if (sceneId && Array.isArray(responses)) {
        for (const r of responses) {
          try {
            let content = r.content;
            // Skip logging if content is empty or null
            if (!content) {
              console.warn(`Skipping message log for ${r.sender}: content is empty or null`);
              continue;
            }
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
                  const saved = MessageService.logMessage(sceneId, r.sender, `![](${stored.localUrl})`, metaObj || { prompt: imgMatch[1], urls: [stored.localUrl], current: 0 }, 'image', currentRound);
                try { io.to(`scene-${sceneId}`).emit('imageStored', { message: saved, originalUrl: origUrl, localUrl: stored.localUrl, size: stored.size, width: stored.width, height: stored.height }); } catch (e) { console.warn('Failed to emit imageStored', e); }
                continue;
              }
            } catch (e) {
              console.warn('Failed to download/replace image for message logging', e);
            }
            let source = '';
            if (r.sender !== 'System' && r.sender !== 'Narrator') {
              source = 'character';
            } else if (r.sender === 'Narrator') {
              source = 'narrator';
            }
            MessageService.logMessage(sceneId, r.sender, content, {}, source, currentRound);
          } catch (e) { console.warn('Failed to log AI response', e); }
        }
      }

      // Complete the round after all responses (only if sceneId provided)
      if (sceneId && Array.isArray(responses) && responses.length > 0) {
        try {
          const nextRoundNumber = await orchestrator.completeRound(sceneId, activeCharacters || []);
          console.log(`[SOCKET] Round ${currentRound} completed. Next round is ${nextRoundNumber}`);
        } catch (e) {
          console.error('[SOCKET] Failed to complete round:', e);
        }
      }

      // Check for summarization trigger
      if (sceneId) {
        try {
          const cfg = configManager.getConfig();
          const interval = cfg.features?.summarizationInterval;
          if (interval && typeof interval === 'number' && interval > 0) {
            const messageCount = db.prepare('SELECT COUNT(*) as count FROM Messages WHERE sceneId = ?').get(sceneId) as any;
            if (messageCount.count % interval === 0) {
              // Get scene data for existing summary
              const sceneData = db.prepare('SELECT summary, lastSummarizedMessageId FROM Scenes WHERE id = ?').get(sceneId) as any;
              const existingSummary = sceneData?.summary || '';
              const lastSummarizedId = sceneData?.lastSummarizedMessageId || 0;
              
              // Get new messages since last summarization
              const newMessages = MessageService.getMessages(sceneId, 1000, 0).filter((m: any) => m.id > lastSummarizedId);
              const history = newMessages.map((m: any) => `${m.sender}: ${m.message}`).join('\n');
              
              const context = {
                userInput: '', // Not needed for summarization
                history: [history],
                worldState: {},
                existingSummary: existingSummary || undefined,
                maxSummaryTokens: cfg.features?.maxSummaryTokens || 500
              };
              
              // Emit agent status start
              io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'start' });
              
              const summary = await orchestrator.getAgent('summarize')?.run(context);
              
              if (summary) {
                // Calculate token count using proper GPT tokenization
                const tokenCount = countTokens(summary);
                
                // Get the latest message ID
                const latestMessage = db.prepare('SELECT id FROM Messages WHERE sceneId = ? ORDER BY id DESC LIMIT 1').get(sceneId) as any;
                
                // Update scene with new summary
                db.prepare('UPDATE Scenes SET summary = ?, summaryTokenCount = ?, lastSummarizedMessageId = ? WHERE id = ?').run(
                  summary, tokenCount, latestMessage?.id || 0, sceneId
                );
                console.log(`Summarized scene ${sceneId} after ${messageCount.count} messages (${tokenCount} tokens)`);
              }
              
              // Emit agent status complete
              io.to(`scene-${sceneId}`).emit('agentStatus', { agent: 'Summarize', status: 'complete' });
            }
          }
        } catch (e) {
          console.warn('Summarization failed', e);
        }
      }

      // Emit full response (streaming can be added later)
      socket.emit('aiResponse', { responses, lore });
    } catch (error) {
      console.error('Error processing message:', error);
      socket.emit('aiResponse', { responses: [{ sender: 'System', content: 'Sorry, an error occurred.' }], lore: [] });
    }
  });

  socket.on('joinScene', (data: { sceneId: number }) => {
    try {
      const sid = data && data.sceneId;
      if (sid) {
        socket.join(`scene-${sid}`);
        console.log('Socket joined scene', sid);

        // Persist the selected scene for the campaign so reconnects/emit-only flows
        // also update the authoritative campaign state. Resolve scene -> arc -> campaign.
        try {
          const scene = SceneService.getById(Number(sid));
          if (scene && scene.arcId) {
            const arc = ArcService.getById(Number(scene.arcId));
            const campaignId = arc && arc.campaignId ? Number(arc.campaignId) : null;
            if (campaignId) {
              try {
                CampaignService.updateState(campaignId, { currentSceneId: Number(sid) });
                console.log(`Persisted currentSceneId=${sid} on campaign ${campaignId} via joinScene`);
                // Emit stateUpdated so connected clients refresh their campaign state
                try { io.emit('stateUpdated', { campaignId, state: CampaignService.getState(campaignId).dynamicFacts || {}, trackers: CampaignService.getState(campaignId).trackers || {} }); } catch (e) {}
              } catch (e) {
                console.warn('Failed to persist campaign state on joinScene', e);
              }
            }
          }
        } catch (e) {
          console.warn('Failed to resolve campaign for joinScene persistence', e);
        }
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
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}

// Debug endpoint for vector store queries
app.post('/api/debug/vector-query', async (req, res) => {
  try {
    const { query, worldId, characterId, characterName, includeMultiCharacter } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query is required and must be non-empty' });
    }

    // Initialize memory retriever
    const { getMemoryRetriever } = await import('./utils/memoryRetriever.js');
    const retriever = getMemoryRetriever();
    await retriever.initialize();

    // Query memories - pass both characterId and characterName
    const memories = await retriever.queryMemories(query, {
      worldId: worldId || undefined,
      characterId: characterId || undefined,
      characterName: characterName || undefined,
      topK: 20,
      minSimilarity: 0.1,
      includeMultiCharacter: includeMultiCharacter || false,
    });

    res.json({ memories });
  } catch (error) {
    console.error('[DEBUG] Vector query failed:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

// Revectorize entire scene endpoint
app.post('/api/debug/revectorize-scene', async (req, res) => {
  try {
    const { sceneId, clearExisting } = req.body;

    if (!sceneId || typeof sceneId !== 'number') {
      return res.status(400).json({ error: 'sceneId is required and must be a number' });
    }

    // Import and run VectorizationAgent
    const { default: VectorizationAgent } = await import('./agents/VectorizationAgent.js');
    const agent = new VectorizationAgent(configManager, env);

    // Revectorize the scene
    const result = await agent.revectorizeScene(sceneId, clearExisting !== false);

    res.json(result);
  } catch (error) {
    console.error('[DEBUG] Scene revectorization failed:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

// List all available scopes in vector store
app.get('/api/debug/vector-scopes', async (req, res) => {
  try {
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    
    if (!vectorStore) {
      return res.json({ scopes: [], message: 'Vector store not available' });
    }

    // Use getStats to get all scopes
    const stats = await (vectorStore as any).getStats();
    res.json({ 
      scopes: stats.scopes || [], 
      totalScopes: stats.totalScopes || 0,
      scopeNames: (stats.scopes || []).map((s: any) => s.scope)
    });
  } catch (error) {
    console.error('[DEBUG] Failed to get vector scopes:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

// Diagnostics: detailed vector store stats
app.get('/api/diagnostics/vector', async (req, res) => {
  try {
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    if (!vectorStore) return res.status(500).json({ error: 'Vector store not available' });

    const stats = await (vectorStore as any).getStats();
    // Return more descriptive structure for front-end consumption
    res.json({ totalScopes: stats.totalScopes, scopes: stats.scopes });
  } catch (error) {
    console.error('[DIAGNOSTICS] Failed to get vector diagnostics:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// List vector items matching metadata (with pagination)
app.post('/api/debug/vector-list', async (req, res) => {
  try {
    const { filter, scope, limit, offset } = req.body || {};
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    if (!vectorStore) return res.status(500).json({ error: 'Vector store not available' });

    if (typeof (vectorStore as any).listByMetadata !== 'function') {
      return res.status(500).json({ error: 'listByMetadata not implemented on vector store' });
    }

    const result = await (vectorStore as any).listByMetadata(filter || {}, scope, { limit: Number(limit || 50), offset: Number(offset || 0) });
    res.json(result);
  } catch (error) {
    console.error('[DEBUG] Failed to list vector items:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Safe delete by metadata: supports dryRun and confirm flags
app.post('/api/debug/vector-delete', async (req, res) => {
  try {
    const { filter, scope, dryRun, confirm, background, confirmThreshold } = req.body || {};
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    if (!vectorStore) return res.status(500).json({ error: 'Vector store not available' });

    // Get matching items first
    let list = { totalMatches: 0, items: [] as any[] };
    if (typeof (vectorStore as any).listByMetadata === 'function') {
      list = await (vectorStore as any).listByMetadata(filter || {}, scope, { limit: 1000000, offset: 0 });
    } else {
      // If no listing support, proceed with deleteByMetadata dryRun to determine count
      if (dryRun) {
        // call deleteByMetadata with dryRun to allow the store to compute matches (it logs but may not return them)
        await (vectorStore as any).deleteByMetadata(filter || {}, scope, { dryRun: true, confirm: !!confirm });
        return res.json({ message: 'Dry-run executed; check server logs for details' });
      }
    }

    if (dryRun) {
      return res.json({ dryRun: true, totalMatches: list.totalMatches, items: list.items });
    }

    // Safety threshold
    const threshold = Number(confirmThreshold || 50);
    if (list.totalMatches >= threshold && !confirm) {
      return res.status(400).json({ error: `Operation would delete ${list.totalMatches} items; set confirm=true to proceed or lower confirmThreshold.` });
    }

    // Proceed with deletion (may run in background if requested)
    await (vectorStore as any).deleteByMetadata(filter || {}, scope, { dryRun: false, confirm: !!confirm, background: !!background, confirmThreshold: threshold, actor: req.ip || 'api' });

    return res.json({ success: true, deletedApprox: list.totalMatches, scopes: Array.from(new Set(list.items.map((i: any) => i.scope))) });
  } catch (error) {
    console.error('[DEBUG] Failed to delete vector items by metadata:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Delete a single vector item by id within a scope
app.post('/api/debug/vector-item-delete', async (req, res) => {
  try {
    const { scope, id } = req.body || {};
    if (!scope || !id) return res.status(400).json({ error: 'scope and id are required' });
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    if (!vectorStore) return res.status(500).json({ error: 'Vector store not available' });

    if (typeof (vectorStore as any).deleteMemory !== 'function') {
      return res.status(500).json({ error: 'deleteMemory not implemented on vector store' });
    }

    await (vectorStore as any).deleteMemory(String(id), String(scope));
    res.json({ success: true, id, scope });
  } catch (error) {
    console.error('[DEBUG] Failed to delete vector item:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Update a single vector item by id within a scope (delete then re-add with new text/metadata)
app.post('/api/debug/vector-item-update', async (req, res) => {
  try {
    const { scope, id, text, metadata } = req.body || {};
    if (!scope || !id) return res.status(400).json({ error: 'scope and id are required' });
    const { VectorStoreFactory } = await import('./utils/vectorStoreFactory.js');
    const vectorStore = VectorStoreFactory.getVectorStore() || VectorStoreFactory.createVectorStore('vectra');
    if (!vectorStore) return res.status(500).json({ error: 'Vector store not available' });

    // Ensure listing is available to find existing item
    if (typeof (vectorStore as any).listByMetadata !== 'function') {
      return res.status(500).json({ error: 'listByMetadata not implemented on vector store' });
    }

    // Try to locate existing item
    const list = await (vectorStore as any).listByMetadata({}, scope, { limit: 1000000, offset: 0 });
    const existing = Array.isArray(list.items) ? list.items.find((it: any) => String(it.id) === String(id)) : null;
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const newText = typeof text === 'string' ? text : existing.text;
    const newMetadata = Object.assign({}, existing.metadata || {}, (metadata && typeof metadata === 'object') ? metadata : {});

    // Perform delete then add to update embedding and metadata
    if (typeof (vectorStore as any).deleteMemory !== 'function' || typeof (vectorStore as any).addMemory !== 'function') {
      return res.status(500).json({ error: 'update operations not implemented on vector store' });
    }

    await (vectorStore as any).deleteMemory(String(id), String(scope));
    await (vectorStore as any).addMemory(String(id), String(newText), newMetadata, String(scope));

    return res.json({ success: true, item: { scope, id, metadata: newMetadata, text: newText } });
  } catch (error) {
    console.error('[DEBUG] Failed to update vector item:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Internal inspection endpoints for jobs and audits
app.get('/internal/jobs', (req, res) => {
  try {
    const jobs = jobStore.listJobs();
    res.json({ jobs });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list jobs', detail: (e as any)?.message || String(e) });
  }
});

app.get('/internal/jobs/:id', (req, res) => {
  try {
    const job = jobStore.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get job', detail: (e as any)?.message || String(e) });
  }
});

app.get('/internal/audits', (req, res) => {
  try {
    const audits = auditLog.listAudits();
    res.json({ audits });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list audits', detail: (e as any)?.message || String(e) });
  }
});

export { app };

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
