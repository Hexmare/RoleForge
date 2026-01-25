export interface RoleForgeCharacter {
  // Core Fields (identity)
  id: string;
  name: string;
  species: string;
  race: string;
  gender: string;
  description: string;  // Short bio (merged backstory/scenario)

  // Appearance & Style (consolidated)
  appearance: {
    physical?: string;   // e.g., "tall, athletic build" (consolidates height/weight/build/features)
    aesthetic?: string;  // e.g., "gothic, mysterious"
  };
  currentOutfit: string;  // Initial clothing; updates via state

  // Personality & Traits (merged)
  personality: string;    // Brief overview
  traits: {
    likes?: string[];     // Merged likes/turn-ons
    dislikes?: string[];  // Merged dislikes/turn-offs
    kinks?: string[];     // Sexual preferences
    secrets?: string[];   // Hidden information
    goals?: string[];     // Objectives/motivations
  };

  // Abilities & Role (merged)
  abilities: string[];    // Combined skills/powers (e.g., ["swordfighting", "fire magic"])
  occupation: string;     // Include workplace if relevant (e.g., "blacksmith at the forge")

  // Relationships (consolidated)
  sexualOrientation: string;
  relationshipStatus: string;  // e.g., "single" or "partnered with [name]"

  // Optional/Extension
  avatarUrl?: string;
  extensions?: Record<string, any>;
}

export interface Persona extends RoleForgeCharacter {
  // Inherits all from RoleForgeCharacter
}