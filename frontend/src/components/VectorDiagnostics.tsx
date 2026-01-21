import React, { useEffect, useMemo, useState } from 'react';

interface ScopeInfo {
  scope: string;
  count: number;
  sizeOnDisk: number;
  lastUpdated?: string;
}

const scrollableBoxStyle: React.CSSProperties = {
  maxHeight: '50vh',
  overflowY: 'auto',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  padding: 8,
  backgroundColor: 'var(--panel-bg)',
};

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

  // Scope action state (browse/delete/revectorize)
  const [selectedScopeAction, setSelectedScopeAction] = useState<string | null>(null);
  const [deleteFilterKey, setDeleteFilterKey] = useState<string>('all');
  const [deleteFilterValue, setDeleteFilterValue] = useState<string>('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [matchedItems, setMatchedItems] = useState<Array<any>>([]);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [page, setPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(20);
  const [fetchTrigger, setFetchTrigger] = useState<number>(0);
  // Inline edit state for matched items
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingMetaStr, setEditingMetaStr] = useState<string>('');

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

  // Fetch paginated matching items when page or fetchTrigger changes
  useEffect(() => {
    let cancelled = false;
    const doFetch = async () => {
      if (!selectedScopeAction) return;
      setDeleteLoading(true);
      setDeleteResult(null);
      try {
        const filterObj = deleteFilterKey === 'all' ? {} : { [deleteFilterKey]: deleteFilterValue };
        const resp = await fetch('/api/debug/vector-list', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: selectedScopeAction, filter: filterObj, limit: pageSize, offset: page * pageSize })
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          if (!cancelled) setDeleteResult(`List failed: ${resp.status} ${txt || ''}`);
          return;
        }
        const body = await resp.json();
        if (cancelled) return;
        setMatchedItems(Array.isArray(body.items) ? body.items : []);
        setTotalMatches(typeof body.totalMatches === 'number' ? body.totalMatches : (body.items ? body.items.length : 0));
      } catch (e: any) {
        if (!cancelled) setDeleteResult(String(e));
      } finally {
        if (!cancelled) setDeleteLoading(false);
      }
    };

    doFetch();
    return () => { cancelled = true; };
  }, [page, fetchTrigger, selectedScopeAction, deleteFilterKey, deleteFilterValue, pageSize]);

  // Reset page to 0 when filter changes to ensure we fetch from start
  useEffect(() => {
    if (!selectedScopeAction) return;
    setPage(0);
    setFetchTrigger((t) => t + 1);
  }, [deleteFilterKey, deleteFilterValue, selectedScopeAction]);

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
          {/* Scope actions: browse / delete by metadata / revectorize */}
          <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
            <strong>Scope Actions</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <label>Scope: <select value={selectedScopeAction || ''} onChange={(e) => setSelectedScopeAction(e.target.value || null)}>
                <option value="">-- select scope --</option>
                {scopes.map((s) => <option key={s.scope} value={s.scope}>{s.scope}</option>)}
              </select></label>

              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Filter:
                <select value={deleteFilterKey} onChange={(e) => setDeleteFilterKey(e.target.value)}>
                  <option value="all">All</option>
                  <option value="sceneId">sceneId</option>
                  <option value="roundId">roundId</option>
                  <option value="campaignId">campaignId</option>
                  <option value="arcId">arcId</option>
                </select>
                <input placeholder="value" value={deleteFilterValue} onChange={(e) => setDeleteFilterValue(e.target.value)} style={{ width: 120 }} />
              </label>

              <button onClick={() => {
                if (!selectedScopeAction) return setDeleteResult('Select a scope first');
                // reset and trigger fetch via effect
                setMatchedItems([]);
                setTotalMatches(0);
                setPage(0);
                setFetchTrigger((t) => t + 1);
              }} disabled={deleteLoading || !selectedScopeAction}>List Matching Items</button>

              <button onClick={async () => {
                if (!selectedScopeAction) return setDeleteResult('Select a scope first');
                if (!window.confirm('Confirm deletion of matching vectors in this scope? This is destructive.')) return;
                setDeleteLoading(true); setDeleteResult(null);
                try {
                  const filterObj = deleteFilterKey === 'all' ? {} : { [deleteFilterKey]: deleteFilterValue };
                  const resp = await fetch('/api/debug/vector-delete', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scope: selectedScopeAction, filter: filterObj, dryRun: false, confirm: true })
                  });
                  const body = await resp.json().catch(() => null);
                  if (resp.ok) {
                    setDeleteResult(body ? JSON.stringify(body) : 'Delete completed');
                    // clear matched items after deletion
                    setMatchedItems([]); setTotalMatches(0);
                  } else {
                    const txt = body ? JSON.stringify(body) : await resp.text().catch(() => null);
                    setDeleteResult(`Error: ${resp.status} ${txt || ''}`);
                  }
                } catch (e: any) { setDeleteResult(String(e)); }
                finally { setDeleteLoading(false); }
              }} disabled={deleteLoading || !selectedScopeAction}>Delete</button>

              <button onClick={async () => {
                // revectorize by scene id if filter is sceneId
                const scene = deleteFilterKey === 'sceneId' ? Number(deleteFilterValue) : null;
                if (!scene) return setDeleteResult('Set Filter key to sceneId and provide a scene id to revectorize');
                setDeleteLoading(true); setDeleteResult(null);
                try {
                  const resp = await fetch('/api/debug/revectorize-scene', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sceneId: scene, clearExisting: true })
                  });
                  const body = await resp.json().catch(() => null);
                  if (resp.ok) setDeleteResult(body ? JSON.stringify(body) : 'Revectorize request accepted');
                  else {
                    const txt = await resp.text().catch(() => null);
                    setDeleteResult(`Error: ${resp.status} ${txt || ''}`);
                  }
                } catch (e: any) { setDeleteResult(String(e)); }
                finally { setDeleteLoading(false); }
              }} disabled={deleteLoading || !selectedScopeAction}>Revectorize Scene</button>
            </div>

            <div style={{ marginTop: 8 }}>
              {deleteLoading && <div>Processing…</div>}
              {deleteResult && <pre style={{ whiteSpace: 'pre-wrap' }}>{deleteResult}</pre>}

                  {totalMatches > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div><strong>Matching Items: {totalMatches}</strong></div>
                      <div style={{ marginTop: 8 }}>
                        <div style={scrollableBoxStyle}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {matchedItems.map((it: any) => (
                              <div key={`${it.scope}-${it.id || it._id || Math.random()}`} style={{ border: '1px solid #ddd', padding: 8, borderRadius: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <div><strong>{it.scope}</strong> <small style={{ color: '#666' }}>{it.id}</small></div>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button onClick={async () => {
                                      if (!window.confirm('Delete this single item?')) return;
                                      try {
                                        const r = await fetch('/api/debug/vector-item-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: it.scope, id: it.id }) });
                                        if (r.ok) {
                                          setMatchedItems((prev) => prev.filter((p) => p.id !== it.id));
                                          setTotalMatches((t) => Math.max(0, t - 1));
                                        } else {
                                          const txt = await r.text().catch(() => null);
                                          setDeleteResult(`Item delete failed: ${r.status} ${txt || ''}`);
                                        }
                                      } catch (e: any) { setDeleteResult(String(e)); }
                                    }}>Delete Item</button>

                                    <button onClick={() => {
                                      // switch to inline edit mode
                                      setEditingItemId(String(it.id));
                                      setEditingText(it.text || '');
                                      setEditingMetaStr(JSON.stringify(it.metadata || {}, null, 2));
                                    }}>Edit Item</button>
                                  </div>
                                </div>
                                <div style={{ marginTop: 6 }}>
                                  <div style={{ color: '#333' }}>
                                    {it.scope} {(() => {
                                      const m = (it.scope || '').match(/_char_(.+)$/);
                                      const charId = m ? m[1] : null;
                                      const charName = charId ? (charactersList.find((c) => String(c.id) === String(charId))?.name || charId) : null;
                                      return charName ? `: ${charName}` : '';
                                    })()}
                                  </div>

                                  {editingItemId === String(it.id) ? (
                                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} style={{ width: '100%', minHeight: 80 }} />
                                      <div>
                                        <label style={{ display: 'block', marginBottom: 6 }}>Metadata (JSON)</label>
                                        <textarea value={editingMetaStr} onChange={(e) => setEditingMetaStr(e.target.value)} style={{ width: '100%', minHeight: 80 }} />
                                      </div>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={async () => {
                                          try {
                                            const parsed = editingMetaStr ? JSON.parse(editingMetaStr) : {};
                                            const r = await fetch('/api/debug/vector-item-update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: it.scope, id: it.id, text: editingText, metadata: parsed }) });
                                            if (r.ok) {
                                              const body = await r.json().catch(() => null);
                                              setMatchedItems((prev) => prev.map((p) => p.id === it.id ? (body && body.item ? body.item : { ...p, text: editingText, metadata: parsed }) : p));
                                              setDeleteResult('Item updated');
                                              setEditingItemId(null);
                                              setEditingText('');
                                              setEditingMetaStr('');
                                            } else {
                                              const txt = await r.text().catch(() => null);
                                              setDeleteResult(`Update failed: ${r.status} ${txt || ''}`);
                                            }
                                          } catch (e: any) {
                                            setDeleteResult(String(e));
                                          }
                                        }} style={{ background: 'green', color: '#fff' }}>✓</button>

                                        <button onClick={() => {
                                          setEditingItemId(null);
                                          setEditingText('');
                                          setEditingMetaStr('');
                                        }} style={{ background: 'red', color: '#fff' }}>✕</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{it.text || JSON.stringify(it.metadata || {})}</div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Prev</button>
                        <div>Page {page + 1} / {Math.max(1, Math.ceil(totalMatches / pageSize))}</div>
                        <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(totalMatches / pageSize) - 1}>Next</button>
                      </div>
                    </div>
                  )}
            </div>
          </div>
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
                <div style={{ marginTop: 8 }}>
                  <div style={scrollableBoxStyle}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
