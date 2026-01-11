import { useState, useEffect } from 'react';
import LoreImport from './components/LoreImport';
import EntryEditor from './components/EntryEditor';
import { IconPlus, IconEdit, IconTrash, IconBook, IconDownload, IconRefresh, IconChevronDown, IconArrowUp, IconArrowDown } from './components/icons';
import RowToggle from './components/RowToggle';

interface Lorebook {
  id?: number | string;
  uuid?: string;
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, any>;
  entries?: any[];
}

function LoreManager({ version }: { version?: number }) {
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [editing, setEditing] = useState<Lorebook | null>(null);
  const [form, setForm] = useState<Partial<Lorebook>>({});
  const [viewing, setViewing] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [entryForm, setEntryForm] = useState<{ title?: string; content?: string }>({});
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<null | { uuid: string; name?: string }>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  const openDeleteForSelected = async () => {
    // prefer explicit selector, fall back to currently viewing
    const id = selectedId || (viewing ? idFor(viewing) : '');
    if (!id) {
      // no-op if nothing selected
      return;
    }
    console.log('[LoreManager] openDeleteForSelected ->', { selectedId, viewingId: viewing ? idFor(viewing) : null, resolved: id });
    const lb = lorebooks.find(x => (x.uuid || String(x.id)) === id);
    const name = lb?.name || id;
    const ok = window.confirm(`Delete lorebook "${name}"? This will remove all entries. Proceed?`);
    if (!ok) return;
    try {
      await handleDelete(id);
    } catch (e) {
      console.warn('Delete request failed', e);
    }
    if (viewing && idFor(viewing) === id) { setViewing(null); setEntries([]); }
    setSelectedId('');
    fetchLorebooks();
  };

  async function fetchLorebooks() {
    const res = await fetch('/api/lorebooks');
    const data = await res.json();
    setLorebooks(data);
  }

  useEffect(() => {
    fetchLorebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when external version changes (e.g., after import)
  useEffect(() => {
    if (typeof version === 'number') fetchLorebooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = String(editing?.uuid || editing?.id || '');
    if (editing && targetId) {
      await fetch(`/api/lorebooks/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/lorebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    fetchLorebooks();
    setEditing(null);
    setForm({});
  };

  const handleEdit = (lb: Lorebook) => {
    setEditing(lb);
    setForm(lb || {});
  };

  const handleDelete = async (id: number | string) => {
    const iid = String(id);
    await fetch(`/api/lorebooks/${encodeURIComponent(iid)}`, { method: 'DELETE' });
    fetchLorebooks();
  };

  

  const idFor = (lb: Lorebook | string | number) => {
    if (!lb) return '';
    if (typeof lb === 'string' || typeof lb === 'number') return String(lb);
    return String((lb as Lorebook).uuid || (lb as Lorebook).id || '');
  };

  const fetchEntries = async (lb: Lorebook) => {
    const id = idFor(lb);
    if (!id) return setEntries([]);
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(id)}/entries`);
      if (!res.ok) return setEntries([]);
      const data = await res.json();
      setEntries(data || []);
    } catch (e) {
      setEntries([]);
    }
  };

  const handleViewEntries = async (lb: Lorebook) => {
    setViewing(lb);
    // ensure selector matches the viewed lorebook so Delete Book button is enabled
    setSelectedId(idFor(lb));
    await fetchEntries(lb);
  };

  const [editingEntry, setEditingEntry] = useState<any | null>(null);

  const handleEditEntry = (en: any) => {
    setEditingEntry(en);
  };

  const handleEntrySaved = async (updated: any) => {
    // refresh entries
    if (viewing) await fetchEntries(viewing);
    setEditingEntry(null);
  };

  const handleEntryDeleted = async () => {
    if (viewing) await fetchEntries(viewing);
    setEditingEntry(null);
  };

  const handleExport = async (lb: Lorebook) => {
    const id = idFor(lb);
    if (!id) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(id)}/export`);
      if (!res.ok) {
        alert('Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const name = lb.name || `lorebook-${id}`;
      a.download = `${name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed');
    }
  };

  const handleAddEntry = async (lb: Lorebook) => {
    const id = idFor(lb);
    if (!id) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(id)}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: entryForm.title || '', content: entryForm.content || '' }) });
      if (!res.ok) {
        alert('Failed to add entry');
        return;
      }
      setEntryForm({});
      await fetchEntries(lb);
    } catch (e) { alert('Failed to add entry'); }
  };

  const handleDeleteEntry = async (lb: Lorebook, entryId: number | string) => {
    const id = idFor(lb);
    if (!id) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(id)}/entries/${entryId}`, { method: 'DELETE' });
      if (!res.ok) { alert('Failed to delete entry'); return; }
      await fetchEntries(lb);
    } catch (e) { alert('Failed to delete entry'); }
  };

  return (
    <div className="manager p-4 text-gray-100 bg-gray-900 min-h-[60vh] rounded-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">World Info / Lorebooks</h2>
        <div className="flex items-center gap-2">
          <button className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded flex items-center gap-2" onClick={() => setShowNewModal(true)}><IconPlus className="w-4 h-4" />New</button>
          <select className="bg-gray-800 text-gray-100 px-3 py-1 rounded" value={selectedId} onChange={(e) => {
            const id = e.target.value; setSelectedId(id);
            const lb = lorebooks.find(x => (x.uuid || String(x.id)) === id);
            if (lb) { setViewing(lb); fetchEntries(lb); }
          }}>
            <option value="">Select lorebook...</option>
            {lorebooks.map(l => <option key={idFor(l)} value={idFor(l)}>{l.name}</option>)}
          </select>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded flex items-center gap-2" onClick={() => fetchLorebooks()}><IconRefresh className="w-4 h-4" />Refresh</button>
          <button title="Delete selected lorebook" disabled={!selectedId && !viewing} className={`ml-2 px-3 py-1 rounded ${selectedId || viewing ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-400'}`} onClick={openDeleteForSelected}>Delete Book</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded p-3">
          <LoreImport onImported={() => fetchLorebooks()} />

          <div className="mt-4 space-y-3">
            {lorebooks.map((lb) => (
              <div key={idFor(lb)} className="flex items-center justify-between bg-gray-700/40 p-3 rounded">
                <div>
                  <div className="text-lg font-medium">{lb.name}</div>
                  <div className="text-sm text-gray-400">{lb.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button title="Edit" className="px-2 py-1 bg-yellow-600/80 rounded flex items-center gap-1" onClick={() => handleEdit(lb)}><IconEdit className="w-4 h-4" /></button>
                  <button title="Delete" className="px-2 py-1 bg-red-700/90 rounded flex items-center gap-1" onClick={() => setDeleteTarget({ uuid: idFor(lb), name: lb.name })}><IconTrash className="w-4 h-4" /></button>
                  <button title="View entries" className="px-2 py-1 bg-indigo-600/90 rounded flex items-center gap-1" onClick={() => handleViewEntries(lb)}><IconBook className="w-4 h-4" /></button>
                  <button title="Export" className="px-2 py-1 bg-slate-600/80 rounded flex items-center gap-1" onClick={() => handleExport(lb)}><IconDownload className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800 rounded p-3">
          {editing ? (
            <div>
              <div className="text-lg font-semibold mb-2">Edit Lorebook</div>
              <form onSubmit={handleSubmit}>
                <input className="w-full p-2 bg-gray-700 text-gray-100 rounded" type="text" placeholder="Name" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <textarea className="w-full p-2 bg-gray-700 text-gray-100 rounded mt-2" placeholder="Description" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                <div className="flex gap-2 mt-2">
                  <input className="p-2 bg-gray-700 text-gray-100 rounded w-1/2" type="number" placeholder="Scan Depth" value={form.scan_depth || 0} onChange={(e) => setForm({ ...form, scan_depth: +e.target.value })} />
                  <input className="p-2 bg-gray-700 text-gray-100 rounded w-1/2" type="number" placeholder="Token Budget" value={form.token_budget || 0} onChange={(e) => setForm({ ...form, token_budget: +e.target.value })} />
                </div>
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={form.recursive_scanning || false} onChange={(e) => setForm({ ...form, recursive_scanning: e.target.checked })} />
                  <span className="text-sm">Recursive Scanning</span>
                </label>
                <div className="flex gap-2 mt-3">
                  <button className="bg-green-600 px-3 py-1 rounded text-white" type="submit">{editing ? 'Update' : 'Create'}</button>
                  {editing && <button className="bg-gray-600 px-3 py-1 rounded" type="button" onClick={() => { setEditing(null); setForm({}); }}>Cancel</button>}
                </div>
              </form>
            </div>
          ) : (
            <div className="text-gray-400">Select a lorebook and click "View Entries" to edit entries, or create a new lorebook.</div>
          )}
        </div>
      </div>

      {viewing && (
        <div className="mt-4 bg-gray-800 p-3 rounded">
          <div className="flex items-center justify-between">
            <h3 className="text-xl">Entries for: {viewing.name}</h3>
            <div className="flex items-center gap-2">
              <input className="p-2 bg-gray-700 text-gray-100 rounded" placeholder="Entry title" value={entryForm.title || ''} onChange={(e) => setEntryForm({ ...entryForm, title: e.target.value })} />
              <input className="p-2 bg-gray-700 text-gray-100 rounded" placeholder="Entry content" value={entryForm.content || ''} onChange={(e) => setEntryForm({ ...entryForm, content: e.target.value })} />
              <button className="bg-green-600 px-3 py-1 rounded" onClick={() => handleAddEntry(viewing)}>Add</button>
              <button className="bg-gray-600 px-3 py-1 rounded" onClick={() => { setViewing(null); setEntries([]); }}>Close</button>
            </div>
          </div>
          <ul className="mt-3 space-y-3">
            {entries.map((en: any) => (
              <li key={en.id || en.entryId || JSON.stringify(en).slice(0, 16)} className="bg-gray-700/30 p-2 rounded">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 w-36">
                    <RowToggle enabled={!!(en.enabled === 1 || en.enabled === true)} onToggle={async (next) => {
                      const id = idFor(viewing);
                      try {
                        await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries/${encodeURIComponent(String(en.id || en.uid || en.entryId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...en, enabled: next ? 1 : 0 }) });
                        await fetchEntries(viewing);
                      } catch {}
                    }} />
                    <div>
                      <div className="text-lg font-semibold">{en.title || en.name || (Array.isArray(en.key) ? en.key.join(',') : en.key) || 'Untitled'}</div>
                      <div className="text-sm text-gray-400">UID: {en.uid || en.id}</div>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="text-sm text-gray-200">{(en.content || en.body || en.text || '').slice(0, 300)}</div>
                  </div>

                  <div className="flex items-center gap-2 w-56">
                    <div className="text-sm text-gray-300 text-center w-20">
                      <div className="text-xs text-gray-400">Depth</div>
                      <div>{en.depth ?? en.scanDepth ?? '-'}</div>
                    </div>
                    <div className="text-sm text-gray-300 text-center w-24">
                      <div className="text-xs text-gray-400">Order</div>
                      <div className="flex items-center gap-1 justify-center">
                        <button title="Move up" className="p-1 bg-gray-700 rounded" onClick={async () => {
                          const id = idFor(viewing);
                          const nextOrder = (en.insertion_order ?? en.order ?? 0) - 10;
                          await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries/${encodeURIComponent(String(en.id || en.uid || en.entryId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...en, insertion_order: nextOrder }) });
                          await fetchEntries(viewing);
                        }}><IconArrowUp className="w-4 h-4" /></button>
                        <div className="px-2">{en.insertion_order ?? en.order ?? 0}</div>
                        <button title="Move down" className="p-1 bg-gray-700 rounded" onClick={async () => {
                          const id = idFor(viewing);
                          const nextOrder = (en.insertion_order ?? en.order ?? 0) + 10;
                          await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries/${encodeURIComponent(String(en.id || en.uid || en.entryId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...en, insertion_order: nextOrder }) });
                          await fetchEntries(viewing);
                        }}><IconArrowDown className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="text-sm text-gray-300 text-center w-20">
                      <div className="text-xs text-gray-400">Trigger %</div>
                      <div>{en.probability ?? en.trigger_percent ?? '-'}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button className="bg-slate-600 px-2 py-1 rounded" onClick={() => navigator.clipboard?.writeText(en.content || en.body || en.text || '')}>Copy</button>
                      <button className="bg-yellow-600 px-2 py-1 rounded" onClick={() => handleEditEntry(en)}>Edit</button>
                      <button className="bg-red-700 px-2 py-1 rounded" onClick={() => handleDeleteEntry(viewing, en.id || en.entryId || en.uid || '')}>Delete</button>
                    </div>
                  </div>

                </div>

                {editingEntry && (editingEntry.id || editingEntry.uid) === (en.id || en.uid) && (
                  <div className="mt-3">
                    <EntryEditor entry={editingEntry} lorebookId={idFor(viewing)} onSaved={handleEntrySaved} onDeleted={handleEntryDeleted} onCancel={() => setEditingEntry(null)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60" style={{ zIndex: 9999 }}>
          <div className="bg-gray-900 rounded p-6 w-full max-w-md">
            <h3 className="text-xl mb-3">Create a new Lorebook</h3>
            <input className="w-full p-2 bg-gray-800 text-gray-100 rounded" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Lorebook Name" />
            <div className="mt-4 flex justify-end gap-2">
              <button className="bg-gray-600 px-3 py-1 rounded" onClick={() => { setShowNewModal(false); setNewName(''); }}>Cancel</button>
              <button className="bg-green-600 px-3 py-1 rounded" onClick={async () => {
                await fetch('/api/lorebooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) });
                setShowNewModal(false); setNewName(''); fetchLorebooks();
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60" style={{ zIndex: 9999 }}>
          <div className="bg-gray-900 rounded p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">Delete Lorebook</h3>
            <p className="text-sm text-gray-300">Are you sure you want to delete <strong className="text-white">{deleteTarget.name || deleteTarget.uuid}</strong>? This will remove all entries.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="bg-gray-600 px-3 py-1 rounded" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="bg-red-700 px-3 py-1 rounded" onClick={async () => {
                console.log('[LoreManager] confirm delete ->', deleteTarget);
                try {
                  await fetch(`/api/lorebooks/${encodeURIComponent(String(deleteTarget.uuid))}`, { method: 'DELETE' });
                } catch (e) { console.warn('Delete request failed', e); }
                setDeleteTarget(null);
                fetchLorebooks();
                if (viewing && idFor(viewing) === deleteTarget.uuid) { setViewing(null); setEntries([]); }
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoreManager;