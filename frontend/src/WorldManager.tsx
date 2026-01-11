import { useState, useEffect } from 'react';

interface World {
  id: number;
  slug: string;
  name: string;
  description?: string;
  lorebookUuids?: string[];
}

interface Lorebook {
  uuid: string;
  name: string;
  description?: string;
}

interface Campaign {
  id: number;
  worldId: number;
  slug: string;
  name: string;
  description?: string;
}

interface Arc {
  id: number;
  campaignId: number;
  orderIndex: number;
  name: string;
  description?: string;
}

interface Scene {
  id: number;
  arcId: number;
  orderIndex: number;
  title: string;
  description?: string;
  location?: string;
}

function WorldManager({ onRefresh, onSelectScene, selectedScene }: { onRefresh: () => void; onSelectScene?: (id: number) => void; selectedScene?: number | null }) {
  const [activeTab, setActiveTab] = useState<'worlds'|'campaigns'|'arcs'|'scenes'>('worlds');
  const [worlds, setWorlds] = useState<World[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);

  async function fetchWorlds() {
    const res = await fetch('/api/worlds');
    const data = await res.json();
    setWorlds(data);
  }

  const refreshAll = async () => {
    const worldsRes = await fetch('/api/worlds');
    const worldsData = await worldsRes.json();
    setWorlds(worldsData);

    const campaignsPromises = worldsData.map((w: any) => fetch(`/api/worlds/${w.id}/campaigns`).then(r => r.json()));
    const campaignsData = await Promise.all(campaignsPromises);
    setCampaigns(campaignsData.flat());

    const arcsPromises = campaignsData.flat().map((c: any) => fetch(`/api/campaigns/${c.id}/arcs`).then(r => r.json()));
    const arcsData = await Promise.all(arcsPromises);
    setArcs(arcsData.flat());

    const scenesPromises = arcsData.flat().map((a: any) => fetch(`/api/arcs/${a.id}/scenes`).then(r => r.json()));
    const scenesData = await Promise.all(scenesPromises);
    setScenes(scenesData.flat());

    const lorebooksRes = await fetch('/api/lorebooks');
    const lorebooksData = await lorebooksRes.json();
    setLorebooks(lorebooksData);
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let url = '';
    let method = editing ? 'PUT' : 'POST';
    let body = {};

    switch (activeTab) {
      case 'worlds':
        url = editing ? `/api/worlds/${editing.id}` : '/api/worlds';
        body = { name: form.name, description: form.description };
        break;
      case 'campaigns':
        url = editing ? `/api/campaigns/${editing.id}` : `/api/worlds/${form.worldId}/campaigns`;
        body = { name: form.name, description: form.description };
        break;
      case 'arcs':
        url = editing ? `/api/arcs/${editing.id}` : `/api/campaigns/${form.campaignId}/arcs`;
        body = { name: form.name, description: form.description };
        break;
      case 'scenes':
        url = editing ? `/api/scenes/${editing.id}` : `/api/arcs/${form.arcId}/scenes`;
        body = { title: form.title, description: form.description, location: form.location };
        break;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const saved = await res.json();

    // For campaigns, update lorebook assignments
    if (activeTab === 'campaigns' && form.lorebookUuids) {
      const campaignId = editing ? editing.id : saved.id;
      // Get current assignments
      const currentRes = await fetch(`/api/campaigns/${campaignId}/lorebooks`);
      const current = await currentRes.json();
      // Remove old ones not in new list
      for (const uuid of current) {
        if (!form.lorebookUuids.includes(uuid)) {
          await fetch(`/api/campaigns/${campaignId}/lorebooks/${uuid}`, { method: 'DELETE' });
        }
      }
      // Add new ones
      for (const uuid of form.lorebookUuids) {
        if (!current.includes(uuid)) {
          await fetch(`/api/campaigns/${campaignmpaignId}/lorebooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lorebookUuid: uuid }),
          });
        }
      }
    }

    setForm({});
    setEditing(null);
    refreshAll();
    onRefresh();
  };

  const handleEdit = (item: any) => {
    setEditing(item);
    setForm(item);
  };

  const handleDelete = async (id: number, type: string) => {
    if (confirm(`Are you sure you want to delete this ${type}?`)) {
      await fetch(`/api/${type}s/${id}`, { method: 'DELETE' });
      refreshAll();
      onRefresh();
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setForm({});
  };

  const renderForm = () => {
    switch (activeTab) {
      case 'worlds':
        return (
          <>
            <input
              type="text"
              placeholder="World Name"
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <textarea
              placeholder="Description"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <label>Lorebooks</label>
            <select
              multiple
              value={form.lorebookUuids || []}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, option => option.value);
                setForm({ ...form, lorebookUuids: selected });
              }}
            >
              {lorebooks.map(lb => (
                <option key={lb.uuid} value={lb.uuid}>{lb.name}</option>
              ))}
            </select>
          </>
        );
      case 'campaigns':
        return (
          <>
            <select
              value={form.worldId || ''}
              onChange={(e) => setForm({ ...form, worldId: Number(e.target.value) })}
              required
            >
              <option value="">Select World</option>
              {worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input
              type="text"
              placeholder="Campaign Name"
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <textarea
              placeholder="Description"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <label>Lorebooks</label>
            <select
              multiple
              value={form.lorebookUuids || []}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, option => option.value);
                setForm({ ...form, lorebookUuids: selected });
              }}
            >
              {lorebooks.map(lb => (
                <option key={lb.uuid} value={lb.uuid}>{lb.name}</option>
              ))}
            </select>
          </>
        );
      case 'arcs':
        return (
          <>
            <select
              value={form.campaignId || ''}
              onChange={(e) => setForm({ ...form, campaignId: Number(e.target.value) })}
              required
            >
              <option value="">Select Campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              type="text"
              placeholder="Arc Name"
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <textarea
              placeholder="Description"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </>
        );
      case 'scenes':
        return (
          <>
            <select
              value={form.arcId || ''}
              onChange={(e) => setForm({ ...form, arcId: Number(e.target.value) })}
              required
            >
              <option value="">Select Arc</option>
              {arcs.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              type="text"
              placeholder="Scene Title"
              value={form.title || ''}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <textarea
              placeholder="Description"
              value={form.description || ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <input
              type="text"
              placeholder="Location"
              value={form.location || ''}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </>
        );
    }
  };

  const renderList = () => {
    let items: any[] = [];
    let type = '';

    switch (activeTab) {
      case 'worlds':
        items = worlds;
        type = 'world';
        break;
      case 'campaigns':
        items = campaigns;
        type = 'campaign';
        break;
      case 'arcs':
        items = arcs;
        type = 'arc';
        break;
      case 'scenes':
        items = scenes;
        type = 'scene';
        break;
    }

    return (
      <div className="manager-list">
        {items.map(item => (
          <div key={item.id} className={`manager-item ${activeTab === 'scenes' && selectedScene === item.id ? 'selected' : ''}`}>
            <div className="manager-item-info">
              <strong>{item.name || item.title}</strong>
              <p>{item.description}</p>
            </div>
            <div className="manager-item-actions">
              {activeTab === 'scenes' && onSelectScene && (
                <button onClick={() => onSelectScene(item.id)} className={selectedScene === item.id ? 'active' : ''}>
                  {selectedScene === item.id ? 'Active' : 'Select'}
                </button>
              )}
              <button onClick={() => handleEdit(item)}>Edit</button>
              <button onClick={() => handleDelete(item.id, type)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="manager">
      <h2>Hierarchy Management</h2>
      <div className="tab-buttons">
        <button onClick={() => setActiveTab('worlds')} className={activeTab === 'worlds' ? 'active' : ''}>Worlds</button>
        <button onClick={() => setActiveTab('campaigns')} className={activeTab === 'campaigns' ? 'active' : ''}>Campaigns</button>
        <button onClick={() => setActiveTab('arcs')} className={activeTab === 'arcs' ? 'active' : ''}>Arcs</button>
        <button onClick={() => setActiveTab('scenes')} className={activeTab === 'scenes' ? 'active' : ''}>Scenes</button>
      </div>
      <form onSubmit={handleSubmit} className="manager-form">
        {renderForm()}
        <button type="submit">{editing ? 'Update' : 'Create'} {activeTab.slice(0, -1)}</button>
        {editing && <button type="button" onClick={handleCancel}>Cancel</button>}
      </form>
      {renderList()}
    </div>
  );
}

export default WorldManager;