import React from 'react';

export default function ConfirmModal({ open, title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', onConfirm, onCancel, secondary }: any) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{title || 'Confirm'}</strong>
          <button className="icon-btn" onClick={onCancel}>✕</button>
        </div>
        <div style={{ marginTop: 8, color: '#cfd8dc' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="icon-btn" onClick={onCancel}>{cancelLabel}</button>
          {secondary && (
            <button className="icon-btn" onClick={secondary.onClick}>{secondary.label}</button>
          )}
          <button className="icon-btn primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
