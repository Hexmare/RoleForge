import React, { useEffect, useState } from 'react';

interface ScopeInfo {
  scope: string;
  count: number;
  sizeOnDisk: number;
  lastUpdated?: string;
}

export const VectorDiagnostics: React.FC = () => {
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/diagnostics/vector')
      .then((r) => r.json())
      .then((data) => {
        setScopes(Array.isArray(data.scopes) ? data.scopes : []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading vector diagnostics…</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h3>Vector Store Diagnostics</h3>
      <div>Total scopes: {scopes.length}</div>
      <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Scope</th>
            <th style={{ textAlign: 'right' }}>Count</th>
            <th style={{ textAlign: 'right' }}>Size (KB)</th>
            <th style={{ textAlign: 'right' }}>Last Updated</th>
          </tr>
        </thead>
        <tbody>
          {scopes.map((s) => (
            <tr key={s.scope}>
              <td>{s.scope}</td>
              <td style={{ textAlign: 'right' }}>{s.count}</td>
              <td style={{ textAlign: 'right' }}>{Math.round((s.sizeOnDisk || 0) / 1024)}</td>
              <td style={{ textAlign: 'right' }}>{s.lastUpdated || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default VectorDiagnostics;
