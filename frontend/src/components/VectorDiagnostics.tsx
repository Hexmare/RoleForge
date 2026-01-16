import React, { useEffect, useMemo, useState } from 'react';

interface ScopeInfo {
  scope: string;
  count: number;
  sizeOnDisk: number;
  lastUpdated?: string;
}

export const VectorDiagnostics: React.FC = () => {
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tabs: "diagnostics" | "search" | "revectorize"
  const [tab, setTab] = useState<'diagnostics' | 'search' | 'revectorize'>('diagnostics');

  // Search tab state
  const [selectedWorld, setSelectedWorld] = useState<string | 'all'>('all');
  const [selectedCharacter, setSelectedCharacter] = useState<string | 'all'>('all');
  const [queryText, setQueryText] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ text: string; characterName?: string; similarity?: number }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Revectorize tab state
  const [scenes, setScenes] = useState<Array<{ id: string; name?: string; description?: string }>>([]);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [revectorizeLoading, setRevectorizeLoading] = useState(false);
  const [revectorizeResult, setRevectorizeResult] = useState<string | null>(null);
  // Character and world lists from backend
  const [charactersList, setCharactersList] = useState<Array<{ id: string; name: string }>>([]);
  const [worldsList, setWorldsList] = useState<Array<{ id: string; name?: string }>>([]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/diagnostics/vector')
      .then((r) => r.json())
      .then((data) => {
        setScopes(Array.isArray(data.scopes) ? data.scopes : []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

    // try to load scenes, characters and worlds for the tabs (best-effort)
    const loadAux = async () => {
      // Load scenes from the scenes endpoint (preferred).
      try {
        const resp = await fetch('/api/scenes');
        if (resp.ok) {
          const d = await resp.json();
          if (Array.isArray(d)) setScenes(d.map((s: any) => ({ id: String(s.id || s._id || s), name: s.title || s.name || String(s.id || s._id || s), description: s.description })));
        }
      } catch {}

      try {
        const cResp = await fetch('/api/characters');
        if (cResp.ok) {
          const d = await cResp.json();
          if (Array.isArray(d)) setCharactersList(d.map((c: any) => ({ id: c.id || c.uuid || String(c.id || c.uuid || c.name), name: c.name || c.displayName || String(c.id) })));
        }
      } catch {}

      try {
        const wResp = await fetch('/api/worlds');
        if (wResp.ok) {
          const d = await wResp.json();
          if (Array.isArray(d)) setWorldsList(d.map((w: any) => ({ id: String(w.id), name: w.name })));
        }
      } catch {}
    };

    loadAux().catch(() => {});
  }, []);

  const worlds = useMemo(() => {
    const set = new Set<string>();
    for (const s of scopes) {
      const m = s.scope.match(/^world_([^_]+)_char_/);
      if (m) set.add(m[1]);
    }
    return Array.from(set).sort();
  }, [scopes]);

  const characters = useMemo(() => {
    const set = new Set<string>();
    for (const s of scopes) {
      const m = s.scope.match(/_char_(.+)$/);
      if (m) set.add(m[1]);
    }
    return Array.from(set).sort();
  }, [scopes]);

  async function runSearch() {
    setSearchError(null);
    setSearchResults([]);
    setSearchLoading(true);

    // Prefer backend search endpoint if available
    try {
      const params: any = { query: queryText };
      if (selectedWorld && selectedWorld !== 'all') params.worldId = selectedWorld;
      if (selectedCharacter && selectedCharacter !== 'all') {
        params.characterId = selectedCharacter;
        const found = charactersList.find((c) => c.id === selectedCharacter);
        if (found) params.characterName = found.name;
      }
      params.includeMultiCharacter = false;

      // Use debug vector query endpoint present on the backend
      const resp = await fetch('/api/debug/vector-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        setSearchError(`Search failed: ${resp.status} ${txt}`);
        return;
      }

      const body = await resp.json();
      const items = Array.isArray(body.memories) ? body.memories : [];
      const mapped = items.map((m: any) => ({
        text: m?.text || m?.content || JSON.stringify(m || ''),
        characterName: m?.characterName || (m?.metadata && (m.metadata.characterName || m.metadata.speaker)) || 'unknown',
        similarity: typeof m?.similarity === 'number' ? m.similarity : (m?.score || 0)
      }));
      setSearchResults(mapped);
      return;
    } catch (e: any) {
      setSearchError(String(e));
    } finally {
      setSearchLoading(false);
    }
  }

  async function regenerateScene() {
    if (!selectedScene) {
      setRevectorizeResult('Please select a scene.');
      return;
    }
    setRevectorizeLoading(true);
    setRevectorizeResult(null);
    try {
      const resp = await fetch('/api/debug/revectorize-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: Number(selectedScene), clearExisting: true }),
      });
      if (resp.ok) {
        const body = await resp.json().catch(() => null);
        setRevectorizeResult(body ? JSON.stringify(body) : 'Revectorize request accepted.');
      } else {
        const txt = await resp.text();
        setRevectorizeResult(`Error: ${resp.status} ${txt}`);
      }
    } catch (e: any) {
      setRevectorizeResult(String(e));
    } finally {
      setRevectorizeLoading(false);
    }
  }

  if (loading) return <div>Loading vector diagnostics…</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h3>Vector Store Diagnostics</h3>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => setTab('diagnostics')} style={{ fontWeight: tab === 'diagnostics' ? 'bold' : 'normal' }}>Diagnostics</button>
        <button onClick={() => setTab('search')} style={{ fontWeight: tab === 'search' ? 'bold' : 'normal' }}>Search</button>
        <button onClick={() => setTab('revectorize')} style={{ fontWeight: tab === 'revectorize' ? 'bold' : 'normal' }}>Revectorize</button>
      </div>

      {tab === 'diagnostics' && (
        <div style={{ marginTop: 12 }}>
          <div>Total scopes: {scopes.length}</div>
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Scope</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th style={{ textAlign: 'right' }}>Size (KB)</th>
                <th style={{ textAlign: 'right' }}>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {scopes.map((s) => (
                <tr key={s.scope}>
                  <td>{s.scope}</td>
                  <td style={{ textAlign: 'right' }}>{s.count}</td>
                  <td style={{ textAlign: 'right' }}>{Math.round((s.sizeOnDisk || 0) / 1024)}</td>
                  <td style={{ textAlign: 'right' }}>{s.lastUpdated || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'search' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>World: <select value={selectedWorld} onChange={(e) => setSelectedWorld(e.target.value as any)}>
              <option value="all">All</option>
              {worlds.map((w) => <option key={w} value={w}>{w}</option>)}
            </select></label>

            <label>Character: <select value={selectedCharacter} onChange={(e) => setSelectedCharacter(e.target.value as any)}>
              <option value="all">All</option>
              {charactersList.length > 0
                ? charactersList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                : characters.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>

            <input style={{ flex: 1 }} placeholder="Search vectors..." value={queryText} onChange={(e) => setQueryText(e.target.value)} />
            <button onClick={runSearch} disabled={searchLoading || !queryText}>Search</button>
          </div>

          <div style={{ marginTop: 12 }}>
            {searchLoading && <div>Searching…</div>}
            {searchError && <div style={{ color: 'red' }}>{searchError}</div>}
            {searchResults.length > 0 && (
              <div>
                <div>Results ({searchResults.length})</div>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {searchResults.map((r, i) => (
                    <div key={i} style={{ border: '1px solid #ddd', padding: 8, borderRadius: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div><strong>{r.characterName || 'unknown'}</strong></div>
                        <div style={{ color: '#666' }}>{typeof r.similarity === 'number' ? `${(r.similarity * 100).toFixed(2)}%` : '-'}</div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!searchLoading && !searchError && searchResults.length === 0 && <div style={{ marginTop: 8, color: '#666' }}>No results yet.</div>}
          </div>
        </div>
      )}

      {tab === 'revectorize' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>Scene: <select value={selectedScene || ''} onChange={(e) => setSelectedScene(e.target.value || null)}>
              <option value="">-- select scene --</option>
              {scenes.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
            </select></label>
            <button onClick={regenerateScene} disabled={revectorizeLoading || !selectedScene}>Regenerate Vectors</button>
          </div>
          <div style={{ marginTop: 12 }}>
            {revectorizeLoading && <div>Submitting regenerate request…</div>}
            {revectorizeResult && <pre style={{ whiteSpace: 'pre-wrap' }}>{revectorizeResult}</pre>}
            {!revectorizeLoading && !revectorizeResult && <div style={{ color: '#666' }}>Select a scene and click regenerate to request revectorization.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default VectorDiagnostics;
