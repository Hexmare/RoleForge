import React, { useState, useEffect } from 'react';

interface Memory {
  text: string;
  similarity: number;
  characterName: string;
  scope: string;
  metadata?: any;
}

interface DebugVectorPanelProps {
  // No props needed - it's a full-screen tab like LoreManager
}

const DebugVectorPanel: React.FC<DebugVectorPanelProps> = () => {
  const [worlds, setWorlds] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [selectedWorld, setSelectedWorld] = useState<string>('');
  const [selectedScene, setSelectedScene] = useState<string>('');
  const [selectedCharacter, setSelectedCharacter] = useState<string>('all');
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRevectorizing, setIsRevectorizing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Load worlds and characters on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const worldRes = await fetch('/api/worlds');
        const worldData = await worldRes.json();
        // Filter out test world (9999999)
        const userWorlds = (worldData.worlds || worldData || []).filter((w: any) => w.id !== 9999999);
        setWorlds(userWorlds);
        
        // Set default selected world
        if (userWorlds.length > 0) {
          setSelectedWorld(String(userWorlds[0].id));
        }

        const charRes = await fetch('/api/characters');
        const charData = await charRes.json();
        setCharacters(charData.characters || charData || []);
      } catch (err) {
        console.error('Failed to load worlds/characters:', err);
      }
    };

    loadData();
  }, []);

  // Fetch scenes when world is selected
  useEffect(() => {
    if (selectedWorld && selectedWorld !== 'all') {
      const fetchScenes = async () => {
        try {
          const res = await fetch(`/api/worlds/${selectedWorld}/campaigns`);
          if (!res.ok) throw new Error('Failed to fetch campaigns');
          
          const campaigns = await res.json();
          
          // Fetch arcs and scenes for all campaigns
          const allScenes: any[] = [];
          for (const campaign of campaigns) {
            const arcRes = await fetch(`/api/campaigns/${campaign.id}/arcs`);
            if (arcRes.ok) {
              const arcs = await arcRes.json();
              for (const arc of arcs) {
                const sceneRes = await fetch(`/api/arcs/${arc.id}/scenes`);
                if (sceneRes.ok) {
                  const sceneList = await sceneRes.json();
                  allScenes.push(...sceneList);
                }
              }
            }
          }
          
          setScenes(allScenes);
          setSelectedScene(''); // Reset scene selection when world changes
        } catch (err) {
          console.error('Failed to load scenes:', err);
          setScenes([]);
        }
      };

      fetchScenes();
    } else {
      setScenes([]);
      setSelectedScene('');
    }
  }, [selectedWorld]);

  const handleQuery = async () => {
    if (!query.trim()) {
      setError('Please enter a query');
      return;
    }

    setError('');
    setIsLoading(true);
    console.log('[DEBUG] Starting query:', { query, selectedWorld, selectedCharacter });

    try {
      const payload = {
        query: query.trim(),
        worldId: selectedWorld === 'all' || !selectedWorld ? null : parseInt(selectedWorld),
        characterId: selectedCharacter === 'all' ? null : selectedCharacter,
        characterName: null,
        includeMultiCharacter: false,
      };
      console.log('[DEBUG] Payload:', payload);

      const response = await fetch('/api/debug/vector-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('[DEBUG] Response status:', response.status);

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[DEBUG] Query result:', data);
      
      setResults(data.memories || []);
      console.log('[DEBUG] Results set to:', data.memories);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[DEBUG] Query failed:', errorMsg);
      setError(`Query failed: ${errorMsg}`);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevectorize = async () => {
    if (!selectedScene) {
      setError('Please select a scene first');
      return;
    }

    setError('');
    setIsRevectorizing(true);
    console.log('[DEBUG] Starting revectorization for scene:', selectedScene);

    try {
      const response = await fetch('/api/debug/revectorize-scene', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneId: parseInt(selectedScene),
          clearExisting: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[DEBUG] Revectorization result:', data);
      
      if (data.status === 'complete') {
        setError(`✓ Revectorized ${data.roundsProcessed} rounds, stored ${data.memoriesStored} memories`);
      } else if (data.error) {
        setError(`Revectorization error: ${data.error}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[DEBUG] Revectorization failed:', errorMsg);
      setError(`Revectorization failed: ${errorMsg}`);
    } finally {
      setIsRevectorizing(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-border-color bg-panel-secondary/50">
        <h1 className="text-2xl font-bold text-text-primary mb-4">🔍 Vector Memory Debug</h1>
        
        {/* Controls */}
        <div className="space-y-3">
          {/* Memory Query Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text-secondary">Query Memories</h3>
            <div className="grid grid-cols-5 gap-3">
              {/* World Selector */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-secondary">World</label>
                <select
                  value={selectedWorld}
                  onChange={(e) => setSelectedWorld(e.target.value)}
                  className="px-3 py-2 rounded bg-panel-primary border border-border-color text-text-primary text-sm"
                >
                  <option value="">-- Select World --</option>
                  {worlds && Array.isArray(worlds) && worlds.map((w) => (
                    <option key={w.id} value={String(w.id)}>
                      {w.name} ({w.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Character Selector */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-secondary">Character</label>
                <select
                  value={selectedCharacter}
                  onChange={(e) => setSelectedCharacter(e.target.value)}
                  className="px-3 py-2 rounded bg-panel-primary border border-border-color text-text-primary text-sm"
                >
                  <option value="all">All Characters</option>
                  {characters && Array.isArray(characters) && characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Query Input and Button */}
              <div className="flex items-end gap-2 col-span-3">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleQuery()}
                  placeholder="Enter query..."
                  className="flex-1 px-3 py-2 rounded bg-panel-primary border border-border-color text-text-primary text-sm placeholder-text-tertiary"
                />
                <button
                  onClick={handleQuery}
                  disabled={isLoading}
                  className="px-4 py-2 rounded bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {isLoading ? '...' : 'Query'}
                </button>
              </div>
            </div>
          </div>

          {/* Revectorization Section */}
          <div className="space-y-2 pt-3 border-t border-border-color">
            <h3 className="text-sm font-semibold text-text-secondary">Revectorize Scene</h3>
            <div className="grid grid-cols-3 gap-3">
              {/* Scene Selector */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-secondary">Scene</label>
                <select
                  value={selectedScene}
                  onChange={(e) => setSelectedScene(e.target.value)}
                  className="px-3 py-2 rounded bg-panel-primary border border-border-color text-text-primary text-sm"
                >
                  <option value="">-- Select Scene --</option>
                  {scenes && Array.isArray(scenes) && scenes.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.title} (#{s.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Revectorize Button */}
              <div className="flex items-end">
                <button
                  onClick={handleRevectorize}
                  disabled={!selectedScene || isRevectorizing}
                  className="w-full px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {isRevectorizing ? 'Revectorizing...' : '↻ Revectorize'}
                </button>
              </div>

              <div className="text-xs text-text-tertiary flex items-end pb-2">
                {selectedScene ? `Scene #${selectedScene} selected` : 'Select a scene to revectorize'}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-sm text-red-400 bg-red-900/20 p-3 rounded border border-red-700/50">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Results Display */}
      <div className="flex-1 overflow-auto p-6">
        {results.length === 0 ? (
          <div className="text-text-tertiary text-center py-12">
            {isLoading ? (
              <div className="space-y-2">
                <div className="text-lg">Querying vector store...</div>
                <div className="text-sm text-text-secondary">This may take a moment</div>
              </div>
            ) : (
              <div>Enter a query and click the Query button to search memories.</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-text-secondary font-medium sticky top-0 bg-panel-primary/80 backdrop-blur py-2">
              Found {results.length} memories:
            </div>
            {results.map((mem, idx) => (
              <div
                key={idx}
                className="bg-panel-secondary rounded-lg p-4 border border-border-color space-y-3 hover:border-accent-primary/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-accent-primary bg-panel-tertiary px-2.5 py-1 rounded min-w-fit">
                      #{idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-text-primary">
                      {mem.characterName}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded bg-accent-primary/20 text-accent-primary font-medium">
                      {((mem.similarity || 0) * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <span className="text-xs text-text-tertiary bg-panel-tertiary px-2.5 py-1 rounded">
                    {mem.scope}
                  </span>
                </div>
                <div className="text-sm text-text-primary bg-panel-tertiary rounded p-3 leading-relaxed border-l-2 border-accent-primary">
                  {mem.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugVectorPanel;
