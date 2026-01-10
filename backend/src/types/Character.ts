export interface RoleForgeCharacter {
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
  description?: string;
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

export interface Persona extends RoleForgeCharacter {
  // Inherits all from RoleForgeCharacter
}