import React from 'react';

interface ConfigModalProps {
  onClose: () => void;
}

const ConfigModal: React.FC<ConfigModalProps> = ({ onClose }) => {
  return (
    <div className="manager p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-text-primary">Configuration</h2>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded bg-panel-secondary text-text-primary" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="bg-panel p-4 rounded space-y-4 text-sm text-text-secondary">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-text-primary">Enable streaming</div>
            <div className="text-xs">Stream AI responses as they arrive</div>
          </div>
          <input type="checkbox" aria-label="Enable streaming" />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-text-primary">Debug logs</div>
            <div className="text-xs">Show extended debug output in console</div>
          </div>
          <input type="checkbox" aria-label="Debug logs" />
        </div>

        <div>
          <div className="font-medium text-text-primary">Theme</div>
          <select className="mt-1 w-full p-2 bg-panel-secondary rounded text-text-primary">
            <option>Auto</option>
            <option>Light</option>
            <option>Dark</option>
          </select>
        </div>

        <div className="flex justify-end">
          <button className="px-3 py-1 rounded bg-accent-primary text-white" onClick={onClose}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default ConfigModal;
