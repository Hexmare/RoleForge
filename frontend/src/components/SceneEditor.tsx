import { useState, useEffect } from 'react';

interface Props {
  visible: boolean;
  initial?: { title?: string; description?: string; authorNote?: string; plot?: string; goals?: string; scenario?: string; orderIndex?: number; location?: string; timeOfDay?: string };
  onClose: () => void;
  onSave: (payload: { title: string; description?: string; authorNote?: string; plot?: string; goals?: string; scenario?: string; orderIndex?: number; location?: string; timeOfDay?: string }) => void;
}

export default function SceneEditor({ visible, initial, onClose, onSave }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [authorNote, setAuthorNote] = useState('');
  const [plot, setPlot] = useState('');
  const [goals, setGoals] = useState('');
  const [scenario, setScenario] = useState('');
  
  const [location, setLocation] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('');

  useEffect(() => {
    setTitle(initial?.title || '');
    setDescription(initial?.description || '');
    setAuthorNote(initial?.authorNote || '');
    setPlot(initial?.plot || '');
    setGoals(initial?.goals || '');
    setScenario(initial?.scenario || '');
    // orderIndex is auto-assigned by backend
    setLocation(initial?.location || '');
    setTimeOfDay(initial?.timeOfDay || '');
  }, [initial, visible]);

  if (!visible) return null;

  return (
    <div className="ef-modal-overlay" onMouseDown={onClose}>
      <div className="ef-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-header">
          <h3>{initial ? 'Edit Scene' : 'New Scene'}</h3>
          <button className="ef-close" onClick={onClose}>✕</button>
        </div>
        <div className="ef-modal-body">
          <label className="ef-label">Title</label>
          <input className="ef-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="ef-note">Order will be assigned automatically.</div>
          <label className="ef-label">Location</label>
          <input className="ef-input" value={location} onChange={(e) => setLocation(e.target.value)} />
          <label className="ef-label">Time of Day</label>
          <input className="ef-input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
          <label className="ef-label">Description</label>
          <textarea className="ef-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="ef-label">Author Note</label>
          <textarea className="ef-textarea" value={authorNote} onChange={(e) => setAuthorNote(e.target.value)} />
          <label className="ef-label">Plot</label>
          <textarea className="ef-textarea" value={plot} onChange={(e) => setPlot(e.target.value)} />
          <label className="ef-label">Goals</label>
          <textarea className="ef-textarea" value={goals} onChange={(e) => setGoals(e.target.value)} />
          <label className="ef-label">Scenario</label>
          <textarea className="ef-textarea" value={scenario} onChange={(e) => setScenario(e.target.value)} />
        </div>
        <div className="ef-modal-footer">
          <button className="ef-btn ef-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="ef-btn ef-btn-primary"
            onClick={() => onSave({ title, description, authorNote, plot, goals, scenario, location, timeOfDay })}
            disabled={!title.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
