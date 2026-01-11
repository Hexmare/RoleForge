import React, { useState } from 'react';

export default function RowToggle({ enabled = false, onToggle }: { enabled?: boolean; onToggle?: (next: boolean) => Promise<void> | void }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try {
      await onToggle?.(!enabled);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button aria-pressed={!!enabled} onClick={handle} className={`w-9 h-6 rounded-full p-0.5 flex items-center transition-colors ${enabled ? 'bg-orange-500' : 'bg-gray-700'}`}>
      <span className={`w-4 h-4 rounded-full bg-white transform transition-transform ${enabled ? 'translate-x-3' : 'translate-x-0'}`} />
    </button>
  );
}
