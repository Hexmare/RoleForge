import React, { useEffect, useMemo, useState } from 'react';
import './entryEditor.css';
import { countTokens } from '../utils/tokenCounter';

interface Entry {
  id?: number | string;
  uid?: number;
  key?: string;
  optional_filter?: string[] | string;
  title_memo?: string | null;
  content?: string;
  insertion_order?: number;
  insertion_position?: string | null;
  outletName?: string | null;
  enabled?: number | boolean;
  depth?: number;
  caseSensitive?: number | boolean;
  matchWholeWords?: number | boolean;
  groupWeight?: number;
  probability?: number;
  triggers?: string[] | string | null;
  additional_matching_sources?: string[] | string | null;
  sticky?: number | boolean;
  cooldown?: number;
  delay?: number;
  inclusionGroup?: string | null;
  order?: number;
  comment?: string;
}

interface EntryEditorProps {
  entry: Entry;
  lorebookId: string | number;
  onSaved?: (updated: any) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
  initialCollapsed?: boolean;
}

const normalizeArrays = (entry: Entry) => {
  const base: any = { ...entry };
  const arrayFields: Array<keyof Entry> = ['key', 'optional_filter', 'triggers', 'additional_matching_sources'];
  arrayFields.forEach((field) => {
    const value = base[field];
    if (Array.isArray(value)) {
      base[field] = value.join(',');
    }
  });
  base.comment = base.comment ?? base.title_memo ?? '';
  return base;
};

