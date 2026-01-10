import React from 'react';

interface Persona {
  id: string;
  name: string;
  species: string;
  race: string;
  gender: string;
  appearance: {
    height: string;
    weight: string;
    build: string;
    eyeColor: string;
    hairColor: string;
    hairStyle: string;
    attractiveness: string;
    distinctiveFeatures?: string;
  };
  aesthetic: string;
  currentOutfit: string;
  personality: string;
  skills: string;
  powers?: string;
  occupation: string;
  workplace?: string;
  sexualOrientation: string;
  relationshipStatus: string;
  relationshipPartner?: string;
  likes: string;
  turnOns: string;
  dislikes: string;
  turnOffs: string;
  kinks: string;
  backstory?: string;
  scenario?: string;
  description: string;
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

interface PersonaComponentProps {
  personas: Persona[];
  selectedPersona: string;
  onPersonaChange: (personaName: string) => void;
  onEditPersonas: () => void;
}

const PersonaComponent: React.FC<PersonaComponentProps> = ({
  personas,
  selectedPersona,
  onPersonaChange,
  onEditPersonas
}) => {
  const [personaOpen, setPersonaOpen] = React.useState(false);

  const selectedPersonaData = personas.find(p => p.name === selectedPersona);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Persona</h3>
        <button
          className="h-6 w-6 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-panel-tertiary rounded transition-colors"
          title="Edit personas"
          onClick={onEditPersonas}
        >
          ✎
        </button>
      </div>
      <div className="relative">
        {personaOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-20"
            onClick={() => setPersonaOpen(false)}
          />
        )}
        <div
          className="flex items-center p-3 bg-panel-tertiary rounded-lg cursor-pointer hover:bg-panel-border transition-colors relative z-30"
          onClick={() => setPersonaOpen(open => !open)}
        >
          {selectedPersonaData?.avatarUrl ? (
            <div className="avatar mr-3">
              <img src={selectedPersonaData.avatarUrl} alt="avatar" className="avatar-img" />
            </div>
          ) : (
            <div className="avatar mr-3">
              {(selectedPersonaData?.name || '').slice(0, 2)}
            </div>
          )}
          <span className="flex-1 text-text-primary text-sm font-medium">{selectedPersona}</span>
          <span className="text-text-secondary ml-2">▾</span>
        </div>

        {personaOpen && (
          <div className="absolute top-full left-0 right-0 border border-white/10 rounded-lg mt-1 z-40 shadow-lg glass" style={{ backgroundColor: 'rgba(30, 30, 50, 0.35)' }}>
            {personas.map((p) => (
              <div
                key={p.id}
                className="flex items-center p-3 hover:bg-panel-tertiary cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onPersonaChange(p.name);
                  setPersonaOpen(false);
                }}
              >
                {p.avatarUrl ? (
                  <div className="avatar mr-3">
                    <img src={p.avatarUrl} alt="avatar" className="avatar-img" />
                  </div>
                ) : (
                  <div className="avatar mr-3">
                    {(p.name || '').slice(0, 2)}
                  </div>
                )}
                <span className="text-text-primary text-sm font-medium">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonaComponent;