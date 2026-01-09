import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import ImageCard from './ImageCard';

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
  avatarUrl?: string;
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
  onMessagesRefresh
}) => {
  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingSaving, setEditingSaving] = useState<boolean>(false);

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, userScrolledUp]);

  const highlightInlineQuotes = (s: string) => {
    try {
      return s.replace(/\"([^\\\"]+)\"/g, '<span class="inline-quote">"$1"</span>');
    } catch (e) {
      return s;
    }
  };

  const renderMessage = (msg: Message) => {
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
      <div className="message-row" onDoubleClick={onEditStart}>
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
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-secondary">
            No scene selected. Select a scene to load chat.
          </div>
        )}
      </div>

      {/* Input Section */}
      <div className="border-t border-border-color p-4 flex-shrink-0">
        <div className="flex gap-2">
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
            disabled={!selectedScene}
            rows={2}
          />
          <button
            className="px-6 py-2 bg-accent-primary hover:bg-accent-hover disabled:bg-gray-600 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
            onClick={onSendMessage}
            disabled={!selectedScene || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;