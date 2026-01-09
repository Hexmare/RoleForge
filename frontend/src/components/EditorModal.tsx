import React from 'react';
import './editorModal.css';

interface Props {
  title: string;
  visible: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  children: React.ReactNode;
}

export default function EditorModal({ title, visible, onClose, onSave, children }: Props) {
  if (!visible) return null;
  return (
    <div className="ef-modal-overlay" onMouseDown={onClose}>
      <div className="ef-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ef-modal-header">
          <h3>{title}</h3>
          <button className="ef-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ef-modal-body">{children}</div>
        <div className="ef-modal-footer">
          <button className="ef-btn ef-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ef-btn ef-btn-primary" onClick={() => onSave(null)}>Save</button>
        </div>
      </div>
    </div>
  );
}
