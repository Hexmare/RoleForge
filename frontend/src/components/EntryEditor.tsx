import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/solid';
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
  selective?: number | boolean;
  selectiveLogic?: number;
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
    } else if (typeof value === 'string') {
      const s = value.trim();
      // handle JSON-encoded arrays stored as strings like '["a","b"]'
      if (s.startsWith('[') && s.endsWith(']')) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) base[field] = parsed.join(',');
        } catch (e) {
          // leave as-is
        }
      }
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
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [hasBeenEdited, setHasBeenEdited] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const id = entry.id ?? entry.uid;
  const isNewEntry = !id;

  useEffect(() => {
    setForm(initialForm);
    setIsDirty(false);
  }, [initialForm]);

  useEffect(() => {
    // Once an entry has been edited, never auto-collapse it based on prop changes
    // Only collapse new entries that have never been touched
    if (!hasBeenEdited) {
      setCollapsed(initialCollapsed);
    }
  }, [initialCollapsed, hasBeenEdited]);

  const sanitizedPayload = () => {
    const payload: any = { ...form }; 
    const listFields = ['key', 'optional_filter', 'triggers', 'additional_matching_sources'];
    listFields.forEach((field) => {
      const v = payload[field];
      if (typeof v === 'string') {
        const s = v.trim();
        if (s.startsWith('[') && s.endsWith(']')) {
          try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) payload[field] = parsed;
            else payload[field] = s.length ? s.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0) : [];
          } catch (e) {
            payload[field] = s.length ? s.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0) : [];
          }
        } else {
          payload[field] = s.length ? s.split(',').map((p: string) => p.trim()).filter((p: string) => p.length > 0) : [];
        }
      }
    });
    // Ensure title/comment round-trips: map `comment` -> `title_memo` for backend
    payload.title_memo = payload.comment ?? payload.title_memo ?? null;
    if ('comment' in payload) delete payload.comment;
    // Ensure selective and selectiveLogic are properly cast
    payload.selective = payload.selective === 1 || payload.selective === true ? 1 : 0;
    payload.selectiveLogic = Number(payload.selectiveLogic ?? 0);
    return payload;
  };

  const updateForm = (up: any) => {
    setForm((prev: any) => {
      const next = typeof up === 'function' ? up(prev) : { ...prev, ...up };
      return next;
    });
    setIsDirty(true);
    // Mark entry as edited so it won't auto-collapse
    setHasBeenEdited(true);
  };

  const handleFieldFocus = (fieldName: string) => {
    setFocusedField(fieldName);
  };

  const handleFieldBlur = () => {
    setFocusedField(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = sanitizedPayload();
      console.log('[EntryEditor] Saving payload:', { selective: payload.selective, selectiveLogic: payload.selectiveLogic, ...payload });
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
      console.log('[EntryEditor] Received response:', { selective: data.selective, selectiveLogic: data.selectiveLogic, ...data });
      // Mark as edited to prevent auto-collapse
      setHasBeenEdited(true);
      // Keep entry open
      setCollapsed(false);
      // Always update form with server response
      setForm(normalizeArrays(data));
      setIsDirty(false);
      onSaved?.(data);
    } catch (err) {
      alert('Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!isDirty) return;
    if (saving) return;
    // Don't autosave while the user is actively editing a field
    if (focusedField !== null) {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      return;
    }
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    // Only autosave after user has stopped typing and left the field
    autosaveTimer.current = window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      save();
    }, 1000) as unknown as number;
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [isDirty, focusedField, saving]);

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
            >
              {collapsed ? (
                <ChevronDownIcon className="w-5 h-5 text-gray-300 transition-colors duration-150" />
              ) : (
                <ChevronUpIcon className="w-5 h-5 text-gray-800 transition-colors duration-150" />
              )}
            </button>
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
              onChange={(e) => updateForm({ comment: e.target.value })}
              onFocus={() => handleFieldFocus('comment')}
              onBlur={handleFieldBlur}
            />
            <select
              name="entryStateSelector"
              className="text_pole entry-state-select"
              value={(form as any).entryStateSelector || 'normal'}
              onChange={(e) => updateForm({ entryStateSelector: e.target.value })}
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
                onChange={(e) => updateForm({ position: e.target.value })}
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
                onChange={(e) => updateForm({ depth: Number(e.target.value) })}
              />
            </div>
            <div className="entry-field" title="Order">
              <span className="entry-field-label">Order</span>
              <input
                className="text_pole entry-number"
                type="number"
                name="order"
                value={form.insertion_order ?? entry.insertion_order ?? entry.order ?? ''}
                onChange={(e) => updateForm({ insertion_order: Number(e.target.value) })}
              />
            </div>
            <div className="entry-field" title="Trigger %">
              <span className="entry-field-label">Trigger %</span>
              <input
                className="text_pole entry-number"
                type="number"
                name="probability"
                value={form.probability ?? 100}
                onChange={(e) => updateForm({ probability: Number(e.target.value) })}
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
                  onChange={(e) => updateForm({ content: e.target.value })}
                  onFocus={() => handleFieldFocus('content')}
                  onBlur={handleFieldBlur}
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
                    onChange={(e) => updateForm({ key: e.target.value })}
                    onFocus={() => handleFieldFocus('key')}
                    onBlur={handleFieldBlur}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={form.selective === 1 || form.selective === true}
                      onChange={(e) => updateForm({ selective: e.target.checked ? 1 : 0 })}
                    />
                    Selective
                  </label>
                  {(form.selective === 1 || form.selective === true) && (
                    <select
                      className="text_pole px-2 py-1 bg-gray-700 text-gray-100 rounded text-sm"
                      value={form.selectiveLogic ?? 0}
                      onChange={(e) => updateForm({ selectiveLogic: Number(e.target.value) })}
                      title="Selective logic: 0=AND ANY, 1=AND ALL, 2=NOT ANY, 3=NOT ALL"
                    >
                      <option value={0}>AND ANY</option>
                      <option value={1}>AND ALL</option>
                      <option value={2}>NOT ANY</option>
                      <option value={3}>NOT ALL</option>
                    </select>
                  )}
                </div>
                {(form.selective === 1 || form.selective === true) && (
                  <div>
                    <label className="block text-sm text-gray-300">Optional Filter (comma-separated)</label>
                    <input
                      className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded"
                      placeholder="Additional keywords that must match based on logic"
                      value={form.optional_filter || ''}
                      onChange={(e) => updateForm({ optional_filter: e.target.value })}
                      onFocus={() => handleFieldFocus('optional_filter')}
                      onBlur={handleFieldBlur}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-300">Triggers (comma-separated)</label>
                  <input
                    className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded"
                    value={form.triggers || ''}
                    onChange={(e) => updateForm({ triggers: e.target.value })}
                    onFocus={() => handleFieldFocus('triggers')}
                    onBlur={handleFieldBlur}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={!!form.caseSensitive}
                      onChange={(e) => updateForm({ caseSensitive: e.target.checked ? 1 : 0 })}
                    />
                    Case-Sensitive
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={!!form.matchWholeWords}
                      onChange={(e) => updateForm({ matchWholeWords: e.target.checked ? 1 : 0 })}
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
                      onChange={(e) => updateForm({ enabled: e.target.checked ? 1 : 0 })}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4 w-full">
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
