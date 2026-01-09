import { useState, useEffect } from 'react';

interface Props {
  visible: boolean;
  initial?: { name?: string; description?: string };
  onClose: () => void;
  onSave: (payload: { name: string; description?: string }) => void;
}

export default function CampaignEditor({ visible, initial, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    setName(initial?.name || '');
    setDescription(initial?.description || '');
  }, [initial, visible]);

  if (!visible) return null;

  return (
    <div className="ef-modal-overlay" onMouseDown={onClose}>
      <div className="ef-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-header">
          <h3>{initial ? 'Edit Campaign' : 'New Campaign'}</h3>
          <button className="ef-close" onClick={onClose}>✕</button>
        </div>
        <div className="ef-modal-body">
          <label className="ef-label">Name</label>
          <input className="ef-input" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="ef-label">Description</label>
          <textarea className="ef-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="ef-modal-footer">
          <button className="ef-btn ef-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ef-btn ef-btn-primary" onClick={() => onSave({ name, description })} disabled={!name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
