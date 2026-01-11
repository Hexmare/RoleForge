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
          <div className="inline-drawer-header gap5px padding0">
            <div className="gap5px world_entry_thin_controls wide100p alignitemscenter">
              <div
                className={`inline-drawer-toggle fa-fw fa-solid inline-drawer-icon interactable ${collapsed ? 'down' : 'up'}`}
                role="button"
                tabIndex={0}
                onClick={() => setCollapsed((prev) => !prev)}
              />
              <div
                className={`fa-solid ${form.enabled === 1 || form.enabled === true ? 'fa-toggle-on' : 'fa-toggle-off'} killSwitch`}
                title="Toggle entry's active state"
                onClick={toggleEntryEnabled}
                role="button"
                tabIndex={0}
              />
              <div className="flex-container alignitemscenter wide100p">
                <div className="WIEntryTitleAndStatus flex-container flex1 alignitemscenter">
                  <div className="flex-container flex1">
                    <textarea
                      className="text_pole"
                      rows={1}
                      value={form.comment || ''}
                      placeholder="Entry Title/Memo"
                      onChange={(e) => setForm({ ...form, comment: e.target.value })}
                    />
                  </div>
                  <select
                    name="entryStateSelector"
                    className="text_pole widthNatural margin0"
                    value={(form as any).entryStateSelector || 'normal'}
                    onChange={(e) => setForm({ ...form, entryStateSelector: e.target.value })}
                  >
                    <option value="constant">🔵</option>
                    <option value="normal">🟢</option>
                    <option value="vectorized">🔗</option>
                  </select>
                </div>
                <div className="WIEnteryHeaderControls flex-container">
                  <div className="world_entry_form_control world_entry_form_radios wi-enter-footer-text">
                    <label className="WIEntryHeaderTitleMobile" htmlFor="position">
                      Position:
                    </label>
                    <select
                      name="position"
                      className="text_pole widthNatural margin0"
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
                      <option value="7">➡️ Outlet</option>
                    </select>
                  </div>
                  <div className="world_entry_form_control wi-enter-footer-text flex-container flexNoGap">
                    <label className="WIEntryHeaderTitleMobile" htmlFor="depth">
                      Depth:
                    </label>
                    <input
                      title="Depth"
                      className="text_pole wideMax100px margin0"
                      type="number"
                      name="depth"
                      value={form.depth ?? entry.depth ?? ''}
                      onChange={(e) => setForm({ ...form, depth: Number(e.target.value) })}
                      style={{ width: 'calc(3em + 15px)' }}
                    />
                  </div>
                  <div className="world_entry_form_control wi-enter-footer-text flex-container flexNoGap">
                    <label className="WIEntryHeaderTitleMobile" htmlFor="order">
                      Order:
                    </label>
                    <input
                      title="Order"
                      className="text_pole wideMax100px margin0"
                      type="number"
                      name="order"
                      value={form.insertion_order ?? entry.insertion_order ?? entry.order ?? ''}
                      onChange={(e) => setForm({ ...form, insertion_order: Number(e.target.value) })}
                      style={{ width: 'calc(3em + 15px)' }}
                    />
                  </div>
                  <div className="world_entry_form_control wi-enter-footer-text flex-container flexNoGap probabilityContainer">
                    <label className="WIEntryHeaderTitleMobile" htmlFor="probability">
                      Trigger %:
                    </label>
                    <input
                      title="Probability"
                      className="text_pole wideMax100px margin0"
                      type="number"
                      name="probability"
                      value={form.probability ?? 100}
                      onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })}
                      style={{ width: 'calc(3em + 15px)' }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="WIEntryHeaderControls flex-container" style={{ gap: '6px' }}>
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
