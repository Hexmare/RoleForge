import { useState, useEffect } from 'react';

interface Props {
  visible: boolean;
  initial?: { id?: number; name?: string; description?: string; lorebookUuids?: string[] };
  onClose: () => void;
  onSave: (payload: { name: string; description?: string; lorebookUuids?: string[] }) => void;
}

interface Lorebook {
  uuid: string;
  name: string;
  description?: string;
}

export default function WorldEditor({ visible, initial, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [selectedLorebooks, setSelectedLorebooks] = useState<string[]>([]);

  useEffect(() => {
    setName(initial?.name || '');
    setDescription(initial?.description || '');
    setSelectedLorebooks(initial?.lorebookUuids || []);
    if (visible) {
      fetchLorebooks();
    }
  }, [initial, visible]);

  async function fetchLorebooks() {
    try {
      const res = await fetch('/api/lorebooks');
      const data = await res.json();
      setLorebooks(data);
    } catch (e) {
      console.error('Failed to fetch lorebooks', e);
    }
  }

  if (!visible) return null;

  return (
    <div className="ef-modal-overlay" onMouseDown={onClose}>
      <div className="ef-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-header">
          <h3>{initial?.id ? 'Edit World' : 'New World'}</h3>
          <button className="ef-close" onClick={onClose}>✕</button>
        </div>
        <div className="ef-modal-body">
          <label className="ef-label">Name</label>
          <input className="ef-input" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="ef-label">Description</label>
          <textarea className="ef-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="ef-label">Assigned Lorebooks</label>
          <select multiple className="ef-input" value={selectedLorebooks} onChange={(e) => {
            const options = Array.from(e.target.selectedOptions, option => option.value);
            setSelectedLorebooks(options);
          }}>
            {lorebooks.map(lb => (
              <option key={lb.uuid} value={lb.uuid}>{lb.name}</option>
            ))}
          </select>
        </div>
        <div className="ef-modal-footer">
          <button className="ef-btn ef-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ef-btn ef-btn-primary" onClick={() => onSave({ name, description, lorebookUuids: selectedLorebooks })} disabled={!name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
