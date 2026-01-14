import React, { useState, useEffect } from 'react';
import './editorModal.css';

interface LLMProfile {
  type: string;
  baseURL: string;
  apiKey?: string;
  model?: string;
  template?: string;
  sampler?: {
    temperature?: number;
    topP?: number;
    max_completion_tokens?: number;
    maxContextTokens?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
  };
  fallbackProfiles?: string[];
}

interface LLMConfig {
  defaultProfile: string;
  profiles: Record<string, LLMProfile>;
  agents: Record<string, { llmProfile: string; sampler?: Record<string, any>; returnsJson?: boolean }>;
}

interface LLMConfigModalProps {
  onClose: () => void;
}

export const LLMConfigModal: React.FC<LLMConfigModalProps> = ({ onClose }) => {
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'profiles' | 'agents'>('profiles');
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadConfig();
    loadTemplates();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/llm/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      setError('Failed to load config: ' + (err as Error).message);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/llm/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Failed to load templates');
    }
  };

  const saveConfig = async () => {
    if (!config) return;
    try {
      const res = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setSuccess('Configuration saved successfully');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const err = await res.json();
        setError(err.error || 'Failed to save config');
      }
    } catch (err) {
      setError('Failed to save config: ' + (err as Error).message);
    }
  };

  const deleteProfile = async (profileName: string) => {
    if (!window.confirm(`Delete profile "${profileName}"?`)) return;
    try {
      const res = await fetch(`/api/llm/profiles/${profileName}`, { method: 'DELETE' });
      if (res.ok) {
        setConfig(prev => {
          if (!prev) return prev;
          const newProfiles = { ...prev.profiles };
          delete newProfiles[profileName];
          return { ...prev, profiles: newProfiles };
        });
        setSuccess('Profile deleted');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err) {
      setError('Failed to delete profile');
    }
  };

  const updateProfile = (profileName: string, updates: Partial<LLMProfile>) => {
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [profileName]: { ...prev.profiles[profileName], ...updates }
        }
      };
    });
  };

  const addNewProfile = () => {
    if (!newProfileName.trim()) {
      setError('Profile name cannot be empty');
      return;
    }
    if (config?.profiles[newProfileName]) {
      setError('Profile already exists');
      return;
    }
    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [newProfileName]: {
            type: 'openai',
            baseURL: 'http://localhost:5001/v1',
            model: 'model-name',
            template: 'chatml'
          }
        }
      };
    });
    setNewProfileName('');
    setSuccess('Profile created');
    setTimeout(() => setSuccess(''), 3000);
  };

  if (!config) return <div className="modal-overlay"><div className="modal-content">Loading...</div></div>;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '900px', maxHeight: '90vh', overflow: 'auto', background: '#1a1f2e', borderRadius: '8px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ borderBottom: '1px solid #2a3142' }}>
          <h2 style={{ color: '#e6e8ec' }}>LLM Configuration</h2>
          <button className="close-btn" onClick={onClose} style={{ color: '#e6e8ec' }}>×</button>
        </div>

        {error && <div style={{ background: '#3d1a1a', color: '#ff6b6b', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #5a2a2a' }}>{error}</div>}
        {success && <div style={{ background: '#1a3d2a', color: '#51cf66', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #2a5a3d' }}>{success}</div>}

        <div style={{ borderBottom: '1px solid #2a3142', marginBottom: '20px' }}>
          <button 
            onClick={() => setActiveTab('profiles')}
            style={{ 
              padding: '10px 20px',
              background: activeTab === 'profiles' ? '#007bff' : 'transparent',
              color: '#e6e8ec',
              border: activeTab === 'profiles' ? '1px solid #0056cc' : '1px solid transparent',
              cursor: 'pointer',
              marginRight: '5px',
              borderRadius: '4px 4px 0 0'
            }}
          >
            Profiles
          </button>
          <button 
            onClick={() => setActiveTab('agents')}
            style={{ 
              padding: '10px 20px',
              background: activeTab === 'agents' ? '#007bff' : 'transparent',
              color: '#e6e8ec',
              border: activeTab === 'agents' ? '1px solid #0056cc' : '1px solid transparent',
              cursor: 'pointer',
              borderRadius: '4px 4px 0 0'
            }}
          >
            Agent Mapping
          </button>
        </div>

        {activeTab === 'profiles' && (
          <div>
            <h3 style={{ color: '#e6e8ec' }}>LLM Profiles</h3>
            <div style={{ marginBottom: '20px', padding: '15px', background: '#252b3b', borderRadius: '4px', border: '1px solid #2a3142' }}>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ color: '#a1a8b8' }}>Default Profile:</label>
                <select 
                  value={config.defaultProfile} 
                  onChange={e => setConfig({ ...config, defaultProfile: e.target.value })}
                  style={{ marginLeft: '10px', padding: '5px', background: '#1a1f2e', color: '#e6e8ec', border: '1px solid #2a3142', borderRadius: '4px' }}
                >
                  {Object.keys(config.profiles).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ color: '#e6e8ec' }}>Add New Profile</h4>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <input 
                  type="text" 
                  placeholder="Profile name (e.g., 'openai', 'local')"
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  style={{ flex: 1, padding: '8px', border: '1px solid #2a3142', borderRadius: '4px', background: '#0f1419', color: '#e6e8ec', boxSizing: 'border-box' }}
                />
                <button 
                  onClick={addNewProfile}
                  style={{ padding: '8px 20px', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Add Profile
                </button>
              </div>
            </div>

            {Object.entries(config.profiles).map(([profileName, profile]) => (
              <ProfileCard 
                key={profileName}
                profileName={profileName}
                profile={profile}
                templates={templates}
                onUpdate={(updates) => updateProfile(profileName, updates)}
                onDelete={() => deleteProfile(profileName)}
                isExpanded={editingProfile === profileName}
                onToggle={() => setEditingProfile(editingProfile === profileName ? null : profileName)}
              />
            ))}
          </div>
        )}

        {activeTab === 'agents' && (
          <div>
            <h3 style={{ color: '#e6e8ec' }}>Agent LLM Profile Assignment</h3>
            <p style={{ color: '#a1a8b8', fontSize: '14px' }}>
              Assign which LLM profile each agent should use. Leave empty to use the default profile.
            </p>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#a1a8b8', display: 'block', marginBottom: '8px' }}>Select Agent:</label>
              <select 
                value={selectedAgent || ''}
                onChange={e => setSelectedAgent(e.target.value || null)}
                style={{ padding: '10px', width: '300px', background: '#1a1f2e', color: '#e6e8ec', border: '1px solid #2a3142', borderRadius: '4px', fontSize: '14px' }}
              >
                <option value="">Choose an agent...</option>
                {Object.keys(config.agents || {}).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {selectedAgent && config.agents && config.agents[selectedAgent] && (
              <div style={{ padding: '20px', background: '#252b3b', borderRadius: '4px', border: '1px solid #2a3142', maxWidth: '500px' }}>
                <h4 style={{ marginTop: 0, marginBottom: '15px', color: '#e6e8ec' }}>{selectedAgent}</h4>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ color: '#a1a8b8', display: 'block', marginBottom: '8px' }}>Profile:</label>
                  <select 
                    value={config.agents[selectedAgent].llmProfile || 'default'}
                    onChange={e => {
                      setConfig(prev => {
                        if (!prev) return prev;
                        const newAgents = { ...prev.agents };
                        if (!newAgents[selectedAgent]) newAgents[selectedAgent] = {};
                        newAgents[selectedAgent].llmProfile = e.target.value === 'default' ? 'default' : e.target.value;
                        return { ...prev, agents: newAgents };
                      });
                    }}
                    style={{ padding: '8px', width: '100%', background: '#1a1f2e', color: '#e6e8ec', border: '1px solid #2a3142', borderRadius: '4px' }}
                  >
                    <option value="default">default</option>
                    {Object.keys(config.profiles).map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <details style={{ marginTop: '15px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#e6e8ec', padding: '8px 0' }}>Sampler Overrides</summary>
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #2a3142' }}>
                    <SamplerOverrides 
                      agentName={selectedAgent}
                      sampler={config.agents[selectedAgent].sampler || {}}
                      onChange={(sampler) => {
                        setConfig(prev => {
                          if (!prev) return prev;
                          const newAgents = { ...prev.agents };
                          if (!newAgents[selectedAgent]) newAgents[selectedAgent] = {};
                          newAgents[selectedAgent].sampler = sampler;
                          return { ...prev, agents: newAgents };
                        });
                      }}
                    />
                  </div>
                </details>
                <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #2a3142' }}>
                  <label style={{ color: '#a1a8b8', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox"
                      checked={config.agents[selectedAgent].returnsJson ?? false}
                      onChange={e => {
                        setConfig(prev => {
                          if (!prev) return prev;
                          const newAgents = { ...prev.agents };
                          if (!newAgents[selectedAgent]) newAgents[selectedAgent] = {};
                          newAgents[selectedAgent].returnsJson = e.target.checked;
                          return { ...prev, agents: newAgents };
                        });
                      }}
                      style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                    />
                    <span>Agent returns JSON responses</span>
                  </label>
                  <small style={{ color: '#6b7280', display: 'block', marginTop: '8px' }}>
                    Check if this agent returns structured JSON. Uncheck for plaintext responses.
                  </small>
                </div>
              </div>
            )}

            {!selectedAgent && (
              <div style={{ padding: '20px', background: '#1a1f2e', borderRadius: '4px', color: '#a1a8b8', textAlign: 'center' }}>
                Select an agent from the dropdown above to configure its settings.
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #2a3142', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button 
            onClick={onClose}
            style={{ padding: '10px 20px', background: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Close
          </button>
          <button 
            onClick={saveConfig}
            style={{ padding: '10px 20px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProfileCardProps {
  profileName: string;
  profile: LLMProfile;
  templates: string[];
  onUpdate: (updates: Partial<LLMProfile>) => void;
  onDelete: () => void;
  isExpanded: boolean;
  onToggle: () => void;
}

const ProfileCard: React.FC<ProfileCardProps> = ({
  profileName,
  profile,
  templates,
  onUpdate,
  onDelete,
  isExpanded,
  onToggle
}) => {
  // Map template names to descriptions
  const templateDescriptions: Record<string, string> = {
    'chatml': 'ChatML (OpenAI, Claude, Mistral, Local ChatML)',
    'alpaca': 'Alpaca (Stanford Alpaca, OpenAssistant)',
    'vicuna': 'Vicuna (Vicuna 7B/13B/33B)',
    'llama2': 'Llama2 (Meta Llama2-Chat)'
  };

  return (
    <div style={{ padding: '15px', background: '#252b3b', borderRadius: '4px', border: '1px solid #2a3142', marginBottom: '15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <h4 style={{ margin: 0, color: '#e6e8ec' }}>{profileName}</h4>
        <span style={{ color: '#a1a8b8' }}>{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #2a3142' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#a1a8b8' }}>Client Type:</label>
            <select 
              value={profile.type || 'openai'}
              onChange={e => onUpdate({ type: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
            >
              <option value="openai">OpenAI SDK (ChatGPT, Claude, Mistral, etc.)</option>
              <option value="custom">Custom Client (Local LLMs, Alpaca, Llama2, Vicuna, etc.)</option>
            </select>
            <small style={{ color: '#6b7280', display: 'block', marginTop: '5px' }}>
              {profile.type === 'custom' 
                ? 'Uses axios to send raw template-rendered prompts to any LLM endpoint'
                : 'Uses OpenAI SDK for ChatML-formatted API calls'}
            </small>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#a1a8b8' }}>Base URL:</label>
            <input 
              type="text"
              value={profile.baseURL}
              onChange={e => onUpdate({ baseURL: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
              placeholder={profile.type === 'custom' ? 'http://localhost:11434/api' : 'https://api.openai.com/v1'}
            />
            <small style={{ color: '#6b7280', display: 'block', marginTop: '5px' }}>
              {profile.type === 'custom'
                ? 'Examples: http://localhost:11434/api (ollama), http://localhost:8000/v1 (vLLM), http://localhost:5000 (TextGen WebUI)'
                : 'OpenAI API endpoint URL'}
            </small>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#a1a8b8' }}>Model:</label>
            <input 
              type="text"
              value={profile.model || ''}
              onChange={e => onUpdate({ model: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#a1a8b8' }}>API Key (optional):</label>
            <input 
              type="password"
              value={profile.apiKey || ''}
              onChange={e => onUpdate({ apiKey: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
              placeholder="Leave empty for local backends"
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#a1a8b8' }}>Template:</label>
            <select 
              value={profile.template || 'chatml'}
              onChange={e => onUpdate({ template: e.target.value })}
              style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
            >
              {templates.map(template => (
                <option key={template} value={template}>
                  {templateDescriptions[template] || template}
                </option>
              ))}
            </select>
            <small style={{ color: '#6b7280', display: 'block', marginTop: '5px' }}>
              {profile.type === 'custom'
                ? 'Format used by the local LLM model'
                : 'ChatML format for OpenAI-compatible endpoints'}
            </small>
          </div>

          <details style={{ marginBottom: '15px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#e6e8ec' }}>Configuration Examples</summary>
            <div style={{ marginTop: '10px', padding: '10px', background: '#1a1f2e', borderRadius: '4px', border: '1px solid #2a3142', fontSize: '13px', color: '#a1a8b8' }}>
              {profile.type === 'custom' ? (
                <>
                  <p><strong>Ollama:</strong> Base URL: http://localhost:11434/api, Model: alpaca (or your model name)</p>
                  <p><strong>vLLM:</strong> Base URL: http://localhost:8000/v1, Model: alpaca-7b</p>
                  <p><strong>TextGen WebUI:</strong> Base URL: http://localhost:5000, Model: alpaca-7b</p>
                  <p><strong>KoboldCPP:</strong> Base URL: http://localhost:5001, Model: default</p>
                </>
              ) : (
                <>
                  <p><strong>OpenAI:</strong> BaseURL: https://api.openai.com/v1, Model: gpt-4 or gpt-3.5-turbo</p>
                  <p><strong>Anthropic Claude:</strong> BaseURL: https://api.anthropic.com/v1, Model: claude-opus</p>
                  <p><strong>Mistral:</strong> BaseURL: https://api.mistral.ai/v1, Model: mistral-medium</p>
                </>
              )}
            </div>
          </details>

          <details style={{ marginBottom: '15px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#e6e8ec' }}>Sampler Settings</summary>
            <div style={{ marginTop: '10px', padding: '10px', background: '#1a1f2e', borderRadius: '4px', border: '1px solid #2a3142' }}>
              <SamplerForm 
                sampler={profile.sampler}
                onChange={sampler => onUpdate({ sampler })}
              />
            </div>
          </details>

          <details style={{ marginBottom: '15px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#e6e8ec' }}>Fallback Profiles</summary>
            <div style={{ marginTop: '10px', padding: '10px', background: '#1a1f2e', borderRadius: '4px', border: '1px solid #2a3142' }}>
              <p style={{ fontSize: '14px', color: '#a1a8b8', marginBottom: '10px' }}>
                Profiles to try if this one fails (comma-separated):
              </p>
              <input 
                type="text"
                value={(profile.fallbackProfiles || []).join(', ')}
                onChange={e => onUpdate({ fallbackProfiles: e.target.value.split(',').map(s => s.trim()).filter(s => s) })}
                style={{ width: '100%', padding: '8px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
              />
            </div>
          </details>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button 
              onClick={onDelete}
              style={{ padding: '8px 15px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface SamplerFormProps {
  sampler?: LLMProfile['sampler'];
  onChange: (sampler: LLMProfile['sampler']) => void;
}

const SamplerForm: React.FC<SamplerFormProps> = ({ sampler = {}, onChange }) => {
  const updateSampler = (key: string, value: any) => {
    onChange({ ...sampler, [key]: value });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
      <div>
        <label style={{ color: '#a1a8b8' }}>Temperature:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.temperature || 0.7}
          onChange={e => updateSampler('temperature', parseFloat(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>0-2, higher = more creative</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8' }}>Top P:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="1"
          value={sampler.topP || 0.9}
          onChange={e => updateSampler('topP', parseFloat(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>0-1, nucleus sampling</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8' }}>Max Completion Tokens:</label>
        <input 
          type="number" 
          min="1"
          value={sampler.max_completion_tokens || 512}
          onChange={e => updateSampler('max_completion_tokens', parseInt(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>Max tokens in response</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8' }}>Max Context Tokens:</label>
        <input 
          type="number" 
          min="1"
          value={sampler.maxContextTokens || 2048}
          onChange={e => updateSampler('maxContextTokens', parseInt(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>Max context window</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8' }}>Frequency Penalty:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.frequencyPenalty || 0}
          onChange={e => updateSampler('frequencyPenalty', parseFloat(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>Penalize repeated tokens</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8' }}>Presence Penalty:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.presencePenalty || 0}
          onChange={e => updateSampler('presencePenalty', parseFloat(e.target.value))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
        />
        <small style={{ color: '#6b7280' }}>Penalize new tokens</small>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ color: '#a1a8b8' }}>Stop Sequences (comma-separated):</label>
        <input 
          type="text"
          value={(sampler.stop || []).join(', ')}
          onChange={e => updateSampler('stop', e.target.value.split(',').map(s => s.trim()).filter(s => s))}
          style={{ width: '100%', padding: '8px', marginTop: '5px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="e.g., END, ###, User:"
        />
        <small style={{ color: '#6b7280' }}>Strings where generation stops</small>
      </div>
    </div>
  );
};

interface SamplerOverridesProps {
  agentName: string;
  sampler: Record<string, any>;
  onChange: (sampler: Record<string, any>) => void;
}

const SamplerOverrides: React.FC<SamplerOverridesProps> = ({ sampler, onChange }) => {
  const updateSampler = (key: string, value: any) => {
    const newSampler = { ...sampler };
    if (value === undefined || value === '') {
      delete newSampler[key];
    } else {
      newSampler[key] = value;
    }
    onChange(newSampler);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Temperature:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.temperature !== undefined ? sampler.temperature : ''}
          onChange={e => updateSampler('temperature', e.target.value ? parseFloat(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>0-2, higher = more creative</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Top P:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="1"
          value={sampler.topP !== undefined ? sampler.topP : ''}
          onChange={e => updateSampler('topP', e.target.value ? parseFloat(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>0-1, nucleus sampling</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Max Completion Tokens:</label>
        <input 
          type="number" 
          min="1"
          value={sampler.max_completion_tokens !== undefined ? sampler.max_completion_tokens : ''}
          onChange={e => updateSampler('max_completion_tokens', e.target.value ? parseInt(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>Max tokens in response</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Max Context Tokens:</label>
        <input 
          type="number" 
          min="1"
          value={sampler.maxContextTokens !== undefined ? sampler.maxContextTokens : ''}
          onChange={e => updateSampler('maxContextTokens', e.target.value ? parseInt(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>Max context window</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Frequency Penalty:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.frequencyPenalty !== undefined ? sampler.frequencyPenalty : ''}
          onChange={e => updateSampler('frequencyPenalty', e.target.value ? parseFloat(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>Penalize repeated tokens</small>
      </div>

      <div>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Presence Penalty:</label>
        <input 
          type="number" 
          step="0.1" 
          min="0" 
          max="2"
          value={sampler.presencePenalty !== undefined ? sampler.presencePenalty : ''}
          onChange={e => updateSampler('presencePenalty', e.target.value ? parseFloat(e.target.value) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default"
        />
        <small style={{ color: '#6b7280' }}>Penalize new tokens</small>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ color: '#a1a8b8', fontSize: '14px' }}>Stop Sequences (comma-separated):</label>
        <input 
          type="text"
          value={sampler.stop ? sampler.stop.join(', ') : ''}
          onChange={e => updateSampler('stop', e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(s => s) : undefined)}
          style={{ width: '100%', padding: '5px', marginTop: '3px', border: '1px solid #2a3142', borderRadius: '4px', boxSizing: 'border-box', background: '#0f1419', color: '#e6e8ec' }}
          placeholder="Leave empty for default (e.g., END, ###, User:)"
        />
        <small style={{ color: '#6b7280' }}>Strings where generation stops</small>
      </div>
    </div>
  );
};
