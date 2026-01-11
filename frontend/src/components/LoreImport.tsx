import React, { useState } from 'react';

export default function LoreImport({ onImported }: { onImported?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setStatus(null);
    setPreview(null);
    setRawText(null);
    const f = e.target.files && e.target.files[0];
    setFile(f || null);
    if (f) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const txt = String(ev.target?.result || '');
        setRawText(txt);
        try {
          const parsed = JSON.parse(txt);
          // Basic preview: name/title and entries count if present
          const name = parsed.name || parsed.title || parsed?.meta?.name || null;
          let entries = parsed.entries || parsed.data || parsed.lore || null;
          if (entries && !Array.isArray(entries)) {
            // try common SillyTavern top-level structure where items are under 'items' or similar
            if (Array.isArray(parsed.items)) entries = parsed.items;
            else entries = null;
          }
          const sample = Array.isArray(entries) ? entries.slice(0, 5) : null;
          setPreview({ parsed, name, entriesCount: Array.isArray(entries) ? entries.length : null, sample });
        } catch (err) {
          setError('Failed to parse JSON for preview');
        }
      };
      reader.readAsText(f);
    }
  };

  const commitImport = async () => {
    if (!file) return setError('Select a file first');
    setStatus('Importing...');
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/lorebooks/import', { method: 'POST', body: fd });
      const txt = await res.text();
      let json: any = null;
      try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = { raw: txt }; }
      if (!res.ok) {
        setError(json?.detail || json?.error || `Import failed (${res.status})`);
        setStatus(null);
        return;
      }
      const name = json?.name || json?.title || 'lorebook';
      setStatus(`Imported: ${name}`);
      setFile(null);
      setPreview(null);
      setRawText(null);
      try { if (onImported) onImported(); } catch (e) { /* noop */ }
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatus(null);
    }
  };

  const clear = () => { setFile(null); setStatus(null); setError(null); setPreview(null); setRawText(null); };

  return (
    <div style={{ paddingTop: 12 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#666' }}>Import Lorebook (SillyTavern JSON)</label>
      <input type="file" accept="application/json" onChange={handleFile} />
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={commitImport} disabled={!file} style={{ marginRight: 8 }}>Commit Import</button>
        <button className="btn muted" onClick={clear} >Clear</button>
      </div>
      {preview && (
        <div style={{ marginTop: 8, border: '1px dashed #ccc', padding: 8, borderRadius: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Preview</div>
          <div style={{ fontSize: 12, color: '#444' }}>
            {preview.name ? <div><strong>Name:</strong> {String(preview.name)}</div> : <div><strong>No name/title detected</strong></div>}
            {preview.entriesCount !== null ? <div><strong>Entries:</strong> {preview.entriesCount}</div> : <div><strong>Entries:</strong> Unknown</div>}
            {preview.sample && <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Sample entries:</div>
              <ul style={{ maxHeight: 160, overflow: 'auto' }}>
                {preview.sample.map((s: any, i: number) => (
                  <li key={i} style={{ fontSize: 12, marginBottom: 4 }}>{typeof s === 'string' ? s : (s.name || s.title || JSON.stringify(s).slice(0, 120))}</li>
                ))}
              </ul>
            </div>}
          </div>
        </div>
      )}
      {status && <div style={{ marginTop: 8, color: 'green' }}>{status}</div>}
      {error && <div style={{ marginTop: 8, color: 'crimson' }}>{error}</div>}
      {rawText && !preview && !error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>No structured preview available. File parsed, but no entries found.</div>
      )}
    </div>
  );
}
