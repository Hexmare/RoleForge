import { useState, useEffect } from 'react';
import LoreImport from './components/LoreImport';
import './components/entryEditor.css';
import EntryEditor from './components/EntryEditor';
import { IconPlus, IconEdit, IconTrash, IconBook, IconDownload, IconRefresh, IconArrowUp, IconArrowDown } from './components/icons';
import RowToggle from './components/RowToggle';

interface Lorebook {
  id?: number;
  uuid?: string;
  name?: string;
  description?: string;
}

function LoreManager({ version }: { version?: number }) {
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [viewing, setViewing] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<any[]>([]);

  const [editing, setEditing] = useState<Lorebook | null>(null);
  const [form, setForm] = useState<any>({});

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const [entryForm, setEntryForm] = useState<any>({});
  const [editingEntry, setEditingEntry] = useState<any | null>(null);

  useEffect(() => {
    fetchLorebooks();
  }, [version]);

  const fetchLorebooks = async () => {
    try {
      const res = await fetch('/api/lorebooks');
      if (!res.ok) return setLorebooks([]);
      const data = await res.json();
      setLorebooks(data || []);
    } catch (e) {
      setLorebooks([]);
    }
  };

  const idFor = (lb: Lorebook | string | number | null) => {
    if (!lb) return '';
    if (typeof lb === 'string' || typeof lb === 'number') return String(lb);
    return String(lb.uuid || lb.id || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = String(editing?.uuid || editing?.id || '');
    try {
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
    } catch (err) {
      console.warn('submit failed', err);
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
    if (!confirm('Delete lorebook and all entries?')) return;
    try {
      await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    } catch (e) {}
    // If the deleted lorebook is currently being viewed, clear viewing and entries
    if (viewing && idFor(viewing) === String(id)) {
      setViewing(null);
      setEntries([]);
    }
    fetchLorebooks();
  };

  const fetchEntries = async (lb: Lorebook | null) => {
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
    setSelectedId(idFor(lb));
    await fetchEntries(lb);
  };

  const handleAddEntry = async (lb: Lorebook) => {
    const id = idFor(lb);
    if (!id) return;
    try {
      await fetch(`/api/lorebooks/${encodeURIComponent(id)}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: entryForm.title || '', content: entryForm.content || '' }) });
      setEntryForm({});
      await fetchEntries(lb);
    } catch (e) { alert('Failed to add entry'); }
  };

  const handleDeleteEntry = async (lb: Lorebook, entryId: number | string) => {
    const id = idFor(lb);
    if (!id) return;
    try {
      await fetch(`/api/lorebooks/${encodeURIComponent(id)}/entries/${entryId}`, { method: 'DELETE' });
      await fetchEntries(lb);
    } catch (e) { alert('Failed to delete entry'); }
  };

  const handleEditEntry = (en: any) => setEditingEntry(en);

  const handleEntrySaved = async (updated: any) => {
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
      if (!res.ok) { alert('Export failed'); return; }
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
    } catch (e) { alert('Export failed'); }
  };

  return (
    <div className="manager p-4 text-gray-100 bg-gray-900 min-h-[60vh] rounded-md">
      <div className="w-full mb-4">
        <div className="flex-container alignitemscenter w-full max-w-5xl mx-auto flex flex-col">
          {/* Top header row: New, or, dropdown, icons */}
          <div className="flex-container alignitemscenter w-full justify-center gap-2 mb-2">
            <button title="New lorebook" className="menu_button square" onClick={() => { setShowNewModal(true); }}>
              <span className="icon"><IconPlus className="w-5 h-5" /></span>
            </button>
            <small className="mx-2 text-gray-400">or</small>
            <select
              className="text_pole select2-hidden-accessible"
              style={{height: '32px'}} value={selectedId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedId(id);
                if (!id) {
                  setViewing(null);
                  setEntries([]);
                  return;
                }
                const lb = lorebooks.find(x => (x.uuid || String(x.id)) === id);
                if (lb) {
                  setViewing(lb);
                  fetchEntries(lb);
                }
              }}
            >
              <option value="">--- Pick to Edit ---</option>
              {lorebooks.map(l => <option key={idFor(l)} value={idFor(l)}>{l.name}</option>)}
            </select>
            <input
              id="lorebook-import-input"
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                try {
                  const res = await fetch('/api/lorebooks/import', { method: 'POST', body: fd });
                  if (!res.ok) throw new Error('Import failed');
                  await fetchLorebooks();
                } catch (err) {
                  alert('Import failed');
                }
                e.target.value = '';
              }}
            />
            <button
              title="Import lorebook"
              className="menu_button square"
              onClick={() => {
                const input = document.getElementById('lorebook-import-input') as HTMLInputElement;
                if (input) input.click();
              }}
            >
              <span className="icon"><IconDownload className="w-5 h-5" /></span>
            </button>
            <button title="Export lorebook" className="menu_button square" onClick={() => { if (viewing) handleExport(viewing); else console.log('Export: no viewing selected'); }}><span className="icon"><IconDownload className="w-5 h-5" /></span></button>
            <button title="Rename lorebook" className="menu_button square" onClick={() => { console.log('Rename lorebook'); }}><span className="icon"><IconEdit className="w-5 h-5" /></span></button>
            <button title="Duplicate lorebook" className="menu_button square" onClick={() => { console.log('Duplicate lorebook'); }}><span className="icon"><IconPlus className="w-5 h-5" /></span></button>
            <button title="Delete lorebook" className="menu_button square redWarningBG" onClick={() => { if (selectedId) handleDelete(selectedId); else if (viewing) handleDelete(idFor(viewing)); else console.log('Delete: no selection'); }}><span className="icon"><IconTrash className="w-5 h-5" /></span></button>
          </div>

          {/* Second header row: entry controls, icons, search, sort, pagination */}
          <div className="flex-container alignitemscenter w-full justify-center gap-2">
            <button title="New Entry" className="menu_button square" onClick={() => setEditingEntry({ title_memo: '', content: '' })}><span className="icon"><IconPlus className="w-5 h-5" /></span></button>
            <button title="Expand all entries" className="menu_button square" onClick={() => { console.log('Expand all entries'); }}><span className="icon"><IconArrowDown className="w-5 h-5" /></span></button>
            <button title="Collapse all entries" className="menu_button square" onClick={() => { console.log('Collapse all entries'); }}><span className="icon"><IconArrowUp className="w-5 h-5" /></span></button>
            <button title="Fill empty memo/titles" className="menu_button square" onClick={() => { console.log('Backfill memos'); }}><span className="icon"><IconBook className="w-5 h-5" /></span></button>
            <button title="Apply current sorting as Order" className="menu_button square" onClick={() => { console.log('Apply sorting as order'); }}><span className="icon"><IconArrowDown className="w-5 h-5" /></span></button>
            <button title="Configure STLO" className="menu_button square" onClick={() => { console.log('Configure STLO'); }}><span className="icon"><IconBook className="w-5 h-5" /></span></button>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: '300px', maxWidth: '100%', gap: '0', margin: '0 4px' }}>
              <div style={{ flex: '1 1 180px', minWidth: '120px', maxWidth: '500px', display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                <label style={{ fontSize: '12px', color: '#bfcbd1', marginRight: '6px', whiteSpace: 'nowrap' }}>Search</label>
                <input type="search" placeholder="Search..." className="text_pole textarea_compact" style={{ width: '100%', height: '32px', fontSize: '13px' }} onChange={(e) => { /* keep local only */ console.log('search', e.target.value); }} />
              </div>
              <div style={{ width: '240px', minWidth: '240px', maxWidth: '240px', display: 'flex', flexDirection: 'row', alignItems: 'center', marginLeft: '4px' }}>
                <label style={{ fontSize: '12px', color: '#bfcbd1', marginRight: '6px', whiteSpace: 'nowrap' }}>Sort</label>
                <select className="text_pole textarea_compact" style={{ width: '100%', height: '32px', fontSize: '13px' }} defaultValue="priority" onChange={(e) => { console.log('sort changed', e.target.value); }}>
                  <option value="priority">Priority</option>
                  <option value="custom">Custom</option>
                  <option value="titleaz">Title A-Z</option>
                  <option value="titleza">Title Z-A</option>
                  <option value="tokensup">Tokens ↗</option>
                  <option value="tokensdown">Tokens ↘</option>
                  <option value="depthup">Depth ↗</option>
                  <option value="depthdown">Depth ↘</option>
                  <option value="orderup">Order ↗</option>
                  <option value="orderdown">Order ↘</option>
                  <option value="uidup">UID ↗</option>
                  <option value="uiddown">UID ↘</option>
                  <option value="probup">Trigger% ↗</option>
                  <option value="probdown">Trigger% ↘</option>
                </select>
              </div>
              
            </div>
            <button className="menu_button square" onClick={() => fetchLorebooks()} title="Refresh"><span className="icon"><IconRefresh className="w-5 h-5" /></span></button>
            <div className="paginationjs-nav J-paginationjs-nav text-sm text-gray-400">1-4 .. 4</div>
            <div className="paginationjs-pages flex items-center gap-1">
              <button className="menu_button square" onClick={() => console.log('page first')}>{'«'}</button>
              <button className="menu_button square" onClick={() => console.log('page prev')}>{'<'}</button>
              <button className="menu_button square" onClick={() => console.log('page next')}>{'>'}</button>
              <button className="menu_button square" onClick={() => console.log('page last')}>{'»'}</button>
            </div>
            <select className="text_pole J-paginationjs-size-select" style={{width: '240px', minWidth: '240px', maxWidth: '240px',height: '32px'}} defaultValue={25} onChange={(e) => console.log('page size', e.target.value)}>
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={500}>500 / page</option>
              <option value={1000}>1000 / page</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded p-3">
          

          
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
                <button className="bg-green-600 px-3 py-1 rounded" onClick={() => setEditingEntry({ title_memo: '', content: '' })}>New Entry</button>
                <button className="bg-gray-600 px-3 py-1 rounded" onClick={() => { setViewing(null); setEntries([]); }}>Close</button>
            </div>
          </div>

          <div className="mt-3">
            <div id="WIEntryHeaderTitlesPC" className="flex-container wide100p spaceBetween justifyCenter textAlignCenter px-8">
              <small className="flex-1">Title/Memo</small>
              <small style={{ width: 'calc(3.5em + 10px)' }}>Strategy</small>
              <small style={{ width: 'calc(3.5em + 20px)' }}>Position</small>
              <small style={{ width: 'calc(3.5em + 15px)' }}>Depth</small>
              <small style={{ width: 'calc(3.5em + 20px)' }}>Order</small>
              <small style={{ width: 'calc(3.5em + 15px)' }}>Trigger %</small>
            </div>

            {editingEntry && !(editingEntry.id || editingEntry.uid) && (
              <div className="world_entry bg-gray-700/10 my-2 p-3 rounded" key="new-entry">
                <div className="mt-3">
                  <EntryEditor entry={editingEntry} lorebookId={idFor(viewing)} onSaved={handleEntrySaved} onDeleted={handleEntryDeleted} onCancel={() => setEditingEntry(null)} />
                </div>
              </div>
            )}

            {entries.map((en: any) => (
              <div key={en.id || en.entryId || JSON.stringify(en).slice(0, 16)} className="world_entry bg-gray-700/20 my-2 p-3 rounded">
                <form className="world_entry_form wi-card-entry">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="text-lg font-semibold">{en.title || en.name || (Array.isArray(en.key) ? en.key.join(',') : en.key) || 'Untitled'}</div>
                      <div className="text-sm text-gray-400 mt-1">UID: {en.uid || en.id}</div>
                    </div>

                    <div style={{ width: 'calc(3.5em + 10px)' }} className="text-sm text-gray-200 text-center">{en.strategy || en.position || '-'}</div>

                    <div style={{ width: 'calc(3.5em + 20px)' }} className="text-sm text-gray-200 text-center">{en.position ?? '-'}</div>

                    <div style={{ width: 'calc(3.5em + 15px)' }} className="text-sm text-gray-200 text-center">{en.depth ?? en.scanDepth ?? '-'}</div>

                    <div style={{ width: 'calc(3.5em + 20px)' }} className="text-sm text-gray-200 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button title="Move up" className="p-1 bg-gray-700 rounded" onClick={async () => {
                          const id = idFor(viewing);
                          const nextOrder = (en.insertion_order ?? en.order ?? 0) - 10;
                          await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries/${encodeURIComponent(String(en.id || en.uid || en.entryId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...en, insertion_order: nextOrder }) });
                          await fetchEntries(viewing);
                        }}><IconArrowUp className="w-4 h-4" /></button>
                        <div>{en.insertion_order ?? en.order ?? 0}</div>
                        <button title="Move down" className="p-1 bg-gray-700 rounded" onClick={async () => {
                          const id = idFor(viewing);
                          const nextOrder = (en.insertion_order ?? en.order ?? 0) + 10;
                          await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries/${encodeURIComponent(String(en.id || en.uid || en.entryId))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...en, insertion_order: nextOrder }) });
                          await fetchEntries(viewing);
                        }}><IconArrowDown className="w-4 h-4" /></button>
                      </div>
                    </div>

                    <div style={{ width: 'calc(3.5em + 15px)' }} className="text-sm text-gray-200 text-center">{en.probability ?? en.trigger_percent ?? '-'}</div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="menu_button square"
                        title="Expand/Collapse Entry"
                        onClick={() => setEditingEntry(
                          editingEntry && (editingEntry.id || editingEntry.uid) === (en.id || en.uid)
                            ? null
                            : en
                        )}
                        style={{ marginRight: '6px' }}
                      >
                        <span className={`icon ${editingEntry && (editingEntry.id || editingEntry.uid) === (en.id || en.uid) ? 'fa-chevron-up' : 'fa-chevron-down'}`}></span>
                      </button>
                      <button type="button" className="bg-slate-600 px-2 py-1 rounded" onClick={() => navigator.clipboard?.writeText(en.content || en.body || en.text || '')}>Copy</button>
                      <button type="button" className="bg-indigo-600 px-2 py-1 rounded" onClick={async () => {
                        // duplicate
                        try {
                          const id = idFor(viewing);
                          await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: en.title, content: en.content }) });
                          await fetchEntries(viewing);
                        } catch {}
                      }}>Duplicate</button>
                      <button type="button" className="bg-red-700 px-2 py-1 rounded" onClick={() => handleDeleteEntry(viewing!, en.id || en.entryId || en.uid || '')}>Delete</button>
                    </div>
                  </div>

                  {editingEntry && (editingEntry.id || editingEntry.uid) === (en.id || en.uid) && (
                    <div className="mt-3">
                      <EntryEditor entry={editingEntry} lorebookId={idFor(viewing)} onSaved={handleEntrySaved} onDeleted={handleEntryDeleted} onCancel={() => setEditingEntry(null)} />
                    </div>
                  )}
                </form>
              </div>
            ))}
          </div>
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
                try { await fetch(`/api/lorebooks/${encodeURIComponent(String(deleteTarget.uuid))}`, { method: 'DELETE' }); } catch (e) { console.warn('Delete request failed', e); }
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
