import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import ImageCard from './ImageCard';
import { Socket } from 'socket.io-client';

interface Message {
  role: 'user' | 'ai';
  content: string;
  sender: string;
  id?: number;
  timestamp?: string;
  messageNumber?: number;
  tokenCount?: number;
}

interface Persona {
  name?: string;
  species?: string;
  race?: string;
  gender?: string;
  appearance?: {
    height: string;
    weight: string;
    build: string;
    eyeColor: string;
    hairColor: string;
    hairStyle: string;
    attractiveness: string;
    distinctiveFeatures?: string;
  };
  aesthetic?: string;
  currentOutfit?: string;
  personality?: string;
  skills?: string;
  powers?: string;
  occupation?: string;
  workplace?: string;
  sexualOrientation?: string;
  relationshipStatus?: string;
  relationshipPartner?: string;
  likes?: string;
  turnOns?: string;
  dislikes?: string;
  turnOffs?: string;
  kinks?: string;
  backstory?: string;
  scenario?: string;
  description?: string;
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

interface Character {
  name?: string;
  avatarUrl?: string;
}

interface ChatProps {
  messages: Message[];
  selectedScene: number | null;
  input: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  isStreaming: boolean;
  onScroll: (atBottom: boolean) => void;
  userScrolledUp: boolean;
  personas: Persona[];
  characters: Character[];
  onUpdateMessage: (id: number, content: string) => void;
  onMessagesRefresh: () => void;
  onSessionRefresh?: () => void;
  socket: Socket;
}

const Chat: React.FC<ChatProps> = ({
  messages,
  selectedScene,
  input,
  onInputChange,
  onSendMessage,
  isStreaming,
  onScroll,
  userScrolledUp,
  personas,
  characters,
  onUpdateMessage,
  onMessagesRefresh,
  onSessionRefresh,
  socket,
}) => {
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingSaving, setEditingSaving] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [deleteMode, setDeleteMode] = useState<boolean>(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);

  // Handler for Regenerate button
  const handleRegenerateMessages = () => {
    if (!selectedScene) return;
    setCurrentAgent('Regenerating');
    fetch(`/api/scenes/${selectedScene}/messages/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.json())
      .then(data => {
        console.log('Regeneration result:', data);
        onMessagesRefresh();
      })
      .catch(e => {
        alert('Failed to regenerate messages');
        console.warn('Regeneration error:', e);
      })
      .finally(() => {
        setCurrentAgent(null);
        setMenuOpen(false);
      });
  };

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, userScrolledUp]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuOpen && !(event.target as Element).closest('.relative')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Listen for agent status updates
  useEffect(() => {
    if (!socket) return;

    const handleAgentStatus = (data: { agent: string; status: 'start' | 'complete' }) => {
      if (data.status === 'start') {
        setCurrentAgent(data.agent);
      } else if (data.status === 'complete') {
        setCurrentAgent(null);
      }
    };

    socket.on('agentStatus', handleAgentStatus);

    return () => {
      socket.off('agentStatus', handleAgentStatus);
    };
  }, [socket]);

  const highlightInlineQuotes = (s: string) => {
    try {
      return s.replace(/\"([^\\\"]+)\"/g, '<span class="inline-quote">"$1"</span>');
    } catch (e) {
      return s;
    }
  };

  const renderMessage = (msg: Message) => {
    // Guard against undefined or null content
    if (!msg.content) {
      console.warn('Message has no content:', msg);
      return (
        <div className="message-row">
          <div className="avatar">{(msg.sender || 'AI').toString().split(':').pop()?.slice(0, 2)}</div>
          <div className="message-body">
            <div className="message-meta"><strong>{msg.sender}</strong> {msg.timestamp ? <span className="ts">{new Date(msg.timestamp).toLocaleTimeString()}</span> : null}</div>
            <div className="message-text"><em>(empty message)</em></div>
          </div>
        </div>
      );
    }

    const getAvatarForSender = (sender: string) => {
      const namePart = sender && sender.includes(':') ? sender.split(':').pop() || sender : sender;
      // First check personas (user-selected profiles), then characters
      const p = personas.find((pp: any) => (pp.name || '').toString() === namePart);
      if (p && p.avatarUrl) return p.avatarUrl;
      const ch = characters.find((c: any) => (c.name || '').toString() === namePart);
      return ch?.avatarUrl || null;
    };

    const visualMatch = msg.content.match(/\[VISUAL: ([^\]]+)\]/);
    if (visualMatch) {
      const textPart = msg.content.replace(/\[VISUAL: [^\]]+\]/, '').trim();
      const visualPrompt = visualMatch[1];
      return (
        <div className="message-row">
          <div className="avatar">{getAvatarForSender(msg.sender) ? <img src={getAvatarForSender(msg.sender)!} alt="avatar" className="avatar-img" /> : (msg.sender || 'AI').toString().split(':').pop()?.slice(0,2)}</div>
          <div className="message-body">
            <div className="message-meta"><strong>{msg.sender}</strong> {msg.timestamp ? <span className="ts">{new Date(msg.timestamp).toLocaleTimeString()}</span> : null}</div>
            <div className="message-text"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{textPart}</ReactMarkdown></div>
            <div className="visual-tag">[Image: {visualPrompt}]</div>
          </div>
        </div>
      );
    }

    const displayName = msg.sender && msg.sender.includes(':') ? msg.sender.split(':').pop() : msg.sender;

    const onEditStart = () => {
      if (!msg.id) return; // only edit persisted messages
      setEditingMessageId(msg.id || null);
      setEditingText(msg.content);
    };

    const onCancelEdit = () => {
      setEditingMessageId(null);
      setEditingText('');
    };

    const onSaveEdit = async () => {
      if (!msg.id) return;
      setEditingSaving(true);
      try {
        await onUpdateMessage(msg.id, editingText);
      } catch (e) {
        console.warn('Failed to save message edit', e);
      } finally {
        setEditingSaving(false);
        onCancelEdit();
      }
    };

    const onDelete = async () => {
      if (!msg.id) return;
      if (!confirm('Delete this message? This will reorder subsequent messages.')) return;
      try {
        await fetch(`/api/messages/${msg.id}`, { method: 'DELETE' });
        onMessagesRefresh(); // Refresh messages after successful delete
      } catch (e) { console.warn('Failed to delete message', e); }
    };

    const onMove = async (direction: 'up' | 'down') => {
      if (!msg.id) return;
      try {
        await fetch(`/api/messages/${msg.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) });
        onMessagesRefresh(); // Refresh messages after successful move
      } catch (e) { console.warn('Failed to move message', e); }
    };

    return (
      <div className="message-row" onDoubleClick={deleteMode ? undefined : onEditStart}>
        {deleteMode && msg.id && (
          <div style={{ display: 'flex', alignItems: 'center', marginRight: 8 }}>
            <input
              type="checkbox"
              checked={selectedMessages.has(msg.id)}
              onChange={(e) => {
                const newSelected = new Set(selectedMessages);
                if (e.target.checked) {
                  newSelected.add(msg.id);
                } else {
                  newSelected.delete(msg.id);
                }
                setSelectedMessages(newSelected);
              }}
              style={{ margin: 0 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div className="avatar">{getAvatarForSender(msg.sender) ? <img src={getAvatarForSender(msg.sender)!} alt="avatar" className="avatar-img" /> : (displayName || 'AI').toString().slice(0,2)}</div>
          <div className="avatar-meta">
            {msg.messageNumber ? <div className="msg-num">#{msg.messageNumber}</div> : null}
            {msg.tokenCount !== undefined && msg.tokenCount !== null ? <div className="token-count">{msg.tokenCount}t</div> : null}
          </div>
        </div>
        <div className="message-body">
          <div className="message-meta"><strong>{displayName}</strong> {msg.timestamp ? <span className="ts">{new Date(msg.timestamp).toLocaleTimeString()}</span> : null}</div>
          {editingMessageId === msg.id ? (
            <div className="message-edit-inline">
              <textarea value={editingText} onChange={e => setEditingText(e.target.value)} rows={4} style={{ width: '100%', padding: 8, borderRadius: 6, background: 'transparent', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.06)' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="icon-btn" onClick={onSaveEdit} disabled={editingSaving} title="Save">✅</button>
                <button className="icon-btn" onClick={onCancelEdit} title="Cancel">❌</button>
                <button className="icon-btn" onClick={onDelete} title="Delete">🗑️</button>
                <button className="icon-btn" onClick={() => onMove('up')} title="Move up">⬆️</button>
                <button className="icon-btn" onClick={() => onMove('down')} title="Move down">⬇️</button>
              </div>
            </div>
          ) : (
            <div className="message-text">
              {(() => {
                // Avoid mutating image alt JSON by not running quote-highlighting on content that contains images
                const markdownContent = msg.content && msg.content.includes('![') ? msg.content : highlightInlineQuotes(msg.content);
                return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ img: (props) => <ImageCard {...props} messageId={msg.id} onUpdateMessage={onUpdateMessage} selectedScene={selectedScene} /> }}>{markdownContent}</ReactMarkdown>;
              })()}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Chat Section */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
        {selectedScene ? (
          <>
            <div
              ref={chatWindowRef}
              className="flex flex-col space-y-4"
            onScroll={(e) => {
              const el = e.target as HTMLDivElement;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 50;
              onScroll(atBottom);
            }}
          >
            {messages.map((msg, i) => (
              <div key={i} className="flex justify-start">
                <div className={`w-full p-3 rounded-lg ${msg.role === 'user' ? 'bg-accent-primary text-white' : 'glass text-text-primary'}`}>
                  {renderMessage(msg)}
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="glass p-3 rounded-lg text-text-primary w-full">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                  </div>
                </div>
              </div>
            )}
            {currentAgent && (
              <div className="flex justify-start">
                <div className="glass p-3 rounded-lg text-text-primary w-full">
                  <div className="flex items-center space-x-3">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                      <div className="w-2 h-2 bg-accent-primary rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                    </div>
                    <span className="text-text-secondary text-sm">
                      {(() => {
                        // Check if currentAgent is a character name
                        const isCharacter = characters.some(char => char.name === currentAgent);
                        if (isCharacter) {
                          return `${currentAgent} is typing...`;
                        }
                        // For system agents, show appropriate messages
                        switch (currentAgent) {
                          case 'Narrator':
                            return 'Narrator is describing the scene...';
                          case 'Director':
                            return 'Director is planning the response...';
                          case 'WorldAgent':
                            return 'World Agent is updating the story state...';
                          case 'Summarize':
                            return 'Summarizing conversation history...';
                          case 'Resetting':
                            return 'Resetting scene...';
                          case 'Visual':
                            return 'Visual Agent is generating an image...';
                          case 'Creator':
                            return 'Creator Agent is generating content...';
                          default:
                            return `${currentAgent} is thinking...`;
                        }
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary">
            No scene selected. Select a scene to load chat.
          </div>
        )}
      </div>

      {/* Input Section */}
      <div className="border-t border-border-color p-4 flex-shrink-0">
        {deleteMode && (
          <div className="flex gap-2 mb-3">
            <button
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              onClick={async () => {
                if (selectedMessages.size === 0) return;
                if (!confirm(`Delete ${selectedMessages.size} selected message(s)? This will reorder subsequent messages.`)) return;
                try {
                  const deletePromises = Array.from(selectedMessages).map(id =>
                    fetch(`/api/messages/${id}`, { method: 'DELETE' })
                  );
                  await Promise.all(deletePromises);
                  setSelectedMessages(new Set());
                  setDeleteMode(false);
                  onMessagesRefresh();
                } catch (e) {
                  console.warn('Failed to delete messages', e);
                }
              }}
              disabled={selectedMessages.size === 0}
            >
              Delete Selected ({selectedMessages.size})
            </button>
            <button
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
              onClick={() => {
                setDeleteMode(false);
                setSelectedMessages(new Set());
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative">
            <button
              className="chat-menu-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              disabled={!selectedScene}
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="chat-menu-dropdown">
                <button
                  className="chat-menu-item"
                  onClick={() => {
                    setDeleteMode(true);
                    setMenuOpen(false);
                  }}
                >
                  Delete Posts
                </button>
                  <button
                    className="chat-menu-item"
                    onClick={handleRegenerateMessages}
                    disabled={!selectedScene}
                  >
                    Regenerate
                  </button>
                <button
                  className="chat-menu-item"
                  onClick={async () => {
                    if (!selectedScene) return;
                    const confirmed = window.confirm('This will permanently clear all messages and reset scene details (except description and location). Are you sure?');
                    if (!confirmed) return;
                    try {
                      setCurrentAgent('Resetting');
                      const response = await fetch(`/api/scenes/${selectedScene}/reset`, { method: 'POST' });
                      if (!response.ok) {
                        throw new Error('Reset failed');
                      }
                      // Refresh messages to show empty chat
                      onMessagesRefresh();
                      // Also refresh session context to reset trackers and state
                      if (onSessionRefresh) {
                        onSessionRefresh();
                      }
                    } catch (e) {
                      console.warn('Failed to reset scene', e);
                      alert('Failed to reset scene');
                    } finally {
                      setCurrentAgent(null);
                      setMenuOpen(false);
                    }
                  }}
                  disabled={!selectedScene}
                >
                  Reset Scene
                </button>
              </div>
            )}
          </div>
          <textarea
            className="flex-1 p-3 bg-panel-secondary border border-border-color rounded-lg text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendMessage();
              }
            }}
            placeholder={selectedScene ? 'Type your message... (Shift+Enter for newline)' : 'Select a scene to enable chat'}
            disabled={!selectedScene || deleteMode}
            rows={2}
          />
          <button
            className="px-6 py-2 bg-accent-primary hover:bg-accent-hover disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
            onClick={onSendMessage}
            disabled={!selectedScene || !input.trim() || deleteMode}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;