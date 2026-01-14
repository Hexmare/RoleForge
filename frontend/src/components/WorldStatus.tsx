import React, { useState } from 'react';

interface WorldStatusProps {
  sessionContext: any | null;
  campaignId?: number;
}

interface ExpandedSections {
  [key: string]: boolean;
}

interface EditingState {
  type: 'worldState' | 'stat' | 'objective' | 'relationship' | 'charState' | null;
  key?: string;
  index?: number;
  charName?: string;
  charField?: string;
}

const SectionHeader = ({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) => (
  <button
    onClick={onToggle}
    className="w-full flex items-center gap-2 font-semibold text-text-primary hover:bg-panel-secondary p-2 rounded transition-colors"
    style={{ fontSize: '11px', width: '100%', maxWidth: '100%', minWidth: 0 }}
  >
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
      ▼
    </span>
    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
  </button>
);

export const WorldStatus: React.FC<WorldStatusProps> = ({ sessionContext, campaignId }) => {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    worldState: true,
    trackers: true,
    characters: false,
  });

  const [expandedCharacters, setExpandedCharacters] = useState<ExpandedSections>({});
  const [editingState, setEditingState] = useState<EditingState>({ type: null });
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleCharacter = (charName: string) => {
    setExpandedCharacters((prev) => ({ ...prev, [charName]: !prev[charName] }));
  };

  const startEditing = (type: EditingState['type'], key?: string, index?: number) => {
    let value = '';
    if (type === 'worldState' && key) {
      value = String(sessionContext?.worldState?.[key] || '');
    } else if (type === 'stat' && key) {
      value = String(sessionContext?.trackers?.stats?.[key] || '');
    } else if (type === 'objective' && index !== undefined) {
      const obj = sessionContext?.trackers?.objectives?.[index];
      value = typeof obj === 'string' ? obj : (obj?.description || JSON.stringify(obj));
    } else if (type === 'relationship' && key) {
      const val = sessionContext?.trackers?.relationships?.[key];
      value = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    } else if (type === 'charState' && key && index !== undefined) {
      const charState = sessionContext?.scene?.characterStates?.[key];
      const fieldName = Object.keys(charState || {})[index];
      if (fieldName && charState) {
        value = String(charState[fieldName] || '');
      }
      setEditingState({ type, charName: key, charField: fieldName });
      setEditValue(value);
      return;
    }
    setEditingState({ type, key, index });
    setEditValue(value);
  };

  const saveEdit = async () => {
    if (!editingState.type || !campaignId) return;
    setSaving(true);
    try {
      const newState: any = {};

      if (editingState.type === 'worldState' && editingState.key) {
        newState.dynamicFacts = { ...sessionContext?.worldState, [editingState.key]: editValue };
      } else if (editingState.type === 'stat' && editingState.key) {
        newState.trackers = {
          ...sessionContext?.trackers,
          stats: { ...sessionContext?.trackers?.stats, [editingState.key]: editValue },
        };
      } else if (editingState.type === 'objective' && editingState.index !== undefined) {
        const objectives = [...(sessionContext?.trackers?.objectives || [])];
        if (typeof objectives[editingState.index] === 'string') {
          objectives[editingState.index] = editValue;
        } else {
          objectives[editingState.index] = { ...objectives[editingState.index], description: editValue };
        }
        newState.trackers = { ...sessionContext?.trackers, objectives };
      } else if (editingState.type === 'relationship' && editingState.key) {
        try {
          const parsed = JSON.parse(editValue);
          newState.trackers = {
            ...sessionContext?.trackers,
            relationships: { ...sessionContext?.trackers?.relationships, [editingState.key]: parsed },
          };
        } catch {
          newState.trackers = {
            ...sessionContext?.trackers,
            relationships: { ...sessionContext?.trackers?.relationships, [editingState.key]: editValue },
          };
        }
      } else if (editingState.type === 'charState' && editingState.charName && editingState.charField) {
        const charStates = { ...sessionContext?.scene?.characterStates };
        if (charStates[editingState.charName]) {
          charStates[editingState.charName] = {
            ...charStates[editingState.charName],
            [editingState.charField]: editValue,
          };
        }
        newState.characterStates = charStates;
      }

      const response = await fetch(`/api/campaigns/${campaignId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newState),
      });

      if (response.ok) {
        setEditingState({ type: null });
        setEditValue('');
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditingState({ type: null });
    setEditValue('');
  };

  const hasWorldState = sessionContext?.worldState && Object.keys(sessionContext.worldState).length > 0;
  const hasTrackers = sessionContext?.trackers && (
    (sessionContext.trackers.stats && Object.keys(sessionContext.trackers.stats).length > 0) ||
    (sessionContext.trackers.objectives && sessionContext.trackers.objectives.length > 0) ||
    (sessionContext.trackers.relationships && Object.keys(sessionContext.trackers.relationships).length > 0)
  );
  const hasCharacterStates = sessionContext?.scene?.characterStates && Object.keys(sessionContext.scene.characterStates).length > 0;

  if (!hasWorldState && !hasTrackers && !hasCharacterStates) {
    return <div className="text-text-secondary text-sm p-3">No world status available</div>;
  }

  const containerStyle = { width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden' as const };

  return (
    <div style={containerStyle} className="space-y-3">
      {/* WORLD STATE */}
      {hasWorldState && (
        <div className="border border-border-color rounded-lg" style={containerStyle}>
          <SectionHeader title="World State" expanded={expandedSections.worldState} onToggle={() => toggleSection('worldState')} />
          {expandedSections.worldState && (
            <div className="p-3 bg-panel-secondary" style={{ ...containerStyle, fontSize: '10px' }}>
              {Object.entries(sessionContext.worldState).map(([key, value]) => {
                const isEditing = editingState.type === 'worldState' && editingState.key === key;
                return (
                  <div key={key} style={containerStyle}>
                    {isEditing ? (
                      <div style={containerStyle}>
                        <div style={{ marginBottom: '8px' }}>
                          <span className="text-text-primary font-medium text-xs">{key}:</span>
                        </div>
                        <div className="flex gap-2" style={{ ...containerStyle, minWidth: 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full p-2 rounded text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', resize: 'vertical', minHeight: '80px', maxHeight: '200px', fontFamily: 'monospace', overflow: 'auto' }} />
                          </div>
                          <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                            <button onClick={saveEdit} disabled={saving} className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50">✅</button>
                            <button onClick={cancelEdit} className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-700">❌</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 rounded hover:bg-panel-primary cursor-pointer transition-colors" onDoubleClick={() => startEditing('worldState', key)} title="Double-click to edit" style={containerStyle}>
                        <span className="text-text-primary font-medium text-xs">{key}:</span>
                        <div className="text-text-secondary text-xs ml-2" style={{ ...containerStyle, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TRACKERS */}
      {hasTrackers && (
        <div className="border border-border-color rounded-lg" style={containerStyle}>
          <SectionHeader title="Trackers" expanded={expandedSections.trackers} onToggle={() => toggleSection('trackers')} />
          {expandedSections.trackers && (
            <div className="p-3 space-y-3 bg-panel-secondary" style={{ ...containerStyle, fontSize: '10px' }}>
              {/* Stats */}
              {sessionContext.trackers.stats && Object.keys(sessionContext.trackers.stats).length > 0 && (
                <div style={containerStyle}>
                  <h4 className="font-medium text-text-primary mb-2">Stats</h4>
                  <div style={containerStyle}>
                    {Object.entries(sessionContext.trackers.stats).map(([key, value], idx, arr) => {
                      const isEditing = editingState.type === 'stat' && editingState.key === key;
                      return (
                        <div key={key} style={{ ...containerStyle, paddingBottom: idx < arr.length - 1 ? '12px' : '0', borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', marginBottom: idx < arr.length - 1 ? '12px' : '0' }}>
                          {isEditing ? (
                            <div className="flex gap-2 items-start" style={{ ...containerStyle, minWidth: 0 }}>
                              <div className="text-right" style={{ minWidth: '70px', flexShrink: 0 }}>
                                <span className="font-medium text-text-primary text-xs">{key}:</span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full p-2 rounded text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', resize: 'vertical', minHeight: '60px', maxHeight: '150px', fontFamily: 'monospace', overflow: 'auto' }} />
                              </div>
                              <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                                <button onClick={saveEdit} disabled={saving} className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50">✅</button>
                                <button onClick={cancelEdit} className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-700">❌</button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded hover:bg-panel-primary cursor-pointer transition-colors" onDoubleClick={() => startEditing('stat', key)} title="Double-click to edit" style={{ ...containerStyle, display: 'flex', gap: '1rem', alignItems: 'flex-start', minWidth: 0 }}>
                              <div className="text-right" style={{ minWidth: '70px', flexShrink: 0 }}>
                                <span className="font-medium text-text-primary text-xs">{key}:</span>
                              </div>
                              <span className="text-text-secondary text-xs" style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                {String(value)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Objectives */}
              {sessionContext.trackers.objectives && sessionContext.trackers.objectives.length > 0 && (
                <div className="border border-border-color rounded" style={containerStyle}>
                  <button onClick={() => setExpandedSections((prev) => ({ ...prev, objectives: !prev.objectives }))} className="w-full flex items-center gap-2 p-2 hover:bg-panel-primary transition-colors font-medium text-text-primary" style={{ ...containerStyle, minWidth: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', transform: expandedSections.objectives ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>Objectives</span>
                  </button>
                  {expandedSections.objectives && (
                    <div className="p-3 border-t border-border-color bg-black bg-opacity-20" style={containerStyle}>
                      {sessionContext.trackers.objectives.map((obj: any, idx: number) => {
                        const objStr = typeof obj === 'string' ? obj : (obj?.description || JSON.stringify(obj));
                        const isEditing = editingState.type === 'objective' && editingState.index === idx;
                        return (
                          <div key={idx} style={{ ...containerStyle, paddingBottom: idx < sessionContext.trackers.objectives.length - 1 ? '12px' : '0', borderBottom: idx < sessionContext.trackers.objectives.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', marginBottom: idx < sessionContext.trackers.objectives.length - 1 ? '12px' : '0' }}>
                            {isEditing ? (
                              <div className="flex gap-2" style={{ ...containerStyle, minWidth: 0 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full p-2 rounded text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', resize: 'vertical', minHeight: '80px', maxHeight: '200px', fontFamily: 'monospace', overflow: 'auto' }} />
                                </div>
                                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                                  <button onClick={saveEdit} disabled={saving} className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50">✅</button>
                                  <button onClick={cancelEdit} className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-700">❌</button>
                                </div>
                              </div>
                            ) : (
                              <div className="hover:bg-panel-primary cursor-pointer transition-colors" onDoubleClick={() => startEditing('objective', undefined, idx)} title="Double-click to edit" style={{ ...containerStyle, display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <span style={{ marginTop: '2px', flexShrink: 0, fontSize: '12px' }}>•</span>
                                <span className="text-text-secondary text-xs" style={{ whiteSpace: 'normal', wordBreak: 'break-word', flex: 1, minWidth: 0 }}>
                                  {objStr}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Relationships */}
              {sessionContext.trackers.relationships && Object.keys(sessionContext.trackers.relationships).length > 0 && (
                <div className="border border-border-color rounded" style={containerStyle}>
                  <button onClick={() => setExpandedSections((prev) => ({ ...prev, relationships: !prev.relationships }))} className="w-full flex items-center gap-2 p-2 hover:bg-panel-primary transition-colors font-medium text-text-primary" style={{ ...containerStyle, minWidth: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', transform: expandedSections.relationships ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>Relationships</span>
                  </button>
                  {expandedSections.relationships && (
                    <div className="p-3 border-t border-border-color bg-black bg-opacity-20" style={containerStyle}>
                      {Object.entries(sessionContext.trackers.relationships).map(([key, value], idx, arr) => {
                        const isEditing = editingState.type === 'relationship' && editingState.key === key;
                        const valueStr = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value);
                        return (
                          <div key={key} style={{ ...containerStyle, paddingBottom: idx < arr.length - 1 ? '12px' : '0', borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', marginBottom: idx < arr.length - 1 ? '12px' : '0' }}>
                            {isEditing ? (
                              <div className="flex gap-2" style={{ ...containerStyle, minWidth: 0 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full p-2 rounded text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', resize: 'vertical', minHeight: '80px', maxHeight: '200px', fontFamily: 'monospace', overflow: 'auto' }} />
                                </div>
                                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                                  <button onClick={saveEdit} disabled={saving} className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50">✅</button>
                                  <button onClick={cancelEdit} className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-700">❌</button>
                                </div>
                              </div>
                            ) : (
                              <div className="cursor-pointer hover:bg-panel-primary rounded transition-colors" onDoubleClick={() => startEditing('relationship', key)} title="Double-click to edit" style={containerStyle}>
                                <span className="font-medium text-text-primary text-xs">{key}:</span>
                                <div className="text-text-secondary text-xs ml-2" style={{ ...containerStyle, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                  {valueStr}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CHARACTER STATES */}
      {hasCharacterStates && (
        <div className="border border-border-color rounded-lg" style={containerStyle}>
          <SectionHeader title="Character States" expanded={expandedSections.characters} onToggle={() => toggleSection('characters')} />
          {expandedSections.characters && (
            <div className="p-3 bg-panel-secondary" style={{ ...containerStyle, fontSize: '10px' }}>
              {Object.entries(sessionContext.scene.characterStates).map(([charName, state]: [string, any]) => (
                <div key={charName} className="border border-border-color rounded" style={containerStyle}>
                  <button onClick={() => toggleCharacter(charName)} className="w-full flex items-center gap-2 p-2 hover:bg-panel-primary font-medium text-text-primary transition-colors" style={{ ...containerStyle, minWidth: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', transform: expandedCharacters[charName] ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{charName}</span>
                  </button>
                  {expandedCharacters[charName] && (
                    <div className="p-3 border-t border-border-color bg-black bg-opacity-20" style={containerStyle}>
                      {Object.entries(state).map(([field, value], idx, arr) => {
                        const isEditing = editingState.type === 'charState' && editingState.charName === charName && editingState.charField === field;
                        return (
                          <div key={field} style={{ ...containerStyle, paddingBottom: idx < arr.length - 1 ? '12px' : '0', borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', marginBottom: idx < arr.length - 1 ? '12px' : '0' }}>
                            {isEditing ? (
                              <div className="flex gap-2 items-start" style={{ ...containerStyle, minWidth: 0 }}>
                                <div className="text-right" style={{ minWidth: '80px', flexShrink: 0 }}>
                                  <span className="font-medium text-text-primary text-xs">{field}:</span>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full p-2 rounded text-xs" style={{ background: 'rgba(0,0,0,0.3)', color: '#e6eef2', border: '1px solid rgba(255,255,255,0.1)', resize: 'vertical', minHeight: '60px', maxHeight: '150px', fontFamily: 'monospace', overflow: 'auto' }} />
                                </div>
                                <div className="flex flex-col gap-1" style={{ flexShrink: 0 }}>
                                  <button onClick={saveEdit} disabled={saving} className="px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50">✅</button>
                                  <button onClick={cancelEdit} className="px-2 py-1 rounded text-xs bg-red-600 hover:bg-red-700">❌</button>
                                </div>
                              </div>
                            ) : (
                              <div className="hover:bg-panel-primary cursor-pointer transition-colors" onDoubleClick={() => startEditing('charState', charName, idx)} title="Double-click to edit" style={{ ...containerStyle, display: 'flex', gap: '1rem', alignItems: 'flex-start', minWidth: 0 }}>
                                <div className="text-right" style={{ minWidth: '80px', flexShrink: 0 }}>
                                  <span className="font-medium text-text-primary text-xs">{field}:</span>
                                </div>
                                <span className="text-text-secondary text-xs" style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                  {String(value)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
