import React, { useState } from 'react';

interface Character {
  id: string;
  name: string;
  avatarUrl?: string;
}

interface ActiveCharacterComponentProps {
  characters: Character[];
  activeCharacters: string[];
  onApplySelections: (selectedCharacters: string[]) => void;
}

const ActiveCharacterComponent: React.FC<ActiveCharacterComponentProps> = ({
  characters,
  activeCharacters,
  onApplySelections
}) => {
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>(activeCharacters);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCheckboxChange = (characterId: string, checked: boolean) => {
    if (checked) {
      setSelectedCharacters([...selectedCharacters, characterId]);
    } else {
      setSelectedCharacters(selectedCharacters.filter(id => id !== characterId));
    }
  };

  const handleCancel = () => {
    setSelectedCharacters(activeCharacters);
    setIsExpanded(false);
  };

  const handleApply = () => {
    onApplySelections(selectedCharacters);
    setIsExpanded(false);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">Active Characters</h3>
      <div className="space-y-2">
        {activeCharacters.length > 0 ? (
          <div className="space-y-1">
            {activeCharacters.map((characterId) => {
              const character = characters.find(c => c.id === characterId);
              return (
                <div key={characterId} className="flex items-center space-x-2">
                  <div className="avatar flex-shrink-0">
                    {character?.avatarUrl ? (
                      <img src={character.avatarUrl} alt="avatar" className="avatar-img" />
                    ) : (
                      (character?.name || '??').slice(0, 2)
                    )}
                  </div>
                  <span className="text-text-primary text-sm">{character?.name || 'Unknown'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-text-secondary">No active characters</div>
        )}

        {!isExpanded ? (
          <button
            className="w-full h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-panel-tertiary rounded text-sm transition-colors"
            onClick={() => setIsExpanded(true)}
          >
            👥 Manage Characters
          </button>
        ) : (
          <div className="space-y-3">
            <div className={`space-y-2 ${characters.length > 5 ? 'max-h-48 overflow-y-auto' : ''}`}>
              {characters.filter(c => c.name).map((character) => (
                <label key={character.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded hover:bg-panel-tertiary transition-colors">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-accent-primary bg-panel-secondary border-border-color rounded focus:ring-accent-primary"
                    checked={selectedCharacters.includes(character.id)}
                    onChange={(e) => handleCheckboxChange(character.id, e.target.checked)}
                  />
                  <div className="avatar flex-shrink-0">
                    {character.avatarUrl ? (
                      <img src={character.avatarUrl} alt="avatar" className="avatar-img" />
                    ) : (
                      (character.name || '??').slice(0, 2)
                    )}
                  </div>
                  <span className="text-text-primary text-sm flex-1">{character.name || 'Unnamed'}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border-color">
              <button
                className="flex-1 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-panel-tertiary rounded text-sm transition-colors"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                className="flex-1 h-8 bg-accent-primary hover:bg-accent-hover text-white rounded text-sm transition-colors"
                onClick={handleApply}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActiveCharacterComponent;