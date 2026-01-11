import { FormEvent, useEffect, useRef, useState } from 'react';
import LoreImport from './components/LoreImport';
import './components/entryEditor.css';
import EntryEditor from './components/EntryEditor';
import { IconPlus, IconEdit, IconTrash, IconDownload, IconRefresh } from './components/icons';
import { useToast } from './components/Toast';

interface Lorebook {
  id?: number;
  uuid?: string;
  name?: string;
  description?: string;
}

function LoreManager({ version }: { version?: number }) {
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [viewing, setViewing] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [editing, setEditing] = useState<Lorebook | null>(null);
  const [form, setForm] = useState<any>({});
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [showImportPanel, setShowImportPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
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
    if (viewing && idFor(viewing) === String(id)) {
      setViewing(null);
      setEntries([]);
    }
    fetchLorebooks();
  };

  const fetchEntries = async (lb: Lorebook | null) => {
    const target = idFor(lb);
    if (!target) {
      console.debug('fetchEntries: no target for lorebook', lb);
      return setEntries([]);
    }
    console.debug('Loading lorebook:', lb);
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(target)}/entries`);
      if (!res.ok) {
        console.debug('fetchEntries: fetch failed', res.status, res.statusText);
        return setEntries([]);
      }
      const data = await res.json();
      console.log('Fetched entries for lorebook', target, data);
      setEntries(data || []);
    } catch (e) {
      console.debug('fetchEntries error', e);
      setEntries([]);
    }
  };

  const handleViewEntries = async (lb: Lorebook) => {
    setViewing(lb);
    setCreatingEntry(false);
    await fetchEntries(lb);
  };

  const handleSelectLorebook = (value: string) => {
    if (!value) {
      console.log('handleSelectLorebook: cleared selection');
      setViewing(null);
      setEntries([]);
      setCreatingEntry(false);
      return;
    }
    const selected = lorebooks.find((lb) => idFor(lb) === value);
    console.log('handleSelectLorebook: selected value', value, 'resolved:', selected);
    if (selected) {
      handleViewEntries(selected);
    }
  };

  const handleEntrySaved = (_updated?: any) => {
    setCreatingEntry(false);
    if (!_updated) return;
    // update the entries array in-place to avoid full refetch/redraw
    setEntries((prev) => {
      const idKey = _updated.id ?? _updated.uid ?? null;
      if (!idKey) return prev;
      return prev.map((e) => {
        const eId = e.id ?? e.uid ?? null;
        if (eId === idKey) return _updated;
        return e;
      });
    });
  };

  const handleEntryDeleted = async (_entry?: any) => {
    if (viewing) await fetchEntries(viewing);
    setCreatingEntry(false);
  };

  const handleExport = async (lb: Lorebook) => {
    const target = idFor(lb);
    if (!target) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(target)}/export`);
      if (!res.ok) {
        alert('Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const name = lb.name || `lorebook-${target}`;
      a.download = `${name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed');
    }
  };

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    const haystack = `${entry.title || entry.name || ''} ${(entry.content || entry.body || entry.text || '')}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });
  const totalEntries = filteredEntries.length;
  const maxPage = Math.max(0, Math.ceil(totalEntries / pageSize) - 1);
  useEffect(() => {
    setPageIndex((prev) => Math.min(prev, maxPage));
  }, [maxPage]);
  useEffect(() => {
    setPageIndex(0);
  }, [searchQuery]);
  const rangeStart = totalEntries === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = totalEntries === 0 ? 0 : Math.min(totalEntries, (pageIndex + 1) * pageSize);
  const visibleEntries = filteredEntries.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  return (
    <div className="manager p-4 text-gray-100 bg-gray-900 min-h-[60vh] rounded-md">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="lore-manager-header-card">
          <div className="lore-manager-header-main flex items-center justify-between gap-4">
            <div className="lore-manager-header-left flex items-center gap-3">
              <button type="button" className="lore-manager-header-primary" onClick={() => setShowNewModal(true)}>
                <span className="icon"><IconPlus className="w-5 h-5" /></span>
                <span>New lorebook</span>
              </button>
              <div className="lore-manager-header-select min-w-[220px]">
                <select
                  id="lore-select"
                  className="text_pole textarea_compact"
                  aria-label="Select lorebook"
                  value={idFor(viewing)}
                  onChange={(e) => handleSelectLorebook(e.target.value)}
                >
                  <option value="">Pick a lorebook to start editing entries</option>
                  {lorebooks.map((lb) => (
                    <option key={idFor(lb)} value={idFor(lb)}>
                      {lb.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="lore-manager-header-actions flex items-center gap-2">
              <button
                type="button"
                className="lore-manager-header-action"
                onClick={() => fileInputRef.current?.click()}
              >
                <IconDownload className="w-4 h-4" />
                <span>Import</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append('file', f);
                  try {
                    const res = await fetch('/api/lorebooks/import', { method: 'POST', body: fd });
                    const txt = await res.text();
                    let json: any = null;
                    try { json = txt ? JSON.parse(txt) : null; } catch (err) { json = { raw: txt }; }
                    if (!res.ok) {
                      const msg = json?.detail || json?.error || `Import failed (${res.status})`;
                      toast.error(String(msg));
                      return;
                    }
                    const name = json?.name || json?.title || 'lorebook';
                    toast.success(`Imported: ${name}`);
                    fetchLorebooks();
                  } catch (err: any) {
                    toast.error(String(err?.message || err));
                  } finally {
                    // clear the input so the same file can be selected again
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }
                }}
              />
              <button type="button" className="lore-manager-header-action" disabled={!viewing} onClick={() => viewing && handleExport(viewing)}>
                <IconDownload className="w-4 h-4" />
                <span>Export</span>
              </button>
              <button type="button" className="lore-manager-header-action" disabled={!viewing} onClick={() => viewing && handleEdit(viewing)}>
                <IconEdit className="w-4 h-4" />
                <span>Edit</span>
              </button>
              <button type="button" className="lore-manager-header-action" disabled={!viewing} onClick={() => console.log('Duplicate lorebook')}>
                <IconPlus className="w-4 h-4" />
                <span>Duplicate</span>
              </button>
              <button type="button" className="lore-manager-header-action red" disabled={!viewing} onClick={() => viewing && handleDelete(idFor(viewing))}>
                <IconTrash className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </div>
          </div>
          <div className="lore-manager-toolbar flex items-center gap-3 flex-nowrap">
            <button
              type="button"
              className="menu_button square"
              title="Create lore entry"
              disabled={!viewing}
              onClick={() => viewing && setCreatingEntry(true)}
            >
              <IconPlus className="w-4 h-4" />
            </button>
            <input
              id="lore-search"
              type="search"
              aria-label="Search entries"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries"
              className="text_pole textarea_compact"
            />
            <select
              id="lore-sort"
              aria-label="Sort entries"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="text_pole textarea_compact"
              style={{ maxWidth: 200 }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title-asc">Title A → Z</option>
              <option value="title-desc">Title Z → A</option>
            </select>
            <div className="flex-1" style={{ maxWidth: 50 }} />
            <button type="button" className="menu_button square" title="Refresh" onClick={() => fetchLorebooks()}>
              <span className="icon"><IconRefresh className="w-5 h-5" /></span>
            </button>
            <div className="paginationjs-nav text-sm text-gray-400">
              {totalEntries ? `${rangeStart}-${rangeEnd} of ${totalEntries}` : 'No entries yet'}
            </div>
            <div className="paginationjs-pages flex items-center gap-1">
              <button
                type="button"
                className="menu_button square"
                onClick={() => setPageIndex(0)}
                disabled={pageIndex === 0}
              >
                {'«'}
              </button>
              <button
                type="button"
                className="menu_button square"
                onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
                disabled={pageIndex === 0}
              >
                {'<'}
              </button>
              <button
                type="button"
                className="menu_button square"
                onClick={() => setPageIndex((prev) => Math.min(prev + 1, maxPage))}
                disabled={pageIndex >= maxPage}
              >
                {'>'}
              </button>
              <button
                type="button"
                className="menu_button square"
                onClick={() => setPageIndex(maxPage)}
                disabled={pageIndex >= maxPage}
              >
                {'»'}
              </button>
            </div>
            <select
              className="text_pole J-paginationjs-size-select"
              aria-label="Entries per page"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              style={{ maxWidth: 250 }}
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>
        {viewing && (
          <div className="bg-gray-800 rounded p-4 space-y-4">
            {showImportPanel && (
              <div className="border border-dashed border-gray-700 rounded p-3 bg-gray-900/50">
                <LoreImport onImported={() => { fetchLorebooks(); setShowImportPanel(false); }} />
              </div>
            )}
            {creatingEntry && (
              <div className="border border-gray-700 rounded p-3 bg-gray-900/70">
                <EntryEditor
                  entry={{}}
                  lorebookId={idFor(viewing)}
                  initialCollapsed={false}
                  onSaved={() => { handleEntrySaved(); }}
                  onDeleted={() => { handleEntryDeleted(); }}
                  onCancel={() => setCreatingEntry(false)}
                />
              </div>
            )}
            {visibleEntries.length === 0 ? (
              <div className="rounded border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400 text-center">
                <p>No entries for this lorebook yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleEntries.map((entry, idx) => (
                  <EntryEditor
                    key={`${entry.id || entry.uid || entry.uuid || entry.title || entry.key || entry.createdAt || idx}`}
                    entry={entry}
                    lorebookId={idFor(viewing)}
                    onSaved={handleEntrySaved}
                    onDeleted={handleEntryDeleted}
                    onCancel={() => {}}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded shadow-lg p-6 w-11/12 max-w-md space-y-4">
            <h2 className="text-lg font-semibold">Create Lorebook</h2>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full bg-gray-800 rounded border border-gray-700 p-2" placeholder="Lorebook name" />
            <div className="flex justify-end gap-2">
              <button type="button" className="menu_button" onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="menu_button primary"
                onClick={async () => {
                  if (!newName.trim()) return;
                  await fetch('/api/lorebooks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName.trim(), description: '', shared: false }),
                  });
                  setShowNewModal(false);
                  setNewName('');
                  fetchLorebooks();
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoreManager;
