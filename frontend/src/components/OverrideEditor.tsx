import { useEffect, useState } from 'react';

interface Props {
  visible: boolean;
  onClose: () => void;
  worlds: any[];
  campaigns: any[];
  baseCharacters: any[];
}

export default function OverrideEditor({ visible, onClose, worlds, campaigns, baseCharacters }: Props) {
  const [selectedWorld, setSelectedWorld] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [selectedBaseChar, setSelectedBaseChar] = useState<number | null>(null);
  const [overrideJson, setOverrideJson] = useState('');
  const [mergedPreview, setMergedPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (worlds.length) setSelectedWorld(worlds[0].id);
    if (baseCharacters.length) setSelectedBaseChar(baseCharacters[0].id);
  }, [visible]);

  useEffect(() => {
    // load override when world + char selected
    const load = async () => {
      setError(null);
      if (selectedWorld && selectedBaseChar) {
        const res = await fetch(`/api/worlds/${selectedWorld}/characters/${selectedBaseChar}/override`);
        const data = await res.json();
        setOverrideJson(data.override ? JSON.stringify(data.override, null, 2) : '');
        // load merged preview
        const base = baseCharacters.find(b => b.id === selectedBaseChar);
        const mergedRes = await fetch(`/api/characters/merged?worldId=${selectedWorld}&slug=${base.slug}`);
        if (mergedRes.ok) {
          const mergedData = await mergedRes.json();
          setMergedPreview(mergedData);
        } else {
          setMergedPreview(null);
        }
      }
    };
    load();
  }, [selectedWorld, selectedBaseChar]);

  const saveOverride = async () => {
    try {
      const parsed = overrideJson ? JSON.parse(overrideJson) : {};
      if (!selectedWorld || !selectedBaseChar) return alert('Select world and base character');
      const res = await fetch(`/api/worlds/${selectedWorld}/characters/${selectedBaseChar}/override`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ override: parsed }) });
      if (!res.ok) {
        setError('Save failed');
      } else {
        // refresh merged preview
        const base = baseCharacters.find(b => b.id === selectedBaseChar);
        const mergedRes = await fetch(`/api/characters/merged?worldId=${selectedWorld}&slug=${base.slug}`);
        if (mergedRes.ok) setMergedPreview(await mergedRes.json());
        alert('Override saved');
      }
    } catch (e: any) {
      setError(e.message || 'Invalid JSON');
    }
  };

  if (!visible) return null;

  return (
    <div className="ef-modal-overlay" onMouseDown={onClose}>
      <div className="ef-modal large" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-header">
          <h3>Character Override Editor</h3>
          <button className="ef-close" onClick={onClose}>✕</button>
        </div>
        <div className="ef-modal-body override-grid">
          <div className="panel">
            <label className="ef-label">World</label>
            <select value={selectedWorld ?? ''} onChange={(e) => setSelectedWorld(Number(e.target.value))}>
              {worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            <label className="ef-label">Campaign (optional)</label>
            <select value={selectedCampaign ?? ''} onChange={(e) => setSelectedCampaign(Number(e.target.value))}>
              <option value="">(none)</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <label className="ef-label">Base Character</label>
            <select value={selectedBaseChar ?? ''} onChange={(e) => setSelectedBaseChar(Number(e.target.value))}>
              {baseCharacters.map(b => <option key={b.id} value={b.id}>{b.slug}</option>)}
            </select>

            {error && <div className="error">{error}</div>}
            <div style={{ marginTop: 12 }}>
              <button className="ef-btn ef-btn-primary" onClick={saveOverride}>Save Override</button>
            </div>
          </div>

          <div className="panel">
            <label className="ef-label">Override JSON (applies on top of base)</label>
            <textarea className="ef-textarea" value={overrideJson} onChange={(e) => setOverrideJson(e.target.value)} style={{ minHeight: 240 }} />
          </div>

          <div className="panel">
            <label className="ef-label">Merged Preview</label>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 480, overflow: 'auto', background: '#071025', padding: 12, borderRadius: 8 }}>{mergedPreview ? JSON.stringify(mergedPreview, null, 2) : 'No preview'}</pre>
          </div>
        </div>
        <div className="ef-modal-footer">
          <button className="ef-btn ef-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
