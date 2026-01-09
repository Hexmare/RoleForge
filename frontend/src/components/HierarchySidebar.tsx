import { useState } from 'react';

interface Props {
  worlds: any[];
  campaigns: any[];
  arcs: any[];
  scenes: any[];
  selectedWorld?: number | null;
  selectedCampaign?: number | null;
  selectedArc?: number | null;
  selectedScene?: number | null;
  onSelectWorld: (id: number) => void;
  onSelectCampaign: (id: number) => void;
  onSelectArc: (id: number) => void;
  onSelectScene: (id: number) => void;
  fetchCampaigns: (worldId: number) => void;
  fetchArcs: (campaignId: number) => void;
  fetchScenes: (arcId: number) => void;
}

export default function HierarchySidebar({ worlds, campaigns, arcs, scenes, selectedWorld, selectedCampaign, selectedArc, selectedScene, onSelectWorld, onSelectCampaign, onSelectArc, onSelectScene, fetchCampaigns, fetchArcs, fetchScenes }: Props) {
  const [expandedWorlds, setExpandedWorlds] = useState<Record<number, boolean>>({});
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<number, boolean>>({});
  const [expandedArcs, setExpandedArcs] = useState<Record<number, boolean>>({});

  return (
    <aside className="ef-sidebar">
      <div className="ef-sidebar-header">Campaigns</div>
      <div className="ef-tree">
        {worlds.map(w => (
          <div key={w.id} className="ef-tree-world">
            <div className={`ef-tree-node ${selectedWorld === w.id ? 'selected' : ''}`} onClick={() => { onSelectWorld(w.id); fetchCampaigns(w.id); setExpandedWorlds(s => ({ ...s, [w.id]: !s[w.id] })); }}>
              <span className="caret">{expandedWorlds[w.id] ? '▾' : '▸'}</span>
              <strong>{w.name}</strong>
            </div>
            {expandedWorlds[w.id] && (
              <div className="ef-tree-children">
                {campaigns.filter(c => c.worldId === w.id).map(c => (
                  <div key={c.id}>
                    <div className={`ef-tree-node small ${selectedCampaign === c.id ? 'selected' : ''}`} onClick={() => { onSelectCampaign(c.id); fetchArcs(c.id); setExpandedCampaigns(s => ({ ...s, [c.id]: !s[c.id] })); }}>
                      <span className="caret">{expandedCampaigns[c.id] ? '▾' : '▸'}</span>
                      {c.name}
                    </div>
                    {expandedCampaigns[c.id] && (
                      <div className="ef-tree-children">
                        {arcs.filter(a => a.campaignId === c.id).map(a => (
                          <div key={a.id}>
                            <div className={`ef-tree-node tiny ${selectedArc === a.id ? 'selected' : ''}`} onClick={() => { onSelectArc(a.id); fetchScenes(a.id); setExpandedArcs(s => ({ ...s, [a.id]: !s[a.id] })); }}>
                              <span className="caret">{expandedArcs[a.id] ? '▾' : '▸'}</span>
                              {a.name}
                            </div>
                            {expandedArcs[a.id] && (
                              <div className="ef-tree-children">
                                {scenes.filter(s => s.arcId === a.id).map(sc => (
                                  <div key={sc.id} className={`ef-tree-node xsmall ${selectedScene === sc.id ? 'selected' : ''}`} onClick={() => onSelectScene(sc.id)}>
                                    {sc.title}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
