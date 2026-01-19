import { useState, useEffect } from 'react';
import LoreAssignmentManager from './components/LoreAssignmentManager';

interface World {
  id: number;
  slug: string;
  name: string;
  description?: string;
  authorNote?: string;
  settingDetails?: string;
  storyDetails?: string;
}

interface Campaign {
  id: number;
  worldId: number;
  slug: string;
  name: string;
  description?: string;
  authorNote?: string;
  plot?: string;
  goals?: string;
  storyDetails?: string;
}

interface Arc {
  id: number;
  campaignId: number;
  orderIndex: number;
  name: string;
  description?: string;
  authorNote?: string;
  plot?: string;
  goals?: string;
  storyDetails?: string;
}

interface Scene {
  id: number;
  arcId: number;
  orderIndex: number;
  title: string;
  description?: string;
  location?: string;
  authorNote?: string;
  plot?: string;
  goals?: string;
  scenario?: string;
}

type EditingType = 'world' | 'campaign' | 'arc' | 'scene' | null;

interface EditingItem {
  type: EditingType;
  item: World | Campaign | Arc | Scene | null;
}

function WorldManager({
  onRefresh,
  onSelectScene,
  selectedScene,
}: {
  onRefresh: () => void;
  onSelectScene?: (id: number) => void;
  selectedScene?: number | null;
}) {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);

  const [selectedWorld, setSelectedWorld] = useState<number | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [selectedArc, setSelectedArc] = useState<number | null>(null);

  const [editing, setEditing] = useState<EditingItem>({ type: null, item: null });
  const [form, setForm] = useState<any>({});

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
  };

  useEffect(() => {
    refreshAll();
  }, []);

  // Auto-expand hierarchy when selectedScene changes
  useEffect(() => {
    if (!selectedScene || scenes.length === 0) return;

    // Find the scene
    const scene = scenes.find(s => s.id === selectedScene);
    if (!scene) return;

    // Find the arc that contains this scene
    const arc = arcs.find(a => a.id === scene.arcId);
    if (!arc) return;

    // Find the campaign that contains this arc
    const campaign = campaigns.find(c => c.id === arc.campaignId);
    if (!campaign) return;

    // Find the world that contains this campaign
    const world = worlds.find(w => w.id === campaign.worldId);
    if (!world) return;

    // Expand the hierarchy
    setSelectedWorld(world.id);
    setSelectedCampaign(campaign.id);
    setSelectedArc(arc.id);
  }, [selectedScene, scenes, arcs, campaigns, worlds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing.type) return;

    let url = '';
    let method = editing.item && editing.item.id ? 'PUT' : 'POST';
    let body = {};

    switch (editing.type) {
      case 'world':
        url = editing.item && editing.item.id ? `/api/worlds/${editing.item.id}` : '/api/worlds';
        body = {
          name: form.name,
          description: form.description,
          authorNote: form.authorNote,
          settingDetails: form.settingDetails,
          storyDetails: form.storyDetails
        };
        break;
      case 'campaign':
        url = editing.item && editing.item.id ? `/api/campaigns/${editing.item.id}` : `/api/worlds/${form.worldId}/campaigns`;
        body = {
          name: form.name,
          description: form.description,
          authorNote: form.authorNote,
          plot: form.plot,
          goals: form.goals,
          storyDetails: form.storyDetails
        };
        break;
      case 'arc':
        url = editing.item && editing.item.id ? `/api/arcs/${editing.item.id}` : `/api/campaigns/${form.campaignId}/arcs`;
        body = {
          name: form.name,
          description: form.description,
          authorNote: form.authorNote,
          plot: form.plot,
          goals: form.goals,
          storyDetails: form.storyDetails
        };
        break;
      case 'scene':
        url = editing.item && editing.item.id ? `/api/scenes/${editing.item.id}` : `/api/arcs/${form.arcId}/scenes`;
        body = {
          title: form.title,
          description: form.description,
          authorNote: form.authorNote,
          plot: form.plot,
          goals: form.goals,
          scenario: form.scenario,
          location: form.location
        };
        break;
    }

    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.ok) {
      refreshAll();
      setEditing({ type: null, item: null });
      setForm({});
      onRefresh();
    }
  };

  const handleEdit = (type: EditingType, item: any) => {
    setEditing({ type, item });
    if (!item) {
      // Initialize form with defaults for new items
      if (type === 'world') {
        setForm({ name: '', description: '', authorNote: '', settingDetails: '', storyDetails: '' });
      } else if (type === 'campaign') {
        setForm({ name: '', description: '', authorNote: '', plot: '', goals: '', storyDetails: '', worldId: selectedWorld });
      } else if (type === 'arc') {
        setForm({ name: '', description: '', authorNote: '', plot: '', goals: '', storyDetails: '', orderIndex: 0 });
      } else if (type === 'scene') {
        setForm({ title: '', description: '', authorNote: '', plot: '', goals: '', scenario: '', location: '', orderIndex: 0 });
      }
    } else {
      setForm(item);
    }
  };

  const handleDelete = async (id: number, type: string) => {
    if (confirm(`Delete this ${type}?`)) {
      await fetch(`/api/${type}s/${id}`, { method: 'DELETE' });
      refreshAll();
      setEditing({ type: null, item: null });
      setForm({});
      onRefresh();
    }
  };

  const handleCancel = () => {
    setEditing({ type: null, item: null });
    setForm({});
  };

  // Get filtered data
  const filteredCampaigns = selectedWorld ? campaigns.filter(c => c.worldId === selectedWorld) : [];
  const filteredArcs = selectedCampaign ? arcs.filter(a => a.campaignId === selectedCampaign) : [];
  const filteredScenes = selectedArc ? scenes.filter(s => s.arcId === selectedArc) : [];

  const renderEditorForm = () => {
    if (!editing.type) return null;

    switch (editing.type) {
      case 'world':
        return (
          <>
            <div className="form-group">
              <label>World Name *</label>
              <input
                type="text"
                placeholder="World Name"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Description"
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label>Author Note</label>
              <textarea
                placeholder="Author Note"
                value={form.authorNote || ''}
                onChange={(e) => setForm({ ...form, authorNote: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Setting Details</label>
              <textarea
                placeholder="Setting details and tone"
                value={form.settingDetails || ''}
                onChange={(e) => setForm({ ...form, settingDetails: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Story Details</label>
              <textarea
                placeholder="Core story beats or canon"
                value={form.storyDetails || ''}
                onChange={(e) => setForm({ ...form, storyDetails: e.target.value })}
                rows={3}
              />
            </div>
            {editing.item && (editing.item as World).id && (
              <div className="form-group">
                <label>Lore Management</label>
                <LoreAssignmentManager worldId={(editing.item as World).id} />
              </div>
            )}
          </>
        );
      case 'campaign':
        return (
          <>
            <div className="form-group">
              <label>World *</label>
              <select
                value={form.worldId || ''}
                onChange={(e) => setForm({ ...form, worldId: Number(e.target.value) })}
                required
              >
                <option value="">Select World</option>
                {worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Campaign Name *</label>
              <input
                type="text"
                placeholder="Campaign Name"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Description"
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label>Author Note</label>
              <textarea
                placeholder="Author guidance"
                value={form.authorNote || ''}
                onChange={(e) => setForm({ ...form, authorNote: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Plot</label>
              <textarea
                placeholder="Plot outline"
                value={form.plot || ''}
                onChange={(e) => setForm({ ...form, plot: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Goals</label>
              <textarea
                placeholder="Goals or objectives"
                value={form.goals || ''}
                onChange={(e) => setForm({ ...form, goals: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Story Details</label>
              <textarea
                placeholder="Continuity notes"
                value={form.storyDetails || ''}
                onChange={(e) => setForm({ ...form, storyDetails: e.target.value })}
                rows={3}
              />
            </div>
            {editing.item && (editing.item as Campaign).id && (
              <div className="form-group">
                <label>Lore Management</label>
                <LoreAssignmentManager campaignId={(editing.item as Campaign).id} />
              </div>
            )}
          </>
        );
      case 'arc':
        return (
          <>
            <div className="form-group">
              <label>Campaign *</label>
              <select
                value={form.campaignId || ''}
                onChange={(e) => setForm({ ...form, campaignId: Number(e.target.value) })}
                required
              >
                <option value="">Select Campaign</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Arc Name *</label>
              <input
                type="text"
                placeholder="Arc Name"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Description"
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label>Author Note</label>
              <textarea
                placeholder="Author note"
                value={form.authorNote || ''}
                onChange={(e) => setForm({ ...form, authorNote: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Plot</label>
              <textarea
                placeholder="Plot outline"
                value={form.plot || ''}
                onChange={(e) => setForm({ ...form, plot: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Goals</label>
              <textarea
                placeholder="Goals"
                value={form.goals || ''}
                onChange={(e) => setForm({ ...form, goals: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Story Details</label>
              <textarea
                placeholder="Story details"
                value={form.storyDetails || ''}
                onChange={(e) => setForm({ ...form, storyDetails: e.target.value })}
                rows={3}
              />
            </div>
          </>
        );
      case 'scene':
        return (
          <>
            <div className="form-group">
              <label>Arc *</label>
              <select
                value={form.arcId || ''}
                onChange={(e) => setForm({ ...form, arcId: Number(e.target.value) })}
                required
              >
                <option value="">Select Arc</option>
                {arcs.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Scene Title *</label>
              <input
                type="text"
                placeholder="Scene Title"
                value={form.title || ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                placeholder="Location"
                value={form.location || ''}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Description"
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
              />
            </div>
            <div className="form-group">
              <label>Author Note</label>
              <textarea
                placeholder="Author note"
                value={form.authorNote || ''}
                onChange={(e) => setForm({ ...form, authorNote: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Plot</label>
              <textarea
                placeholder="Plot"
                value={form.plot || ''}
                onChange={(e) => setForm({ ...form, plot: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Goals</label>
              <textarea
                placeholder="Goals"
                value={form.goals || ''}
                onChange={(e) => setForm({ ...form, goals: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Scenario</label>
              <textarea
                placeholder="Scenario"
                value={form.scenario || ''}
                onChange={(e) => setForm({ ...form, scenario: e.target.value })}
                rows={3}
              />
            </div>
          </>
        );
    }
  };

  return (
    <div className="world-manager" style={{ display: 'flex', height: '100%', gap: '1.5rem', padding: '1.5rem', position: 'relative' }}>
      {/* LEFT SIDEBAR - HIERARCHY TREE */}
      <div
        className="hierarchy-sidebar"
        style={{
          width: '320px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          padding: '1.5rem',
          overflowY: 'auto',
          background: 'linear-gradient(135deg, rgba(30, 30, 50, 0.8), rgba(40, 40, 60, 0.8))',
          border: '1px solid rgba(100, 150, 255, 0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '1rem', fontWeight: 'bold', fontSize: '1.1rem', color: '#fff' }}>
          World Hierarchy
        </h3>

        {/* Worlds */}
        <div style={{ marginBottom: '1rem' }}>
          <button
            onClick={() => handleEdit('world', null)}
            style={{
              width: '100%',
              padding: '0.75rem',
              marginBottom: '0.75rem',
              backgroundColor: 'rgba(100, 150, 255, 0.25)',
              border: '1px solid rgba(100, 150, 255, 0.6)',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#fff',
              fontWeight: 'bold',
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 150, 255, 0.4)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 150, 255, 0.25)';
            }}
          >
            ➕ New World
          </button>

          <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
            Worlds ({worlds.length})
          </div>
          
          {worlds.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', padding: '0.5rem', textAlign: 'center' }}>
              No worlds yet
            </div>
          ) : (
            worlds.map(world => (
              <div key={world.id} style={{ marginBottom: '1rem' }}>
                <button
                  onClick={() => {
                    setSelectedWorld(world.id);
                    setSelectedCampaign(null);
                    setSelectedArc(null);
                    handleEdit('world', world);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: selectedWorld === world.id ? 'rgba(100, 200, 100, 0.35)' : 'rgba(255,255,255,0.05)',
                    border: selectedWorld === world.id ? '1.5px solid rgba(100, 200, 100, 0.7)' : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'white',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: selectedWorld === world.id ? 'bold' : 'normal',
                    transition: 'all 0.2s',
                  }}
                >
                  🌍 {world.name}
                </button>

                {/* Campaigns */}
                {selectedWorld === world.id && (
                  <div style={{ marginLeft: '0.75rem', marginTop: '0.75rem', marginBottom: '0.75rem', paddingLeft: '0.75rem', borderLeft: '2px solid rgba(100, 150, 255, 0.3)' }}>
                    <button
                      onClick={() => {
                        setSelectedCampaign(null);
                        setSelectedArc(null);
                        handleEdit('campaign', { worldId: world.id });
                      }}
                      style={{
                        width: '100%',
                        padding: '0.6rem',
                        marginBottom: '0.5rem',
                        backgroundColor: 'rgba(150, 100, 255, 0.2)',
                        border: '1px solid rgba(150, 100, 255, 0.5)',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        color: 'white',
                        fontWeight: 'bold',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(150, 100, 255, 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(150, 100, 255, 0.2)';
                      }}
                    >
                      ➕ New Campaign
                    </button>

                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.5rem' }}>
                      Campaigns ({filteredCampaigns.length})
                    </div>

                    {filteredCampaigns.length === 0 ? (
                      <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)', padding: '0.4rem' }}>
                        No campaigns
                      </div>
                    ) : (
                      filteredCampaigns.map(campaign => (
                        <div key={campaign.id} style={{ marginBottom: '0.75rem' }}>
                          <button
                            onClick={() => {
                              setSelectedCampaign(campaign.id);
                              setSelectedArc(null);
                              handleEdit('campaign', campaign);
                            }}
                            style={{
                              width: '100%',
                              padding: '0.6rem',
                              backgroundColor: selectedCampaign === campaign.id ? 'rgba(150, 200, 100, 0.3)' : 'rgba(255,255,255,0.03)',
                              border: selectedCampaign === campaign.id ? '1.5px solid rgba(150, 200, 100, 0.6)' : '1px solid rgba(255,255,255,0.05)',
                              borderRadius: '5px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: '0.85rem',
                              color: 'white',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontWeight: selectedCampaign === campaign.id ? 'bold' : 'normal',
                              transition: 'all 0.2s',
                            }}
                          >
                            📖 {campaign.name}
                          </button>

                          {/* Arcs */}
                          {selectedCampaign === campaign.id && (
                            <div style={{ marginLeft: '0.75rem', marginTop: '0.5rem', marginBottom: '0.5rem', paddingLeft: '0.75rem', borderLeft: '2px solid rgba(150, 100, 255, 0.2)' }}>
                              <button
                                onClick={() => {
                                  setSelectedArc(null);
                                  handleEdit('arc', { campaignId: campaign.id });
                                }}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem',
                                  marginBottom: '0.4rem',
                                  backgroundColor: 'rgba(200, 100, 150, 0.15)',
                                  border: '1px solid rgba(200, 100, 150, 0.4)',
                                  borderRadius: '5px',
                                  cursor: 'pointer',
                                  fontSize: '0.8rem',
                                  color: 'white',
                                  fontWeight: 'bold',
                                  transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(200, 100, 150, 0.25)';
                                }}
                                onMouseLeave={(e) => {
                                  (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(200, 100, 150, 0.15)';
                                }}
                              >
                                ➕ New Arc
                              </button>

                              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)', marginBottom: '0.4rem' }}>
                                Arcs ({filteredArcs.length})
                              </div>

                              {filteredArcs.length === 0 ? (
                                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', padding: '0.3rem' }}>
                                  No arcs
                                </div>
                              ) : (
                                filteredArcs.map(arc => (
                                  <div key={arc.id} style={{ marginBottom: '0.6rem' }}>
                                    <button
                                      onClick={() => {
                                        setSelectedArc(arc.id);
                                        handleEdit('arc', arc);
                                      }}
                                      style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        backgroundColor: selectedArc === arc.id ? 'rgba(200, 150, 100, 0.25)' : 'rgba(255,255,255,0.02)',
                                        border: selectedArc === arc.id ? '1.5px solid rgba(200, 150, 100, 0.5)' : '1px solid rgba(255,255,255,0.03)',
                                        borderRadius: '5px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontSize: '0.8rem',
                                        color: 'white',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        fontWeight: selectedArc === arc.id ? 'bold' : 'normal',
                                        transition: 'all 0.2s',
                                      }}
                                    >
                                      📜 {arc.name}
                                    </button>

                                    {/* Scenes */}
                                    {selectedArc === arc.id && (
                                      <div style={{ marginLeft: '0.75rem', marginTop: '0.4rem', paddingLeft: '0.75rem', borderLeft: '2px solid rgba(200, 100, 150, 0.15)' }}>
                                        <button
                                          onClick={() => handleEdit('scene', { arcId: arc.id })}
                                          style={{
                                            width: '100%',
                                            padding: '0.4rem',
                                            marginBottom: '0.3rem',
                                            backgroundColor: 'rgba(100, 200, 200, 0.15)',
                                            border: '1px solid rgba(100, 200, 200, 0.4)',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            color: 'white',
                                            fontWeight: 'bold',
                                            transition: 'all 0.2s',
                                          }}
                                          onMouseEnter={(e) => {
                                            (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 200, 200, 0.25)';
                                          }}
                                          onMouseLeave={(e) => {
                                            (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 200, 200, 0.15)';
                                          }}
                                        >
                                          ➕ New Scene
                                        </button>

                                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.3rem' }}>
                                          Scenes ({filteredScenes.length})
                                        </div>

                                        {filteredScenes.length === 0 ? (
                                          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', padding: '0.2rem' }}>
                                            No scenes
                                          </div>
                                        ) : (
                                          filteredScenes.map(scene => (
                                            <div
                                              key={scene.id}
                                              style={{
                                                marginBottom: '0.3rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.3rem',
                                              }}
                                            >
                                              <button
                                                onClick={() => {
                                                  handleEdit('scene', scene);
                                                  if (onSelectScene) onSelectScene(scene.id);
                                                }}
                                                style={{
                                                  flex: 1,
                                                  padding: '0.4rem',
                                                  backgroundColor: selectedScene === scene.id ? 'rgba(100, 200, 200, 0.3)' : 'rgba(255,255,255,0.02)',
                                                  border: selectedScene === scene.id ? '1px solid rgba(100, 200, 200, 0.6)' : '1px solid rgba(255,255,255,0.03)',
                                                  borderRadius: '4px',
                                                  cursor: 'pointer',
                                                  textAlign: 'left',
                                                  fontSize: '0.75rem',
                                                  color: 'white',
                                                  whiteSpace: 'nowrap',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  fontWeight: selectedScene === scene.id ? 'bold' : 'normal',
                                                  transition: 'all 0.2s',
                                                }}
                                              >
                                                🎬 {scene.title}
                                              </button>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL - EDITOR */}
      <div
        className="editor-panel"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          padding: '1.5rem',
          overflowY: 'auto',
          background: 'linear-gradient(135deg, rgba(30, 30, 50, 0.6), rgba(40, 40, 60, 0.6))',
          border: '1px solid rgba(100, 200, 100, 0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          maxHeight: 'calc(100vh - 200px)',
        }}
      >
        {editing.type ? (
          <>
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem', textTransform: 'capitalize', fontSize: '1.3rem', color: '#fff' }}>
              {editing.item ? `Edit ${editing.type}` : `Create New ${editing.type}`}
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                {renderEditorForm()}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    backgroundColor: 'rgba(100, 200, 100, 0.3)',
                    border: '1px solid rgba(100, 200, 100, 0.7)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 200, 100, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(100, 200, 100, 0.3)';
                  }}
                >
                  {editing.item ? '💾 Update' : '✨ Create'}
                </button>

                {editing.item && (
                  <button
                    type="button"
                    onClick={() => handleDelete((editing.item as any).id, editing.type!)}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: 'rgba(255, 100, 100, 0.2)',
                      border: '1px solid rgba(255, 100, 100, 0.6)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      color: '#ff8080',
                      fontWeight: 'bold',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(255, 100, 100, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(255, 100, 100, 0.2)';
                    }}
                  >
                    🗑️ Delete
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCancel}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    color: 'rgba(255,255,255,0.8)',
                    fontWeight: 'bold',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </form>
          </>
        ) : (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: '3rem 2rem', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>👈 Select an item from the hierarchy</p>
              <p style={{ fontSize: '0.9rem' }}>or create a new one to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorldManager;