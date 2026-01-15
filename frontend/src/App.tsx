import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';
import CharacterManager from './CharacterManager';
import LoreManager from './LoreManager';
import PersonaManager from './PersonaManager';
import WorldManager from './WorldManager';
import WorldEditor from './components/WorldEditor';
import CampaignEditor from './components/CampaignEditor';
import ArcEditor from './components/ArcEditor';
import SceneEditor from './components/SceneEditor';
import ConfirmModal from './components/ConfirmModal';
import Chat from './components/Chat';
import TopBar from './components/TopBar';
import Panel from './components/Panel';
import DebugVectorPanel from './components/DebugVectorPanel';
import { WorldStatus } from './components/WorldStatus';
import PersonaComponent from './components/PersonaComponent';
import ActiveCharacterComponent from './components/ActiveCharacterComponent';
import Spinner from './components/Spinner';
import { ToastProvider } from './components/Toast';
import ComfyConfigModal from './components/ComfyConfigModal';
import ConfigModal from './components/ConfigModal';
import { LLMConfigModal } from './components/LLMConfigModal';

interface Message {
  role: 'user' | 'ai';
  content: string;
  sender: string;
  id?: number;
  timestamp?: string;
  messageNumber?: number;
  tokenCount?: number;
}
// Ensure a single socket instance across HMR reloads
declare global { interface Window { __socket?: any } }
let socket = (window as any).__socket;
if (!socket) {
  socket = io('http://localhost:3001');
  (window as any).__socket = socket;
}
function App() {
  const selectedSceneRef = useRef<number | null>(null);
  const prevSelectedSceneRef = useRef<number | null>(null);
  const initialPersonaLoadedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const skipAutoScrollRef = useRef(false);
  // use module-level `socket` singleton

  // App state (many used throughout this file)
  const [messages, setMessages] = useState<Message[]>([]);
  const [personas, setPersonas] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [worlds, setWorlds] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [arcs, setArcs] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);
  const [selectedWorld, setSelectedWorld] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [selectedArc, setSelectedArc] = useState<number | null>(null);
  const [selectedScene, setSelectedScene] = useState<number | null>(null);
  const [sessionContext, setSessionContext] = useState<any | null>(null);
  const [activeCharacters, setActiveCharacters] = useState<string[]>([]);
  const [input, setInput] = useState<string>('');
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [deleteChoice, setDeleteChoice] = useState<any>({ open: false });
  const [regenPendingIds, setRegenPendingIds] = useState<number[]>([]);
  const [regenErrors, setRegenErrors] = useState<Record<number, string>>({});
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);
  const [imageModalPrompt, setImageModalPrompt] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<'chat'|'characters'|'lore'|'personas'|'comfyui'|'worlds'|'llm'|'debug'>('chat');
  const [modalType, setModalType] = useState<string | null>(null);
  const [modalInitial, setModalInitial] = useState<any>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showLLMConfigModal, setShowLLMConfigModal] = useState(false);
  const lastNextClickRef = useRef<Record<number, number>>({});

  // Panel state for new UI
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [lorebooksVersion, setLorebooksVersion] = useState(0);
  // Debug config fetched from backend; use to drive client debug flags
  const [debugConfig, setDebugConfig] = useState<any>({});
  const debugRef = useRef<any>({});

  useEffect(() => {
    fetchPersonas();
    fetchCharacters();
    fetchWorlds();
    // Fetch debug config from server so client logging behavior mirrors backend config
    (async () => {
      try {
        const r = await fetch('/api/debug-config');
        if (r.ok) {
          const json = await r.json();
          setDebugConfig(json);
          debugRef.current = json || {};
        }
      } catch (e) { /* ignore */ }
    })();

    // Socket listeners for session events
    socket.on('connect', () => {
      try { if (debugRef.current && debugRef.current.features && debugRef.current.features.socketAckLogs) console.info('socket connected', socket.id); } catch (e) {}
    });
    socket.on('sceneAdvanced', (data: any) => {
        if (data && data.session) {
        setSessionContext(data.session);
      }
      if (data && data.sceneId) {
        loadMessages(data.sceneId);
        // update selected scene if different
        setSelectedScene(data.sceneId);
      }
    });

    socket.on('stateUpdated', (data: any) => {
      // merge into sessionContext.worldState or set trackers
      setSessionContext((prev: any) => ({ ...prev, scene: { ...prev?.scene, characterStates: data.characterStates || prev?.scene?.characterStates }, worldState: data.state || prev?.worldState, trackers: data.trackers || prev?.trackers }));
    });

    socket.on('characterOverrideChanged', (data: any) => {
      // refresh characters and merged previews
      fetchCharacters();
    });

    socket.on('messageUpdated', (data: { messageId: number; newContent: string }) => {
      let found = false;
      setMessages(prev => {
        const next = prev.map(m => {
          if (m.id === data.messageId) {
            found = true;
            return { ...m, content: data.newContent };
          }
          return m;
        });
        return next;
      });
      // clear regen pending and errors for this message
      setRegenPendingIds(prev => prev.filter(id => id !== data.messageId));
      setRegenErrors(prev => { const n = { ...prev }; delete n[data.messageId]; return n; });

      // If we didn't find the message locally, or the updated content contains an image,
      // reload authoritative messages for the scene so DB-indexed updates are reflected.
      try {
        const sid = selectedSceneRef.current;
        if (!found || (data.newContent && typeof data.newContent === 'string' && data.newContent.includes('!['))) {
          if (sid) loadMessages(sid).catch(() => {});
        }
      } catch (e) {
        console.warn('Failed to reload messages after messageUpdated', e);
      }
    });
    socket.on('imageStored', (data: { messageId: number; sceneId: number; originalUrl: string; localUrl: string; size?: number; width?: number; height?: number }) => {
      const { messageId, sceneId, originalUrl, localUrl } = data as any;
      if (sceneId !== selectedSceneRef.current) return;

      // The authoritative message content (and metadata) lives on the server. Rather than
      // attempting fragile local patches of alt JSON, reload the messages for this scene so
      // the UI receives the canonical updated content immediately.
      try {
        if (selectedSceneRef.current) {
          loadMessages(selectedSceneRef.current).catch(() => {});
        }
      } catch (e) { /* noop */ }

      // Preload the stored image so UI swaps instantly and cached
      try {
        const img = new Image();
        img.onload = () => { /* noop */ };
        img.onerror = () => { /* noop */ };
        img.src = localUrl;
      } catch (e) { /* noop */ }
    });
    socket.on('regenFailed', (data: { messageId: number; error?: string }) => {
      setRegenPendingIds(prev => prev.filter(id => id !== data.messageId));
      setRegenErrors(prev => ({ ...prev, [data.messageId]: data.error || 'Regeneration failed' }));
    });
    socket.on('regenStarted', (data: { messageId: number }) => {
      setRegenPendingIds(prev => Array.from(new Set([...(prev||[]), data.messageId])));
      setRegenErrors(prev => { const n = { ...prev }; delete n[data.messageId]; return n; });
    });
    socket.on('sceneUpdated', (data: { sceneId: number; summary?: string; summaryTokenCount?: number }) => {
      // Refresh worlds/campaigns/scenes data to reflect updated summary
      loadWorlds().catch(() => {});
    });

    return () => {
      socket.off('sceneAdvanced');
      socket.off('stateUpdated');
      socket.off('characterOverrideChanged');
      socket.off('messageUpdated');
      socket.off('regenFailed');
      socket.off('regenStarted');
      socket.off('imageStored');
      socket.off('sceneUpdated');
    };
  }, []);

  // Load persisted persona setting once on startup
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/persona');
        if (res.ok) {
          const data = await res.json();
          if (data && data.persona !== null && data.persona !== undefined) {
            setSelectedPersona(data.persona);
          }
        }
      } catch (e) {
        console.warn('Failed to load persona setting', e);
      } finally {
        initialPersonaLoadedRef.current = true;
      }
    })();
  }, []);

  // Persist persona selection when it changes (skip the initial load)
  useEffect(() => {
    if (!initialPersonaLoadedRef.current) return;
    (async () => {
      try {
        await fetch('/api/settings/persona', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: selectedPersona }) });
      } catch (e) {
        console.warn('Failed to persist persona selection', e);
      }
    })();
  }, [selectedPersona]);

  // Keep a ref of current selectedScene for socket handlers
  useEffect(() => {
    selectedSceneRef.current = selectedScene;
  }, [selectedScene]);

  const fetchPersonas = async () => {
    const res = await fetch('/api/personas');
    const data = await res.json();
    setPersonas(data);
    if (data.length > 0 && !data.find((p: any) => p.name === selectedPersona)) {
      setSelectedPersona(data[0].name);
    }
  };

  const refreshSessionContext = async () => {
    if (!selectedScene) return;
    try {
      const res = await fetch(`/api/scenes/${selectedScene}/session`);
      if (res.ok) {
        const session = await res.json();
        console.log('Refreshed session context:', session);
        setSessionContext(session);
        const ids = (session.activeCharacters || []).map((c: any) => c.id).filter(Boolean);
        setActiveCharacters(ids);
      }
    } catch (e) {
      console.warn('Failed to refresh session context', e);
    }
  };

  // Ensure switching scenes always loads the correct messages and session
  useEffect(() => {
    if (!selectedScene) {
      setMessages([]);
      setSessionContext(null);
      return;
    }

    // selectedScene effect

    // Load messages and session for the selected scene
    loadMessages(selectedScene);
    (async () => {
      try {
        const res = await fetch(`/api/scenes/${selectedScene}/session`);
        if (res.ok) {
          const session = await res.json();
          console.log('Raw session response:', session);
          setSessionContext(session);
          const ids = (session.activeCharacters || []).map((c: any) => c.id).filter(Boolean);
          console.log('Loaded active characters from session:', ids);
          setActiveCharacters(ids);
        } else {
          console.log('Failed to load session for scene:', selectedScene, res.status);
        }
      } catch (e) {
        console.warn('Failed to refresh session on scene change', selectedScene, e);
      }
    })();

    // Join the socket room for this scene and leave previous. Wait for socket connection if needed.
    try {
      const prev = prevSelectedSceneRef.current;
      if (prev && prev !== selectedScene) {
        console.debug('Emitting leaveScene', { sceneId: prev, socketConnected: socket?.connected });
        if (socket && socket.connected) {
          socket.emit('leaveScene', { sceneId: prev });
        } else if (socket && socket.once) {
          socket.once('connect', () => socket.emit('leaveScene', { sceneId: prev }));
        }
      }
      if (selectedScene) {
        console.debug('Emitting joinScene', { sceneId: selectedScene, socketConnected: socket?.connected });
        if (socket && socket.connected) {
          socket.emit('joinScene', { sceneId: selectedScene });
        } else if (socket && socket.once) {
          socket.once('connect', () => socket.emit('joinScene', { sceneId: selectedScene }));
        }
      }
      prevSelectedSceneRef.current = selectedScene;
    } catch (e) {
      console.warn('Failed to join/leave scene socket room', e);
    }
  }, [selectedScene]);

  const fetchWorlds = async () => {
    try {
      const res = await fetch('/api/worlds');
      if (!res.ok) {
        console.error('Failed to fetch worlds:', res.status, res.statusText);
        setWorlds([]);
        return;
      }
      const text = await res.text();
      if (!text) {
        console.warn('Empty response for worlds');
        setWorlds([]);
        return;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON for worlds:', text, e);
        setWorlds([]);
        return;
      }
      setWorlds(data);
      if (data.length > 0 && selectedWorld === null) {
        setSelectedWorld(data[0].id);
        fetchCampaigns(data[0].id);
      }
    } catch (e) {
      console.error('Error fetching worlds:', e);
      setWorlds([]);
    }
  };

  const fetchCampaigns = async (worldId: number) => {
    const res = await fetch(`/api/worlds/${worldId}/campaigns`);
    if (!res.ok) {
      console.error('Failed to fetch campaigns:', res.status, res.statusText);
      setCampaigns([]);
      return;
    }
    const text = await res.text();
    if (!text) {
      console.warn('Empty response for campaigns');
      setCampaigns([]);
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse JSON for campaigns:', text, e);
      setCampaigns([]);
      return;
    }
    setCampaigns(data);
    if (data.length > 0) {
      setSelectedCampaign(data[0].id);
      // Load campaign state to get the persisted selected scene
      try {
        const stateRes = await fetch(`/api/campaigns/${data[0].id}/state`);
        if (stateRes.ok) {
          const stateText = await stateRes.text();
          if (!stateText) {
            // No state
            fetchArcs(data[0].id);
          } else {
            try {
              const state = JSON.parse(stateText);
              if (state && state.currentSceneId) {
                setSelectedScene(state.currentSceneId);
                selectedSceneRef.current = state.currentSceneId;
                await loadMessages(state.currentSceneId);
              } else {
                // No persisted scene, load arcs normally
                fetchArcs(data[0].id);
              }
            } catch (e) {
              console.warn('Failed to parse campaign state JSON', e);
              fetchArcs(data[0].id);
            }
          }
        } else {
          // No state, load arcs normally
          fetchArcs(data[0].id);
        }
      } catch (e) {
        console.warn('Failed to load campaign state', e);
        fetchArcs(data[0].id);
      }
    } else {
      setSelectedCampaign(null);
      setArcs([]);
      setSelectedArc(null);
      setScenes([]);
      setSelectedScene(null);
      setSessionContext(null);
      setActiveCharacters([]);
    }
  };

  const fetchArcs = async (campaignId: number) => {
    const res = await fetch(`/api/campaigns/${campaignId}/arcs`);
    const data = await res.json();
    setArcs(data);
    if (data.length > 0) {
      // Only auto-select an arc if none is currently selected or the current one is not in the new list
      const ids = data.map((d: any) => d.id);
      if (!selectedArc || !ids.includes(selectedArc)) {
        setSelectedArc(data[0].id);
        fetchScenes(data[0].id);
      }
    } else {
      setSelectedArc(null);
      setScenes([]);
      setSelectedScene(null);
      setSessionContext(null);
      setActiveCharacters([]);
    }
  };

  const fetchScenes = async (arcId: number) => {
    const res = await fetch(`/api/arcs/${arcId}/scenes`);
    const data = await res.json();
    setScenes(data);
    if (data.length > 0) {
      const ids = data.map((d: any) => d.id);
      // Only auto-select a scene if none selected or the current selection is not present
      if (!selectedScene || !ids.includes(selectedScene)) {
        setSelectedScene(data[0].id);
        loadMessages(data[0].id);
      } else {
        // ensure messages are loaded for the currently selected scene
        loadMessages(selectedScene);
      }
    } else {
      setSelectedScene(null);
      setSessionContext(null);
      setActiveCharacters([]);
      setMessages([]);
      setInput('');
    }
  };

  const handleSceneChange = async (sceneId: number) => {
    setSelectedScene(sceneId);
    selectedSceneRef.current = sceneId;
    await loadMessages(sceneId);
    
    // Persist the selected scene in the campaign state
    if (selectedCampaign) {
      try {
        await fetch(`/api/campaigns/${selectedCampaign}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentSceneId: sceneId })
        });
      } catch (e) {
        console.warn('Failed to persist selected scene', e);
      }
    }
  };

  const loadMessages = async (sceneId: number) => {
    console.debug('loadMessages called for scene', sceneId);
    // mark this request
    const reqId = ++loadRequestIdRef.current;
    try {
      const res = await fetch(`/api/scenes/${sceneId}/messages?limit=100`);
      const data = await res.json();
      // transform to Message[] with role heuristics
      const msgs = data.reverse().map((m: any) => ({
        role: m.sender && m.sender.startsWith && m.sender.startsWith('user:') ? 'user' : 'ai',
        sender: m.sender,
        content: m.message,
        id: m.id,
        timestamp: m.timestamp,
        messageNumber: m.messageNumber,
        tokenCount: m.tokenCount
      }));
      // Only apply if this request is the latest and the selected scene hasn't changed
      if (loadRequestIdRef.current === reqId && selectedSceneRef.current === sceneId) {
        setMessages(msgs);
      } else {
        console.debug('Discarding messages for scene', sceneId, 'reqId', reqId, 'current', loadRequestIdRef.current, 'selectedScene', selectedSceneRef.current);
      }
    } catch (e) {
      console.warn('Failed to load messages for scene', sceneId, e);
    }
  };

  const fetchCharacters = async () => {
    try {
      const res = await fetch('/api/characters');
      if (!res.ok) {
        console.error('Failed to fetch characters:', res.status, res.statusText);
        setCharacters([]);
        return;
      }
      const data = await res.json();
      setCharacters(data.map((c: any) => ({ ...c, avatarUrl: c.avatar })));
    } catch (e) {
      console.error('Error fetching characters:', e);
      setCharacters([]);
    }
  };

  const updateActiveCharacters = async (newActive: string[]) => {
    console.log('Updating active characters to:', newActive);
    setActiveCharacters(newActive);
    // Persist to scene if one is selected
    if (selectedScene) {
      console.log('Persisting to scene:', selectedScene);
      try {
        const response = await fetch(`/api/scenes/${selectedScene}/active-characters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeCharacters: newActive })
        });
        if (response.ok) {
          console.log('Successfully persisted active characters to scene');
        } else {
          console.error('Failed to persist active characters:', response.status, response.statusText);
        }
      } catch (e) {
        console.warn('Failed to persist active characters to scene', e);
      }
    } else {
      console.log('No scene selected, active characters not persisted');
    }
  };

  useEffect(() => {
    socket.on('characterResponse', (data: { sender: string; content: string }) => {
      // Add character response immediately as it streams in
      const newMsg: Message = { role: 'ai', sender: data.sender, content: data.content };
      setMessages(prev => [...prev, newMsg]);
      // End streaming after first response arrives
      setIsStreaming(false);
    });

    socket.on('aiResponse', (data: { responses: { sender: string; content: string }[], lore: string[] }) => {
      // For backwards compatibility, still handle batch responses
      const newMsgs: Message[] = data.responses.map(res => ({ role: 'ai', sender: res.sender, content: res.content }));
      setMessages(prev => [...prev, ...newMsgs]);
      // Also refresh authoritative messages from server for the current scene
      const sid = selectedSceneRef.current;
      if (sid) {
        loadMessages(sid).catch(() => {});
      }
      setIsStreaming(false);
    });

    socket.on('activeCharactersUpdated', (data: { sceneId: number; activeCharacters: string[] }) => {
      if (data.sceneId === selectedScene) {
        setActiveCharacters(data.activeCharacters);
      }
    });

    return () => {
      socket.off('characterResponse');
      socket.off('aiResponse');
      socket.off('activeCharactersUpdated');
    };
  }, [selectedScene]);

  const sendMessage = () => {
    if (!selectedScene) return; // require a scene to send
    if (input.trim()) {
      socket.emit('userMessage', { input, persona: selectedPersona, activeCharacters, sceneId: selectedScene });
      setIsStreaming(true);
      const newMessage: Message = { role: 'user', content: input, sender: selectedPersona || 'user' };
      setMessages(prev => [...prev, newMessage]);
      setInput('');
    }
  };

  // When no scene selected, clear messages and disable input
  useEffect(() => {
    if (!selectedScene) {
      setMessages([]);
      setInput('');
    }
  }, [selectedScene]);

  const updateMessageContent = async (id: number, newContent: string) => {
    // Optimistic local update so UI responds immediately to prev/next
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content: newContent } : m));
    try {
      const res = await fetch(`/api/messages/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: newContent }) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('updateMessageContent: server error', { id, status: res.status, text });
      }
      // After successful PUT, fetch the authoritative message for this id and log it for debugging
      try {
        if (selectedScene) {
          const res2 = await fetch(`/api/scenes/${selectedScene}/messages?limit=100`);
          if (res2.ok) {
            const list = await res2.json();
            const found = list.find((m: any) => m.id === id);
            // preview available from server
          }
          await loadMessages(selectedScene);
        }
      } catch (e) { console.warn('updateMessageContent: fetch-after-put failed', e); }
    } catch (e) {
      console.warn('Failed to update message', e);
      // On failure, reload authoritative messages to ensure consistency
      if (selectedScene) await loadMessages(selectedScene).catch(() => {});
    }
  };

  const highlightInlineQuotes = (s: string) => {
    try {
      return s.replace(/\"([^\\\"]+)\"/g, '<span class="inline-quote">"$1"</span>');
    } catch (e) {
      return s;
    }
  };

  const CustomImage = ({ src, alt, messageId, onUpdateMessage, selectedScene }: { src: string; alt: string; messageId?: number; onUpdateMessage: (id: number, content: string) => void; selectedScene: number | null }) => {
    let data: any;
    // If this message isn't persisted yet (no messageId), prefer the provided `src`
    // and avoid expensive/deep parsing which causes duplicate counts during optimistic updates.
    if (!messageId) {
      data = { prompt: alt, urls: [src], current: 0 };
    } else {
      try {
        data = JSON.parse(alt);
      } catch {
        data = { prompt: alt, urls: [src], current: 0 };
      }
    }
      // Robustly normalize nested/stringified JSON in `alt`.
    const tryParse = (s: any) => {
      if (typeof s !== 'string') return s;
      const str = s.trim();
      if (!(str.startsWith('{') || str.startsWith('[') || (str.startsWith('"{') && str.endsWith('"')))) return s;
      try { return JSON.parse(s); } catch { try { return JSON.parse(str.replace(/^"|"$/g, '')); } catch { return s; } }
    };

    const deepParseObject = (obj: any, maxDepth = 6) => {
      let changed = true;
      let depth = 0;
      const cur = obj;
      while (changed && depth < maxDepth) {
        changed = false;
        const walk = (o: any) => {
          if (!o || typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if (typeof v === 'string') {
              const parsed = tryParse(v);
              if (parsed !== v) { o[k] = parsed; changed = true; }
            } else if (typeof v === 'object' && v !== null) {
              walk(v);
            }
          }
        };
        walk(cur);
        depth++;
      }
      return cur;
    };

    const findFirst = (obj: any, keyName: string): any => {
      if (!obj || typeof obj !== 'object') return undefined;
      if (Object.prototype.hasOwnProperty.call(obj, keyName)) return obj[keyName];
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          const f = findFirst(v, keyName);
          if (f !== undefined) return f;
        }
      }
      return undefined;
    };

    try {
      data = deepParseObject(data, 8);
      // If urls/prompt/current are nested deeper, extract them
      try {
        if (!Array.isArray(data.urls)) {
          const nestedUrls = findFirst(data, 'urls');
          if (Array.isArray(nestedUrls)) data.urls = nestedUrls;
        }
        if (typeof data.prompt !== 'string') {
          const nestedPrompt = findFirst(data, 'prompt');
          if (typeof nestedPrompt === 'string') data.prompt = nestedPrompt;
          else if (nestedPrompt && typeof nestedPrompt === 'object' && typeof nestedPrompt.prompt === 'string') data.prompt = nestedPrompt.prompt;
        }
        if (typeof data.current !== 'number') {
          const nestedCurrent = findFirst(data, 'current');
          const parsedCur = typeof nestedCurrent === 'number' ? nestedCurrent : parseInt(String(nestedCurrent || '0'), 10);
          if (!Number.isNaN(parsedCur)) data.current = parsedCur;
        }
      } catch (e) { /* noop */ }
    } catch (e) {
      // noop
    }

    // Coerce `urls` to an array if it's a JSON string or other type
    try {
      let urlsArr: any = data.urls;
      if (typeof urlsArr === 'string') {
        try { urlsArr = JSON.parse(urlsArr); } catch { urlsArr = [urlsArr]; }
      }
      if (!Array.isArray(urlsArr)) urlsArr = [urlsArr == null ? src : String(urlsArr)];
      urlsArr = urlsArr.map((u: any) => String(u));
      data.urls = urlsArr;
    } catch (e) {
      data.urls = [src];
    }

    // Ensure `current` is a valid integer index
    try {
      let cur = typeof data.current === 'number' ? data.current : parseInt(String(data.current || '0'), 10);
      if (Number.isNaN(cur)) cur = 0;
      if (cur < 0) cur = 0;
      if (cur >= (data.urls || []).length) cur = (data.urls || []).length - 1;
      data.current = cur;
    } catch (e) {
      data.current = 0;
    }

    // Fallback: if urls appears to be a single entry but there are multiple URLs embedded
    // somewhere in the metadata (or in the nested prompt string), extract them via regex.
    try {
      const urlsNow = Array.isArray(data.urls) ? data.urls : [];
      if ((urlsNow.length <= 1)) {
        const serialized = JSON.stringify(data || '') || '';
        const urlRe = /https?:\/\/[^\s"')\]]+/g;
        const matches = Array.from(new Set(Array.from(serialized.matchAll(urlRe)).map(m => m[0])));
        if (matches.length > 1) {
          data.urls = matches;
          // clamp current
          if (typeof data.current !== 'number' || data.current < 0 || data.current >= matches.length) data.current = Math.max(0, Math.min(matches.length - 1, Number(data.current) || 0));
        }
      }
    } catch (e) {
      // noop
    }

    let prompt: any = data.prompt;
    if (typeof prompt !== 'string') {
      if (prompt && typeof prompt === 'object') {
        if (typeof prompt.prompt === 'string') prompt = prompt.prompt;
        else prompt = JSON.stringify(prompt || '');
      } else {
        prompt = String(prompt || '');
      }
    }
    const urls = data.urls;
    const current = data.current;
    // normalized image metadata
    // Normalize URLs: unescape backslashes, strip surrounding quotes, trim whitespace
    const normalizeUrl = (u: any) => {
      try {
        let s = String(u || '');
        s = s.replace(/\\\\/g, '\\'); // replace double-escaped backslashes
        s = s.replace(/\\+$/g, ''); // strip trailing backslashes
        s = s.replace(/^"|"$/g, ''); // strip surrounding quotes
        return s.trim();
      } catch (e) { return String(u || '').trim(); }
    };
    const normalizedUrls = Array.from(new Set((Array.isArray(urls) ? urls : [urls || src]).map(normalizeUrl).filter(Boolean)));
    // Ensure we always include `src` as a fallback but avoid duplicates
    if (!normalizedUrls.includes(src)) normalizedUrls.unshift(src);
    const [localUrls, setLocalUrls] = useState<string[]>(normalizedUrls.length ? normalizedUrls : [src]);
    const failedUrlsRef = useRef<Set<string>>(new Set());

    // When `alt` changes for a persisted message, recompute normalized URLs and update state.
    useEffect(() => {
      if (!messageId) return;
      try {
        const recomputed = Array.from(new Set((Array.isArray(data.urls) ? data.urls : [data.urls || src]).map(normalizeUrl).filter(Boolean)));
        if (!recomputed.includes(src)) recomputed.unshift(src);
        // Only update if different to avoid re-renders
        if (JSON.stringify(recomputed) !== JSON.stringify(localUrls)) {
          setLocalUrls(recomputed.length ? recomputed as string[] : [src]);
          // reset failed set because URLs changed
          failedUrlsRef.current = new Set();
        }
      } catch (e) {
        // noop
      }
    }, [alt]);
    const [localCurrent, setLocalCurrent] = useState<number>(current || 0);

    // Helper to find next available index (forward) that isn't marked failed
    const findNextAvailable = (start: number) => {
      const n = localUrls.length;
      if (n === 0) return -1;
      for (let i = start; i < n; i++) if (!failedUrlsRef.current.has(localUrls[i])) return i;
      for (let i = 0; i < start; i++) if (!failedUrlsRef.current.has(localUrls[i])) return i;
      return -1;
    };
    const findPrevAvailable = (start: number) => {
      const n = localUrls.length;
      if (n === 0) return -1;
      for (let i = start; i >= 0; i--) if (!failedUrlsRef.current.has(localUrls[i])) return i;
      for (let i = n - 1; i > start; i--) if (!failedUrlsRef.current.has(localUrls[i])) return i;
      return -1;
    };

    let currentUrl = src;
    const availableIndex = (localUrls && localUrls.length) ? (failedUrlsRef.current.has(localUrls[localCurrent]) ? findNextAvailable(localCurrent) : localCurrent) : -1;
    if (availableIndex >= 0) currentUrl = localUrls[availableIndex];
    // Keep localCurrent synchronized to an available index so navigation logic is consistent
    useEffect(() => {
      try {
        const avail = (localUrls && localUrls.length) ? (failedUrlsRef.current.has(localUrls[localCurrent]) ? findNextAvailable(localCurrent) : localCurrent) : -1;
        if (avail >= 0 && avail !== localCurrent) setLocalCurrent(avail);
      } catch (e) { /* noop */ }
    }, [localUrls]);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

    const updateImgSize = () => {
      const el = imgRef.current;
      if (el) {
        setImgSize({ w: el.clientWidth, h: el.clientHeight });
      }
    };

    useEffect(() => {
      updateImgSize();
      const ro = (window as any).ResizeObserver ? new (window as any).ResizeObserver(() => updateImgSize()) : null;
      if (ro && imgRef.current) ro.observe(imgRef.current);
      window.addEventListener('resize', updateImgSize);
      return () => {
        if (ro && imgRef.current) try { ro.unobserve(imgRef.current); } catch (e) {}
        window.removeEventListener('resize', updateImgSize);
      };
    }, [currentUrl]);

    useEffect(() => { setLocalCurrent(current || 0); }, [current]);

    // If a URL fails to load, mark it failed and advance to the next available index.
    const handleImgError = (failedUrl: string) => {
      // Normalize the failedUrl key same as we normalized stored URLs
      const key = normalizeUrl(failedUrl);
      console.warn('Image failed to load, marking failed for UI:', key);
      failedUrlsRef.current.add(key);
      // If the current displayed URL failed, advance to next available
      if (normalizeUrl(localUrls[localCurrent] || '') === key) {
        const nextIdx = findNextAvailable(localCurrent + 1);
        if (nextIdx >= 0) {
          setLocalCurrent(nextIdx);
        } else {
          // no available images -> show placeholder by setting current to 0 and leaving failed set
          setLocalCurrent(0);
        }
      }
    };

    const handleDelete = () => {
      if (messageId == null) return;
      skipAutoScrollRef.current = true;
      setDeleteChoice({ open: true, messageId, data, onUpdate: onUpdateMessage, prompt });
    };

    const handlePrev = async () => {
      if (messageId == null) return;
      skipAutoScrollRef.current = true;
      try {
        const r = await fetch(`/api/messages/${messageId}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prev' }) });
        const j = await r.json().catch(() => null);
        if (r.ok && j) {
          if (j.newContent && onUpdateMessage) onUpdateMessage(messageId, j.newContent);
          if (j.metadata && Array.isArray(j.metadata.urls)) setLocalUrls(j.metadata.urls.map(String));
          if (j.metadata && typeof j.metadata.current === 'number') setLocalCurrent(j.metadata.current);
        }
      } catch (e) { console.warn('handlePrev failed', e); }
    };

    const handleNext = async () => {
      // handleNext invoked
      try { console.info('handleNext invoked', { messageId, localCurrent, localUrlsLength: localUrls.length, scene: selectedScene }); } catch (e) {}
      // Prevent duplicate rapid clicks for the same message
      try {
        const now = Date.now();
        const last = lastNextClickRef.current[messageId || -1] || 0;
        if (now - last < 700) {
          try { console.info('handleNext debounced', { messageId }); } catch (e) {}
          return;
        }
        lastNextClickRef.current[messageId || -1] = now;
      } catch (e) {}
      // If a regen is already pending for this message, ignore
      if (messageId != null && regenPendingIds.includes(messageId)) return;
      if (messageId == null) return;
      const nextIdx = findNextAvailable(localCurrent + 1);
      // computed nextIdx
      // If nextIdx resolves to the same URL as currently shown (wrap-around or single-item list),
      // treat it as "no next" and fallthrough to regen.
      const nextUrl = (nextIdx >= 0 && localUrls[nextIdx]) ? normalizeUrl(localUrls[nextIdx]) : null;
      const curUrlNorm = normalizeUrl(currentUrl || '');
      const visible = localUrls.filter(u => !failedUrlsRef.current.has(u));
      if (nextIdx >= 0 && nextIdx !== localCurrent && nextUrl && curUrlNorm !== nextUrl && visible.length > 1) {
        // delegate to server to advance index
        try {
          const r = await fetch(`/api/messages/${messageId}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'next' }) });
          const j = await r.json().catch(() => null);
          if (r.ok && j) {
            if (j.newContent && onUpdateMessage) onUpdateMessage(messageId, j.newContent);
            if (j.metadata && Array.isArray(j.metadata.urls)) setLocalUrls(j.metadata.urls.map(String));
            if (j.metadata && typeof j.metadata.current === 'number') setLocalCurrent(j.metadata.current);
            return;
          }
        } catch (e) { console.warn('server next failed', e); }
        // fallback to client-side update if server call failed
        skipAutoScrollRef.current = true;
        setLocalCurrent(nextIdx);
        const newData = (() => {
          const flat: any = {};
          let p: any = data;
          try {
            while (p && typeof p === 'object' && 'prompt' in p) p = p.prompt;
            let attempts = 0;
            while (typeof p === 'string' && attempts < 8) {
              const parsed = tryParse(p);
              if (parsed === p) break;
              p = parsed;
              attempts++;
            }
          } catch (e) { /* noop */ }
          flat.prompt = (typeof p === 'string') ? p : String(p || '');
          flat.urls = Array.isArray(localUrls) ? localUrls : [String(localUrls || src)];
          flat.current = Math.max(0, Math.min(nextIdx, (flat.urls || []).length - 1));
          return flat;
        })();
        // calling onUpdateMessage for next (client fallback)
        onUpdateMessage(messageId, `![${JSON.stringify(newData)}](${newData.urls[newData.current]})`);
        return;
      }
      // No available next image -> trigger regen
      skipAutoScrollRef.current = true;
      setRegenPendingIds(prev => Array.from(new Set([...(prev||[]), messageId])));
      setRegenErrors(prev => { const n = { ...prev }; delete n[messageId]; return n; });
      try { console.debug('Emitting regenImage (raw prompt)', { messageId, prompt, sceneId: selectedScene }); } catch (e) {}
      if (!selectedScene) {
        console.warn('Cannot regen image: no selectedScene');
      } else {
        // Build a cleaned prompt: unwrap nested prompt objects/strings to the innermost prompt string
        let cleanPrompt: any = data;
        try {
          // if data is nested, walk down
          while (cleanPrompt && typeof cleanPrompt === 'object' && 'prompt' in cleanPrompt) cleanPrompt = cleanPrompt.prompt;
          // repeatedly try to parse if it's a stringified JSON
          let attempts = 0;
          while (typeof cleanPrompt === 'string' && attempts < 8) {
            const parsed = tryParse(cleanPrompt);
            if (parsed === cleanPrompt) break;
            cleanPrompt = parsed;
            attempts++;
          }
        } catch (e) { /* noop */ }
        if (typeof cleanPrompt !== 'string') cleanPrompt = String(cleanPrompt || prompt || '');
        // final trim
        cleanPrompt = cleanPrompt.trim();
        try {
          // small debug trace to help diagnose missing emits
           
          console.info('Emitting regenImage', { messageId, promptLength: (cleanPrompt || '').length, socketConnected: Boolean(socket && socket.connected), sceneId: selectedScene });
        } catch (e) {}
        // Ask server to regenerate (server will handle calling VisualAgent and storing result)
        try {
          const r = await fetch(`/api/messages/${messageId}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regen', prompt: cleanPrompt }) });
          const j = await r.json().catch(() => null);
          if (r.ok && j) {
            if (j.newContent && onUpdateMessage) onUpdateMessage(messageId, j.newContent);
            if (j.metadata && Array.isArray(j.metadata.urls)) setLocalUrls(j.metadata.urls.map(String));
            if (j.metadata && typeof j.metadata.current === 'number') setLocalCurrent(j.metadata.current);
          } else {
            console.warn('Regenerate failed', j);
          }
        } catch (e) { console.warn('Regenerate request failed', e); }
      }
    };

    return (
      <span className="image-card" style={{ display: 'inline-block', lineHeight: 0, position: 'relative', ...(imgSize ? ({ ['--img-w' as any]: `${imgSize.w}px`, ['--img-h' as any]: `${imgSize.h}px` }) : {}) } as React.CSSProperties}>
        <img ref={imgRef} className="image-card-img" src={currentUrl} alt={prompt} onError={() => handleImgError(currentUrl)} onClick={() => { setImageModalUrl(currentUrl); setImageModalPrompt(prompt); }} style={{ display: 'block', cursor: 'pointer' }} />

        <span className="image-overlay" aria-hidden>
          <span style={{ width: '100%', pointerEvents: 'none' }} />
        </span>

        <span className="image-controls">
          <span className="controls-left">
            {(() => {
              const visible = localUrls.filter(u => !failedUrlsRef.current.has(u));
              const visibleIdx = visible.indexOf(currentUrl);
              return (visible.length > 1 && visibleIdx > 0) ? (
                <button className="icon small" onClick={handlePrev} disabled={regenPendingIds.includes(messageId || -1)} title="Previous">⬅️</button>
              ) : null;
            })()}
          </span>
          <span className="controls-center">
              {
                (() => {
                  const visible = localUrls.filter(u => !failedUrlsRef.current.has(u));
                  const visibleIdx = visible.indexOf(currentUrl);
                  const displayIndex = visibleIdx >= 0 ? (visibleIdx + 1) : (visible.length > 0 ? 1 : 0);
                  return <span className="counter">{visible.length > 0 ? `${displayIndex}/${visible.length}` : '0/0'}</span>;
                })()
              }
          </span>
          <span className="controls-right">
            <button className="icon small" onClick={() => { setImageModalUrl(currentUrl); setImageModalPrompt(prompt); }} title="View larger">🔍</button>
            <button className="icon small" onClick={() => { navigator.clipboard?.writeText(currentUrl).catch(()=>{}); }} title="Copy URL">📋</button>
            <button className="icon small" onClick={handleDelete} disabled={regenPendingIds.includes(messageId || -1)} title="Delete">🗑️</button>
            <button className="icon small regen" onClick={handleNext} disabled={regenPendingIds.includes(messageId || -1)} title={(() => { const next = findNextAvailable(localCurrent+1); return next >=0 && next !== localCurrent ? 'Next' : 'Regenerate'; })()}>{regenPendingIds.includes(messageId || -1) ? <span aria-hidden>⏳</span> : '➡️'}</button>
          </span>
        </span>

        <span className="hidden-prompt" style={{ position: 'absolute', left: 0, bottom: '-1.5em', width: '100%', textAlign: 'center', color: 'transparent', userSelect: 'text', pointerEvents: 'none' }}>{prompt}</span>

        {messageId != null && regenPendingIds.includes(messageId) && (
          <span role="status" aria-live="polite" className="regen-overlay" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', zIndex: 25, borderRadius: 6 }}>
            <Spinner size={48} title="Regenerating image" />
          </span>
        )}
      </span>
    );
  };


  const closeModal = () => { setModalType(null); setModalInitial(null); };

  const saveWorld = async (payload: any) => {
    if (modalType === 'world-new') {
      const res = await fetch('/api/worlds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const created = await res.json();
      await fetchWorlds(); setSelectedWorld(created.id);
    } else if (modalType === 'world-edit' && selectedWorld) {
      await fetch(`/api/worlds/${selectedWorld}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await fetchWorlds();
    }
    closeModal();
  };

  const saveCampaign = async (payload: any) => {
    if (!selectedWorld) return alert('Select a world first');
    if (modalType === 'campaign-new') {
      const res = await fetch(`/api/worlds/${selectedWorld}/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const created = await res.json(); await fetchCampaigns(selectedWorld); setSelectedCampaign(created.id);
    } else if (modalType === 'campaign-edit' && selectedCampaign) {
      await fetch(`/api/campaigns/${selectedCampaign}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await fetchCampaigns(selectedWorld);
    }
    closeModal();
  };

  const saveArc = async (payload: any) => {
    if (!selectedCampaign) return alert('Select a campaign first');
    if (modalType === 'arc-new') {
      const res = await fetch(`/api/campaigns/${selectedCampaign}/arcs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const created = await res.json(); await fetchArcs(selectedCampaign); setSelectedArc(created.id);
    } else if (modalType === 'arc-edit' && selectedArc) {
      await fetch(`/api/arcs/${selectedArc}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await fetchArcs(selectedCampaign!);
    }
    closeModal();
  };

  const saveScene = async (payload: any) => {
    if (!selectedArc) return alert('Select an arc first');
    if (modalType === 'scene-new') {
      const res = await fetch(`/api/arcs/${selectedArc}/scenes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const created = await res.json(); await fetchScenes(selectedArc); handleSceneChange(created.id);
    } else if (modalType === 'scene-edit' && selectedScene) {
      await fetch(`/api/scenes/${selectedScene}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await fetchScenes(selectedArc!);
    }
    closeModal();
  };

  const contentClasses = [
    'flex-1',
    currentTab === 'chat' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden',
    'transition-all duration-300 ease-in-out'
  ].filter(Boolean).join(' ');

  return (
    <ToastProvider>
      <div className="w-screen h-screen flex overflow-hidden relative">
        <TopBar 
          onLeftToggle={() => setLeftPanelOpen(!leftPanelOpen)}
          onConfigClick={() => { setCurrentTab('config'); setModalType(null); }}
          onLLMConfigClick={() => setShowLLMConfigModal(true)}
          onRightToggle={() => setRightPanelOpen(!rightPanelOpen)}
          onChatClick={() => {
            setCurrentTab('chat');
            setModalType(null);
          }}
          onCharacterClick={() => {
            setCurrentTab('characters');
            setModalType(null);
          }}
          onLoreClick={() => {
            setCurrentTab('lore');
            setModalType(null);
          }}
          onImageClick={() => {
            setCurrentTab('comfyui');
          }}
          onWorldClick={() => {
            setCurrentTab('worlds');
            setModalType(null);
          }}
          onDebugClick={() => {
            setCurrentTab('debug');
            setModalType(null);
          }}
          leftOpen={leftPanelOpen}
          rightOpen={rightPanelOpen}
          title={sessionContext?.scene?.title || 'RoleForge'}
        />

        <div className="flex flex-1 mt-[50px] overflow-hidden">
          {/* Left Panel */}
          {leftPanelOpen && (
            <Panel side="left" open={true} onToggle={() => setLeftPanelOpen(false)}>
          <div className="space-y-6 p-4">
            <PersonaComponent
              personas={personas}
              selectedPersona={selectedPersona}
              onPersonaChange={setSelectedPersona}
              onEditPersonas={() => setCurrentTab('personas')}
            />
            <ActiveCharacterComponent
              characters={characters}
              activeCharacters={activeCharacters}
              onApplySelections={updateActiveCharacters}
            />
            {/* Import moved into Lore Manager */}
          </div>
          </Panel>
          )}

          {/* Main Content */}
          <main className={contentClasses}>
            <div className="h-full flex flex-col mx-2.5">
              {currentTab === 'chat' && (
                <Chat
                messages={messages}
                selectedScene={selectedScene}
                input={input}
                onInputChange={setInput}
                onSendMessage={sendMessage}
                isStreaming={isStreaming}
                onScroll={(atBottom) => setUserScrolledUp(!atBottom)}
                userScrolledUp={userScrolledUp}
                personas={personas}
                characters={characters}
                onUpdateMessage={updateMessageContent}
                onMessagesRefresh={() => selectedScene && loadMessages(selectedScene)}
                onSessionRefresh={refreshSessionContext}
                socket={socket}
              />
            )}
            {currentTab === 'characters' && <CharacterManager onRefresh={fetchCharacters} />}
            {currentTab === 'lore' && <LoreManager version={lorebooksVersion} />}
            {currentTab === 'personas' && <PersonaManager />}
            {currentTab === 'comfyui' && <ComfyConfigModal visible={true} onClose={() => setCurrentTab('chat')} isModal={false} />}
            {currentTab === 'config' && <ConfigModal onClose={() => setCurrentTab('chat')} />}
            {currentTab === 'worlds' && <WorldManager onRefresh={fetchWorlds} onSelectScene={handleSceneChange} selectedScene={selectedScene} />}
            {currentTab === 'debug' && <DebugVectorPanel />}
            </div>
          </main>

          {/* Right Panel */}
          {rightPanelOpen && (
            <Panel side="right" open={true} onToggle={() => setRightPanelOpen(false)} title="World Status">
              <div className="p-4">
                <WorldStatus sessionContext={sessionContext} campaignId={sessionContext?.campaign?.id} />
              </div>
            </Panel>
          )}
        </div>

        {/* Modal editors */}
        <WorldEditor visible={modalType === 'world-new' || modalType === 'world-edit'} initial={modalInitial} onClose={closeModal} onSave={saveWorld} />
        <CampaignEditor visible={modalType === 'campaign-new' || modalType === 'campaign-edit'} initial={modalInitial} onClose={closeModal} onSave={saveCampaign} />
        <ArcEditor visible={modalType === 'arc-new' || modalType === 'arc-edit'} initial={modalInitial} onClose={closeModal} onSave={saveArc} />
        <SceneEditor visible={modalType === 'scene-new' || modalType === 'scene-edit'} initial={modalInitial} onClose={closeModal} onSave={saveScene} />
        <ComfyConfigModal visible={modalType === 'comfyui'} onClose={() => setModalType(null)} />
        {showLLMConfigModal && <LLMConfigModal onClose={() => setShowLLMConfigModal(false)} />}
        {imageModalUrl && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-300" onClick={() => { setImageModalUrl(null); setImageModalPrompt(null); }}>
            <div className="glass p-4 rounded-lg max-w-4xl w-full mx-4 max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <strong className="text-text-primary">Image</strong>
                <button 
                  className="w-8 h-8 flex items-center justify-center hover:bg-panel-tertiary rounded text-text-primary"
                  onClick={() => { setImageModalUrl(null); setImageModalPrompt(null); }}
                >
                  ✕
                </button>
              </div>
              <div className="text-center">
                <img src={imageModalUrl} alt={imageModalPrompt || 'image'} className="max-w-full max-h-[70vh] rounded" />
                {imageModalPrompt && <div className="mt-2 text-text-secondary text-sm">{imageModalPrompt}</div>}
              </div>
            </div>
          </div>
        )}
        <ConfirmModal
          open={!!(deleteChoice && deleteChoice.open)}
          title="Delete image"
          message={deleteChoice?.prompt || 'Remove image versions?'}
          confirmLabel="Delete All"
          cancelLabel="Cancel"
          onCancel={() => setDeleteChoice({ open: false })}
          secondary={{ label: 'Delete Current', onClick: () => {
            const { messageId, data, onUpdate, prompt } = deleteChoice || {};
            if (!messageId) { setDeleteChoice({ open: false }); return; }
            const newUrls = (data.urls || []).slice();
            newUrls.splice(data.current, 1);
            if (newUrls.length === 0) {
              onUpdate(messageId, prompt);
            } else {
              const newCurrent = Math.min(data.current, newUrls.length - 1);
              const newData = { ...data, urls: newUrls, current: newCurrent };
              onUpdate(messageId, `![${JSON.stringify(newData)}](${newData.urls[newData.current]})`);
            }
            setDeleteChoice({ open: false });
          } }}
          onConfirm={() => {
            const { messageId, data, onUpdate, prompt } = deleteChoice || {};
            if (!messageId) { setDeleteChoice({ open: false }); return; }
            onUpdate(messageId, prompt);
            setDeleteChoice({ open: false });
          }}
        />
      </div>
    </ToastProvider>
  );
}

export default App;
