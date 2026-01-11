import React, { useState, useMemo } from 'react';
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
  const initialForm: any = { ...entry };
  if (Array.isArray((entry as any).key)) initialForm.key = (entry as any).key.join(',');
  if (Array.isArray((entry as any).optional_filter)) initialForm.optional_filter = (entry as any).optional_filter.join(',');
  if (Array.isArray((entry as any).triggers)) initialForm.triggers = (entry as any).triggers.join(',');
  if (Array.isArray((entry as any).additional_matching_sources)) initialForm.additional_matching_sources = (entry as any).additional_matching_sources.join(',');
  const [form, setForm] = useState<Entry>(initialForm);
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-300">Primary Keywords</label>
          <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.key || ''} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          <div className="flex gap-3 mt-3">
            <div className="flex-1">
              <label className="block text-sm text-gray-300">Optional Filter</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.optional_filter || ''} onChange={(e) => setForm({ ...form, optional_filter: e.target.value })} />
            </div>
            <div className="w-40">
              <label className="block text-sm text-gray-300">Inclusion Group</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={(form as any).inclusionGroup || ''} onChange={(e) => setForm({ ...form, inclusionGroup: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm text-gray-300">Scan Depth</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.depth ?? 0} onChange={(e) => setForm({ ...form, depth: +e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Order</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.insertion_order ?? 0} onChange={(e) => setForm({ ...form, insertion_order: +e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Group Weight</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.groupWeight ?? 100} onChange={(e) => setForm({ ...form, groupWeight: +e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Probability</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.probability ?? 100} onChange={(e) => setForm({ ...form, probability: +e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Insertion Position</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.insertion_position || ''} onChange={(e) => setForm({ ...form, insertion_position: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Outlet Name</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.outletName || ''} onChange={(e) => setForm({ ...form, outletName: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 mb-4">
        <div>
          <label className="block text-sm text-gray-300">Content</label>
          <textarea rows={8} className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <div className="text-sm text-gray-400 mt-2">Tokens: {useMemo(() => countTokens(form.content || ''), [form.content])} (accurate)</div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-gray-300">Matching Options</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={!!form.caseSensitive} onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked ? 1 : 0 })} /> Case-Sensitive</label>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={!!form.matchWholeWords} onChange={(e) => setForm({ ...form, matchWholeWords: e.target.checked ? 1 : 0 })} /> Whole Words</label>
          </div>
          <div>
            <label className="block text-sm text-gray-300">Triggers (comma-separated)</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.triggers || ''} onChange={(e) => setForm({ ...form, triggers: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm text-gray-300">Additional Matching Sources</label>
            <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" value={form.additional_matching_sources || ''} onChange={(e) => setForm({ ...form, additional_matching_sources: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={!!form.sticky} onChange={(e) => setForm({ ...form, sticky: e.target.checked ? 1 : 0 })} /> Sticky</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-500" checked={useGroupScoring} onChange={(e) => { setUseGroupScoring(e.target.checked); (form as any).useGroupScoring = e.target.checked ? 1 : 0; setForm({ ...form }); }} /> Use Group Scoring</label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm text-gray-300">Cooldown</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.cooldown ?? 0} onChange={(e) => setForm({ ...form, cooldown: +e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-300">Delay</label>
              <input className="w-full mt-1 p-2 bg-gray-800 text-gray-100 rounded" type="number" value={form.delay ?? 0} onChange={(e) => setForm({ ...form, delay: +e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">Enabled <input type="checkbox" className="accent-indigo-500" checked={form.enabled === 1 || form.enabled === true} onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} /></label>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button className="bg-gray-600 px-3 py-1 rounded" onClick={onCancel}>Close</button>
        <button className="bg-slate-600 px-3 py-1 rounded" onClick={() => navigator.clipboard?.writeText(form.content || '')}>Copy</button>
        <button className="bg-red-700 px-3 py-1 rounded" onClick={del}>Delete</button>
        <button className="bg-green-600 px-3 py-1 rounded" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  );
}
