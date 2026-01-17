import React, { useEffect, useState } from 'react';

interface DebugConfigPanelProps {
  debugConfig: any;
  onSave: (payload: { enabledNamespaces?: string; colors?: boolean; whitelist?: string[] }) => Promise<any>;
}

const DebugConfigPanel: React.FC<DebugConfigPanelProps> = ({ debugConfig, onSave }) => {
  const [enabledNamespaces, setEnabledNamespaces] = useState('');
  const [colorsEnabled, setColorsEnabled] = useState(true);
  const [whitelistText, setWhitelistText] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabledNamespaces(debugConfig?.debug?.enabledNamespaces || '');
    setColorsEnabled(debugConfig?.debug?.colors ?? true);
    const whitelistValues = Array.isArray(debugConfig?.debug?.whitelist) ? debugConfig.debug.whitelist : [];
    setWhitelistText(whitelistValues.join('\n'));
  }, [debugConfig]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    const whitelistEntries = whitelistText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    try {
      await onSave({
        enabledNamespaces: enabledNamespaces.trim(),
        colors: colorsEnabled,
        whitelist: whitelistEntries
      });
      setStatus('Debug settings saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save debug settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass border border-border-color rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Debug logging configuration</h2>
        <p className="text-sm text-text-secondary">Edit the namespaces, colors, and whitelist that drive backend logging.</p>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Enabled namespaces</label>
        <input
          type="text"
          className="w-full rounded-lg border border-border-color bg-primary-bg/60 px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
          value={enabledNamespaces}
          onChange={(e) => setEnabledNamespaces(e.target.value)}
          placeholder="roleforge:agent:*,roleforge:services:*"
        />
        <p className="text-xs text-text-secondary">Comma-separated namespaces; only entries that match the whitelist will be applied.</p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={colorsEnabled}
            onChange={(e) => setColorsEnabled(e.target.checked)}
          />
          Enable colors
        </label>
        <span className="text-xs text-text-secondary">Toggle colorized console output for backend debug logs.</span>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Namespace whitelist</label>
        <textarea
          className="w-full min-h-[120px] rounded-lg border border-border-color bg-primary-bg/60 px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
          value={whitelistText}
          onChange={(e) => setWhitelistText(e.target.value)}
          placeholder="roleforge:server:*,roleforge:agents:*,roleforge:vectorstore:*"
        />
        <p className="text-xs text-text-secondary">One pattern per line. Use '*' to wildcard positions.</p>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {status && <p className="text-sm text-emerald-400">{status}</p>}
      <div className="flex justify-end">
        <button
          className="px-4 py-2 rounded-lg bg-accent-primary text-white transition-colors disabled:opacity-40"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
};

export default DebugConfigPanel;