export default function EntryEditor({
  entry,
  lorebookId,
  onSaved,
  onDeleted,
  onCancel,
  initialCollapsed = true,
}: EntryEditorProps) {
  const initialForm = useMemo(() => normalizeArrays(entry), [entry]);
  const [form, setForm] = useState<any>(initialForm);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const id = entry.id ?? entry.uid;
  const isNewEntry = !id;

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  useEffect(() => {
    setCollapsed(initialCollapsed);
  }, [initialCollapsed, entry]);

  const sanitizedPayload = () => {
    const payload: any = { ...form }; 
    const listFields = ['key', 'optional_filter', 'triggers', 'additional_matching_sources'];
    listFields.forEach((field) => {
      if (typeof payload[field] === 'string') {
        payload[field] = payload[field]
          .split(',')
          .map((part: string) => part.trim())
          .filter((part: string) => part.length > 0);
      }
    });
    if ('title_memo' in payload) delete payload.title_memo;
    return payload;
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = sanitizedPayload();
      const target = isNewEntry
        ? `/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries`
        : `/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries/${encodeURIComponent(String(id))}`;
      const method = isNewEntry ? 'POST' : 'PUT';
      const res = await fetch(target, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save entry');
      const data = await res.json();
      onSaved?.(data);
      setCollapsed(true);
    } catch (err) {
      alert('Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (isNewEntry) {
      onDeleted?.();
      onCancel?.();
      return;
    }
    if (!confirm('Delete this entry?')) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Delete failed');
      onDeleted?.();
    } catch (err) {
      alert('Failed to delete entry');
    }
  };

  const duplicateEntry = async () => {
    try {
      await fetch(`/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.comment || form.key, content: form.content }),
      });
      onSaved?.(entry);
    } catch (err) {
      console.warn('Duplicate failed', err);
    }
  };

  const toggleEntryEnabled = () => {
    setForm((prev: any) => ({
      ...prev,
      enabled: prev.enabled === 1 || prev.enabled === true ? 0 : 1,
    }));
  };

  const tokenCount = useMemo(() => countTokens(form.content || ''), [form.content]);

  return (
    <div className="world_entry" data-uid={id ?? 'new'}>
      <form className="world_entry_form wi-card-entry" onSubmit={(e) => e.preventDefault()}>
        <div className="inline-drawer wide100p">
          <div className="entry-header-row-single">
            <button
              type="button"
              className={`inline-drawer-toggle fa-fw fa-solid inline-drawer-icon interactable ${collapsed ? 'down' : 'up'}`}
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? 'Expand entry' : 'Collapse entry'}
            />
            <button
              type="button"
              className={`fa-solid ${form.enabled === 1 || form.enabled === true ? 'fa-toggle-on' : 'fa-toggle-off'} killSwitch`}
              title="Toggle entry's active state"
              onClick={toggleEntryEnabled}
            />
            <input
              type="text"
              className="text_pole entry-title-input"
              value={form.comment || ''}
              placeholder="Entry title / memo"
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
            <select
              name="entryStateSelector"
              className="text_pole entry-state-select"
              value={(form as any).entryStateSelector || 'normal'}
              onChange={(e) => setForm({ ...form, entryStateSelector: e.target.value })}
              title="Entry state"
            >
              <option value="constant">🔵</option>
              <option value="normal">🟢</option>
              <option value="vectorized">🔗</option>
            </select>
            <div className="entry-field" title="Position">
              <span className="entry-field-label">Position</span>
              <select
                name="position"
                className="text_pole entry-position-select"
                value={(form as any).position ?? ''}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              >
                <option value="0">↑Char</option>
                <option value="1">↓Char</option>
                <option value="5">↑EM</option>
                <option value="6">↓EM</option>
                <option value="2">↑AN</option>
                <option value="3">↓AN</option>
                <option value="4">@D</option>
                <option value="7">➡️Outlet</option>
              </select>
            </div>
            <div className="entry-field" title="Depth">
              <span className="entry-field-label">Depth</span>
              <input
                className="text_pole entry-number"
                type="number"
                name="depth"
                value={form.depth ?? entry.depth ?? ''}
                onChange={(e) => setForm({ ...form, depth: Number(e.target.value) })}
              />
            </div>
            <div className="entry-field" title="Order">
              <span className="entry-field-label">Order</span>
              <input
                className="text_pole entry-number"
                type="number"
                name="order"
                value={form.insertion_order ?? entry.insertion_order ?? entry.order ?? ''}
                onChange={(e) => setForm({ ...form, insertion_order: Number(e.target.value) })}
              />
            </div>
            <div className="entry-field" title="Trigger %">
              <span className="entry-field-label">Trigger %</span>
              <input
                className="text_pole entry-number"
                type="number"
                name="probability"
                value={form.probability ?? 100}
                onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })}
              />
            </div>
            <div className="entry-header-actions">
              <button
                type="button"
                className="menu_button move_entry_button fa-solid fa-right-left interactable"
                title="Move/Copy Entry"
                onClick={() => {}}
              >
                Move
              </button>
              <button
                type="button"
                className="menu_button duplicate_entry_button fa-solid fa-paste interactable"
                title="Duplicate entry"
                onClick={duplicateEntry}
              >
                Dup
              </button>
              <button
                type="button"
                className="menu_button delete_entry_button fa-solid fa-trash-can interactable"
                title="Delete entry"
                onClick={del}
              >
                Del
              </button>
            </div>
          </div>
          <div
            className="inline-drawer-content inline-drawer-outlet flex-container paddingBottom5px wide100p"
            style={{ display: collapsed ? 'none' : 'block' }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 w-full">
              <div>
                <label className="block text-sm text-gray-300">Content</label>
                <textarea
                  rows={8}
                  className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded"
                  value={form.content || ''}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
                <div className="text-sm text-gray-400 mt-2">Tokens: {tokenCount}</div>
              </div>
              <div className="space-y-3">
                <label className="block text-sm text-gray-300">Matching Options</label>
                <div>
                  <label className="block text-sm text-gray-300">Primary Keywords (comma-separated)</label>
                  <input
                    className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded"
                    value={form.key || ''}
                    onChange={(e) => setForm({ ...form, key: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300">Triggers (comma-separated)</label>
                  <input
                    className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded"
                    value={form.triggers || ''}
                    onChange={(e) => setForm({ ...form, triggers: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={!!form.caseSensitive}
                      onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked ? 1 : 0 })}
                    />
                    Case-Sensitive
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={!!form.matchWholeWords}
                      onChange={(e) => setForm({ ...form, matchWholeWords: e.target.checked ? 1 : 0 })}
                    />
                    Whole Words
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    Enabled
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={form.enabled === 1 || form.enabled === true}
                      onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4 w-full">
              <button
                type="button"
                className="bg-gray-600 px-3 py-1 rounded"
                onClick={() => {
                  setCollapsed(true);
                  onCancel?.();
                }}
              >
                Close
              </button>
              <button type="button" className="bg-slate-600 px-3 py-1 rounded" onClick={() => navigator.clipboard?.writeText(form.content || '')}>
                Copy
              </button>
              <button type="button" className="bg-green-600 px-3 py-1 rounded" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
