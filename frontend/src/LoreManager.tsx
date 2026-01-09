import { useState, useEffect } from 'react';

interface Lorebook {
  id: number;
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  recursive_scanning: boolean;
  extensions: Record<string, any>;
  entries: any[];
}

function LoreManager() {
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [editing, setEditing] = useState<Lorebook | null>(null);
  const [form, setForm] = useState<Partial<Lorebook>>({});

  async function fetchLorebooks() {
    const res = await fetch('/api/lorebooks');
    const data = await res.json();
    setLorebooks(data);
  }

  useEffect(() => {
    fetchLorebooks();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      await fetch(`/api/lorebooks/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/lorebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    fetchLorebooks();
    setEditing(null);
    setForm({});
  };

  const handleEdit = (lb: Lorebook) => {
    setEditing(lb);
    setForm(lb);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/lorebooks/${id}`, { method: 'DELETE' });
    fetchLorebooks();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          await fetch('/api/lorebooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          fetchLorebooks();
        } catch (err) {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="manager">
      <h2>Lore Manager</h2>
      <input type="file" accept=".json" onChange={handleImport} />
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Name"
          value={form.name || ''}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <textarea
          placeholder="Description"
          value={form.description || ''}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <input
          type="number"
          placeholder="Scan Depth"
          value={form.scan_depth || 0}
          onChange={(e) => setForm({ ...form, scan_depth: +e.target.value })}
        />
        <input
          type="number"
          placeholder="Token Budget"
          value={form.token_budget || 0}
          onChange={(e) => setForm({ ...form, token_budget: +e.target.value })}
        />
        <label>
          Recursive Scanning
          <input
            type="checkbox"
            checked={form.recursive_scanning || false}
            onChange={(e) => setForm({ ...form, recursive_scanning: e.target.checked })}
          />
        </label>
        <textarea
          placeholder="Entries (JSON)"
          value={JSON.stringify(form.entries || [], null, 2)}
          onChange={(e) => {
            try {
              setForm({ ...form, entries: JSON.parse(e.target.value) });
            } catch {}
          }}
        />
        <button type="submit">{editing ? 'Update' : 'Create'}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm({}); }}>Cancel</button>}
      </form>
      <ul>
        {lorebooks.map((lb) => (
          <li key={lb.id}>
            {lb.name}
            <button onClick={() => handleEdit(lb)}>Edit</button>
            <button onClick={() => handleDelete(lb.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default LoreManager;