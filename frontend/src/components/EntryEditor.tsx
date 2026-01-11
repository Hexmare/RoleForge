import React, { useState, useMemo } from 'react';
import './entryEditor.css';
import { countTokens } from '../utils/tokenCounter';

interface Entry {
  id?: number | string;
  uid?: number;
  key?: string;
  optional_filter?: string;
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
  triggers?: string | null;
  additional_matching_sources?: string | null;
  sticky?: number | boolean;
  cooldown?: number;
  delay?: number;
  inclusionGroup?: string | null;
}

export default function EntryEditor({ entry, lorebookId, onSaved, onDeleted, onCancel }: {
  entry: Entry;
  lorebookId: string | number;
  onSaved?: (updated: any) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}) {
  // Initialize form, flatten array fields to comma-separated strings for the UI
  // Use 'comment' as the Title/Memo field, not 'title_memo'.
  const initialForm: any = { ...entry };
  if (Array.isArray((entry as any).key)) initialForm.key = (entry as any).key.join(',');
  if (Array.isArray((entry as any).optional_filter)) initialForm.optional_filter = (entry as any).optional_filter.join(',');
  if (Array.isArray((entry as any).triggers)) initialForm.triggers = (entry as any).triggers.join(',');
  if (Array.isArray((entry as any).additional_matching_sources)) initialForm.additional_matching_sources = (entry as any).additional_matching_sources.join(',');
  // Ensure 'comment' is present for editing
  initialForm.comment = (entry as any).comment || '';
  const [form, setForm] = useState<any>(initialForm);
  const [saving, setSaving] = useState(false);
  const [useGroupScoring, setUseGroupScoring] = useState<boolean>(() => !!(entry as any).useGroupScoring);

  const id = entry.id || entry.uid;

  const save = async () => {
    setSaving(true);
    try {
      // prepare payload: convert comma-separated strings back to arrays where appropriate
      const payload: any = { ...form };
      if (typeof payload.key === 'string') payload.key = payload.key.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (typeof payload.optional_filter === 'string') payload.optional_filter = payload.optional_filter.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (typeof payload.triggers === 'string') payload.triggers = payload.triggers.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (typeof payload.additional_matching_sources === 'string') payload.additional_matching_sources = payload.additional_matching_sources.split(',').map((s: string) => s.trim()).filter(Boolean);
      // Remove title_memo if present, always use 'comment' for this field
      if ('title_memo' in payload) delete payload.title_memo;
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries/${encodeURIComponent(String(id))}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      onSaved && onSaved(data);
    } catch (e) {
      alert('Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      const res = await fetch(`/api/lorebooks/${encodeURIComponent(String(lorebookId))}/entries/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      onDeleted && onDeleted();
    } catch (e) { alert('Failed to delete entry'); }
  };

  return (
    <div className="bg-gray-900 p-4 rounded text-gray-100 border border-gray-800">
      {/* Entry Editor Main Container */}
      <div className="inline-drawer wide100p">
        {/* Entry Header Row (Collapsed/Expanded) */}
        <div className="inline-drawer-header gap5px padding0">
          <div className="gap5px world_entry_thin_controls wide100p alignitemscenter">
            {/* Expand/Collapse Toggle Button */}
            <div className="inline-drawer-toggle fa-fw fa-solid inline-drawer-icon interactable down fa-circle-chevron-down" role="button" onClick={() => { /* no-op toggle in editor */ }} />
            {/* Entry Active State Toggle (KillSwitch) */}
            <div className="fa-solid fa-toggle-on killSwitch" name="entryKillSwitch" title="Toggle entry's active state."></div>
            {/* Title/Memo and State Selector */}
            <div className="flex-container alignitemscenter wide100p" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="WIEntryTitleAndStatus flex-container flex1 alignitemscenter" style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                {/* Title/Memo Textarea (uses 'comment' field) */}
                <div className="flex-container flex1">
                  <textarea className="text_pole" rows={1} name="comment" placeholder="Entry Title/Memo" value={form.comment || ''} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
                </div>
                {/* Entry State Selector Dropdown */}
                <select name="entryStateSelector" className="text_pole widthNatural margin0" value={(form as any).entryStateSelector || 'normal'} onChange={(e) => setForm({ ...form, entryStateSelector: e.target.value })}>
                  <option value="constant">🔵</option>
                  <option value="normal">🟢</option>
                  <option value="vectorized">🔗</option>
                </select>
              </div>
              {/* Header Controls: Position, Depth, Order, Trigger % */}
              <div className="WIEnteryHeaderControls flex-container" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Position Selector */}
                <div name="PositionBlock" className="world_entry_form_control world_entry_form_radios wi-enter-footer-text">
                  <label className="WIEntryHeaderTitleMobile">Position:</label>
                  <select name="position" className="text_pole widthNatural margin0" value={(form as any).position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })}>
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
                {/* Depth Input */}
                <div className="world_entry_form_control wi-enter-footer-text flex-container flexNoGap">
                  <label className="WIEntryHeaderTitleMobile">Depth:</label>
                  <input title="Depth" className="text_pole wideMax100px margin0" type="number" name="depth" value={form.depth ?? ''} onChange={(e) => setForm({ ...form, depth: e.target.value ? +e.target.value : undefined })} style={{ width: 'calc(3em + 15px)' }} />
                </div>
                {/* Order Input */}
                <div className="world_entry_form_control wi-enter-footer-text  flex-container flexNoGap">
                  <label className="WIEntryHeaderTitleMobile">Order:</label>
                  <input title="Order" className="text_pole wideMax100px margin0" type="number" name="order" value={form.insertion_order ?? 0} onChange={(e) => setForm({ ...form, insertion_order: +e.target.value })} style={{ width: 'calc(3em + 15px)' }} />
                </div>
                {/* Trigger % Input */}
                <div className="world_entry_form_control wi-enter-footer-text flex-container flexNoGap probabilityContainer">
                  <label className="WIEntryHeaderTitleMobile">Trigger %:</label>
                  <input title="Probability" className="text_pole wideMax100px margin0" type="number" name="probability" value={form.probability ?? 100} onChange={(e) => setForm({ ...form, probability: +e.target.value })} style={{ width: 'calc(3em + 15px)' }} />
                </div>
              </div>
            </div>
            {/* Move/Copy Entry Button */}
            <button title="Move/Copy Entry" className="menu_button move_entry_button fa-solid fa-right-left interactable" type="button" onClick={() => { /* noop */ }}>Move</button>
            {/* Duplicate Entry Button */}
            <button title="Duplicate" className="menu_button duplicate_entry_button fa-solid fa-paste interactable" type="button" onClick={async () => {
              try {
                const id = lorebookId;
                await fetch(`/api/lorebooks/${encodeURIComponent(String(id))}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.comment || form.key, content: form.content }) });
              } catch (e) { console.warn('duplicate failed', e); }
            }}>Dup</button>
            {/* Delete Entry Button */}
            <button title="Delete" className="menu_button delete_entry_button fa-solid fa-trash-can interactable" type="button" onClick={del}>Del</button>
          </div>
          {/* Entry Body/Content Area (hidden in collapsed mode) */}
          <div className="inline-drawer-content inline-drawer-outlet flex-container paddingBottom5px wide100p" style={{ display: 'block' }}>
            {/* body follows below */}
          </div>
        </div>
      </div>

      {/* Main Content and Matching Options */}
      <div className="mt-3">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
          {/* Content Textarea and Token Counter */}
          <div>
            <label className="block text-sm text-gray-300">Content</label>
            <textarea rows={8} className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            <div className="text-sm text-gray-400 mt-2">Tokens: {useMemo(() => countTokens(form.content || ''), [form.content])}</div>
          </div>

          {/* Matching Options Panel */}
          <div className="space-y-3">
            <label className="block text-sm text-gray-300">Matching Options</label>
            {/* Primary Keywords Input */}
            <div>
              <label className="block text-sm text-gray-300">Primary Keywords (comma-separated)</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.key || ''} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </div>
            {/* Triggers Input */}
            <div>
              <label className="block text-sm text-gray-300">Triggers (comma-separated)</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.triggers || ''} onChange={(e) => setForm({ ...form, triggers: e.target.value })} />
            </div>
            {/* Case-Sensitive and Whole Words Checkboxes */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={!!form.caseSensitive} onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked ? 1 : 0 })} /> Case-Sensitive</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={!!form.matchWholeWords} onChange={(e) => setForm({ ...form, matchWholeWords: e.target.checked ? 1 : 0 })} /> Whole Words</label>
            </div>
            {/* Enabled Checkbox */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">Enabled <input type="checkbox" className="accent-indigo-500" checked={form.enabled === 1 || form.enabled === true} onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} /></label>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Action Buttons */}
      <div className="flex justify-end gap-3 mt-4">
        <button className="bg-gray-600 px-3 py-1 rounded" onClick={onCancel}>Close</button>
        <button className="bg-slate-600 px-3 py-1 rounded" onClick={() => navigator.clipboard?.writeText(form.content || '')}>Copy</button>
        <button className="bg-red-700 px-3 py-1 rounded" onClick={del}>Delete</button>
        <button className="bg-green-600 px-3 py-1 rounded" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  );
}
