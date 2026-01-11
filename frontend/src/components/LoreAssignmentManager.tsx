import React, { useState, useEffect } from 'react';

interface Lorebook {
  uuid: string;
  name: string;
  description?: string;
  entries?: any[];
}

interface LoreAssignmentManagerProps {
  worldId?: number;
  campaignId?: number;
}

const LoreAssignmentManager: React.FC<LoreAssignmentManagerProps> = ({
  worldId,
  campaignId,
}) => {
  const [assignedLorebooks, setAssignedLorebooks] = useState<Lorebook[]>([]);
  const [availableLorebooks, setAvailableLorebooks] = useState<Lorebook[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Determine API endpoint based on whether worldId or campaignId is provided
  const endpoint = worldId ? `/api/worlds/${worldId}/lorebooks` : `/api/campaigns/${campaignId}/lorebooks`;

  // Load assigned lorebooks
  useEffect(() => {
    const loadAssignedLorebooks = async () => {
      if (!worldId && !campaignId) {
        console.log('LoreAssignmentManager: No worldId or campaignId provided');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log('LoreAssignmentManager: Loading assigned lorebooks from', endpoint);
        const response = await fetch(endpoint);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch assigned lorebooks: ${response.status}`);
        }
        
        const uuids: string[] = await response.json();
        console.log('LoreAssignmentManager: Assigned UUIDs:', uuids);
        
        // Fetch full lorebook details for each UUID
        const details = await Promise.all(
          uuids.map(uuid => 
            fetch(`/api/lorebooks/${uuid}`)
              .then(r => {
                if (!r.ok) throw new Error(`Failed to fetch lorebook ${uuid}`);
                return r.json();
              })
              .catch(err => {
                console.error(`Error fetching lorebook ${uuid}:`, err);
                return null;
              })
          )
        );
        
        const validDetails = details.filter(d => d !== null);
        console.log('LoreAssignmentManager: Loaded lorebook details:', validDetails);
        setAssignedLorebooks(validDetails);
      } catch (error) {
        console.error('LoreAssignmentManager: Failed to load assigned lorebooks:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAssignedLorebooks();
  }, [worldId, campaignId, endpoint]);

  // Load all available lorebooks
  useEffect(() => {
    const loadAvailableLorebooks = async () => {
      try {
        console.log('LoreAssignmentManager: Loading all lorebooks');
        const response = await fetch('/api/lorebooks');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch lorebooks: ${response.status}`);
        }
        
        const books: Lorebook[] = await response.json();
        console.log('LoreAssignmentManager: Total lorebooks available:', books.length);
        
        // Filter to only show unassigned ones
        const assigned = new Set(assignedLorebooks.map(lb => lb.uuid));
        const unassigned = books.filter(book => !assigned.has(book.uuid));
        
        console.log('LoreAssignmentManager: Assigned count:', assigned.size, 'Unassigned count:', unassigned.length);
        setAvailableLorebooks(unassigned);
      } catch (error) {
        console.error('LoreAssignmentManager: Failed to load available lorebooks:', error);
      }
    };

    loadAvailableLorebooks();
  }, [assignedLorebooks]);

  const handleAddLorebook = async (lorebookUuid: string) => {
    try {
      console.log('LoreAssignmentManager: Adding lorebook', lorebookUuid, 'to endpoint', endpoint);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lorebookUuid }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add lorebook: ${response.status}`);
      }

      console.log('LoreAssignmentManager: Successfully added lorebook');
      
      // Refresh assigned lorebooks
      const uuids: string[] = await fetch(endpoint).then(r => {
        if (!r.ok) throw new Error('Failed to fetch assigned lorebooks after add');
        return r.json();
      });
      
      const details = await Promise.all(
        uuids.map(uuid => 
          fetch(`/api/lorebooks/${uuid}`)
            .then(r => r.json())
            .catch(err => {
              console.error(`Error fetching lorebook ${uuid}:`, err);
              return null;
            })
        )
      );
      
      const validDetails = details.filter(d => d !== null);
      setAssignedLorebooks(validDetails);
      setShowAddModal(false);
    } catch (error) {
      console.error('LoreAssignmentManager: Failed to add lorebook:', error);
    }
  };

  const handleRemoveLorebook = async (lorebookUuid: string) => {
    try {
      console.log('LoreAssignmentManager: Removing lorebook', lorebookUuid, 'from endpoint', endpoint);
      const response = await fetch(`${endpoint}/${lorebookUuid}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to remove lorebook: ${response.status}`);
      }

      console.log('LoreAssignmentManager: Successfully removed lorebook');
      setAssignedLorebooks(prev => prev.filter(lb => lb.uuid !== lorebookUuid));
    } catch (error) {
      console.error('LoreAssignmentManager: Failed to remove lorebook:', error);
    }
  };

  if (loading) {
    return <div className="p-4 text-text-secondary">Loading lorebooks...</div>;
  }

  return (
    <div className="lore-assignment-manager p-4 rounded-lg glass">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Connected Lorebooks</h3>
        <button
          type="button"
          onClick={() => {
            console.log('LoreAssignmentManager: + button clicked, opening modal');
            setShowAddModal(true);
          }}
          className="btn-secondary text-sm"
          title="Add a lorebook"
        >
          ➕
        </button>
      </div>

      {/* Assigned Lorebooks List */}
      <div className="assigned-lorebooks space-y-2 mb-4">
        {assignedLorebooks.length === 0 ? (
          <p className="text-text-secondary text-sm italic">No lorebooks assigned yet</p>
        ) : (
          assignedLorebooks.map(lb => (
            <div
              key={lb.uuid}
              className="flex items-center justify-between p-3 rounded bg-bg-secondary border border-accent-secondary/20 hover:border-accent-secondary/50 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary truncate">{lb.name}</div>
                <div className="text-xs text-text-secondary">
                  {Array.isArray(lb.entries) ? `${lb.entries.length} entries` : 'Loading...'}
                </div>
              </div>
              <button
                onClick={() => handleRemoveLorebook(lb.uuid)}
                className="ml-2 px-2 py-1 text-accent-danger hover:bg-accent-danger/20 rounded transition"
                title="Remove this lorebook"
              >
                ❌
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add Lorebook Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 rounded-lg"
          onClick={(e) => {
            // Close modal only if clicking the backdrop, not the modal itself
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
            }
          }}
        >
          <div 
            className="bg-bg-primary p-6 rounded-lg max-w-md w-full mx-4 border border-accent-secondary/30"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-semibold text-text-primary mb-4">Add Lorebook</h4>
            
            {availableLorebooks.length === 0 ? (
              <p className="text-text-secondary text-sm mb-4">
                All lorebooks are already assigned to this {worldId ? 'world' : 'campaign'}.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                {availableLorebooks.map(lb => (
                  <div
                    key={lb.uuid}
                    className="p-3 rounded bg-bg-secondary border border-accent-secondary/20 hover:border-accent-secondary/50 cursor-pointer transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      console.log('LoreAssignmentManager: Lorebook selected:', lb.name, lb.uuid);
                      handleAddLorebook(lb.uuid);
                    }}
                  >
                    <div className="font-medium text-text-primary">{lb.name}</div>
                    {lb.description && (
                      <div className="text-xs text-text-secondary mt-1">{lb.description}</div>
                    )}
                    <div className="text-xs text-text-tertiary mt-1">
                      {Array.isArray(lb.entries) ? `${lb.entries.length} entries` : 'Loading...'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAddModal(false);
                }}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoreAssignmentManager;
