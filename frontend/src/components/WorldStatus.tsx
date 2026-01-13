import React, { useState } from 'react';

interface WorldStatusProps {
  sessionContext: any | null;
}

interface ExpandedSections {
  [key: string]: boolean;
}

const SectionHeader = ({ title, section, expanded, onToggle }: { title: string; section: string; expanded: boolean; onToggle: () => void }) => (
  <button
    onClick={onToggle}
    className="w-full flex items-center gap-2 font-semibold text-text-primary hover:bg-panel-secondary p-2 rounded transition-colors"
    style={{ fontSize: '11px' }}
  >
    <span
      className={`inline-block transform transition-transform ${expanded ? '' : '-rotate-90'}`}
      style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      ▼
    </span>
    <span>{title}</span>
  </button>
);

const CharacterStateField = ({ label, value }: { label: string; value: string }) => (
  <div className="flex gap-6 mb-4 items-start">
    <div className="text-right" style={{ minWidth: '100px' }}>
      <span className="text-text-primary font-medium" style={{ fontSize: '10px' }}>{label}:&nbsp;&nbsp;</span>
    </div>
    <div className="flex-1" style={{ maxWidth: '280px' }}>
      <div
        className="bg-panel-secondary rounded p-2 text-text-secondary break-words resize-y overflow-hidden min-h-[20px]"
        style={{ 
          fontSize: '10px',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          cursor: 'nwse-resize',
        }}
        title="Drag to resize"
      >
        {value}
      </div>
    </div>
  </div>
);

export const WorldStatus: React.FC<WorldStatusProps> = ({ sessionContext }) => {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    worldState: true,
    trackers: true,
    characters: false,
  });

  const [expandedCharacters, setExpandedCharacters] = useState<ExpandedSections>({});

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleCharacter = (charName: string) => {
    setExpandedCharacters((prev) => ({
      ...prev,
      [charName]: !prev[charName],
    }));
  };

  const hasWorldState = sessionContext?.worldState && Object.keys(sessionContext.worldState).length > 0;
  const hasTrackers = sessionContext?.trackers && (
    (sessionContext.trackers.stats && Object.keys(sessionContext.trackers.stats).length > 0) ||
    (sessionContext.trackers.objectives && sessionContext.trackers.objectives.length > 0) ||
    (sessionContext.trackers.relationships && Object.keys(sessionContext.trackers.relationships).length > 0)
  );
  const hasCharacterStates =
    sessionContext?.scene?.characterStates && Object.keys(sessionContext.scene.characterStates).length > 0;

  if (!hasWorldState && !hasTrackers && !hasCharacterStates) {
    return <div className="text-text-secondary text-sm p-3">No world status available</div>;
  }

  return (
    <div className="space-y-2">
      {hasWorldState && (
        <div className="border border-border-color rounded-lg overflow-hidden">
          <SectionHeader title="World State" section="worldState" expanded={expandedSections.worldState} onToggle={() => toggleSection('worldState')} />
          {expandedSections.worldState && (
            <div className="bg-panel-secondary p-3 text-text-secondary font-mono overflow-x-auto max-h-64 overflow-y-auto" style={{ fontSize: '10px' }}>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(sessionContext.worldState, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {hasTrackers && (
        <div className="border border-border-color rounded-lg overflow-hidden">
          <SectionHeader title="Trackers" section="trackers" expanded={expandedSections.trackers} onToggle={() => toggleSection('trackers')} />
          {expandedSections.trackers && (
            <div className="p-3 space-y-3" style={{ fontSize: '10px' }}>
              {sessionContext.trackers.stats && Object.keys(sessionContext.trackers.stats).length > 0 && (
                <div>
                  <h4 className="font-medium text-text-primary mb-2">Stats</h4>
                  <ul className="list-disc list-inside text-text-secondary space-y-1">
                    {Object.entries(sessionContext.trackers.stats).map(([key, value]) => (
                      <li key={key}>
                        <span className="font-medium">{key}:</span> {String(value)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sessionContext.trackers.objectives && sessionContext.trackers.objectives.length > 0 && (
                <div>
                  <h4 className="font-medium text-text-primary mb-2">Objectives</h4>
                  <ul className="list-disc list-inside text-text-secondary space-y-1">
                    {sessionContext.trackers.objectives.map((obj: string, idx: number) => (
                      <li key={idx}>{obj}</li>
                    ))}
                  </ul>
                </div>
              )}

              {sessionContext.trackers.relationships &&
                Object.keys(sessionContext.trackers.relationships).length > 0 && (
                  <div>
                    <h4 className="font-medium text-text-primary mb-2">Relationships</h4>
                    <ul className="list-disc list-inside text-text-secondary space-y-1">
                      {Object.entries(sessionContext.trackers.relationships).map(([key, value]) => (
                        <li key={key}>
                          <span className="font-medium">{key}:</span> {String(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {hasCharacterStates && (
        <div className="border border-border-color rounded-lg overflow-hidden">
          <SectionHeader title="Character States" section="characters" expanded={expandedSections.characters} onToggle={() => toggleSection('characters')} />
          {expandedSections.characters && (
            <div className="p-3 space-y-2">
              {Object.entries(sessionContext.scene.characterStates).map(([charName, state]: [string, any]) => (
                <div key={charName} className="border border-border-color rounded-lg overflow-hidden bg-panel-secondary">
                  <button
                    onClick={() => toggleCharacter(charName)}
                    className="w-full flex items-center gap-2 p-3 hover:bg-panel-primary transition-colors font-medium text-text-primary"
                    style={{ fontSize: '10px' }}
                  >
                    <span
                      className={`inline-block transform transition-transform ${expandedCharacters[charName] ? '' : '-rotate-90'}`}
                      style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ▼
                    </span>
                    <span>{charName}</span>
                  </button>
                  
                  {expandedCharacters[charName] && (
                    <div className="p-4 bg-panel-secondary border-t border-border-color">
                      {state.location && <CharacterStateField label="Location" value={state.location} />}
                      {state.position && <CharacterStateField label="Position" value={state.position} />}
                      {state.activity && <CharacterStateField label="Activity" value={state.activity} />}
                      {state.mood && <CharacterStateField label="Mood" value={state.mood} />}
                      {state.clothingWorn && <CharacterStateField label="Clothing" value={state.clothingWorn} />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
