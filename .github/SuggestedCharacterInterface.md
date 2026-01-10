Here is a suggested character interface
```typescript
interface RoleForgeCharacter {
  // ── Immutable identity ───────────────────────────────────────
  id: string;                     // UUID or slug
  name: string;
  species: string;                // "Human", "Elf", "Succubus", "Android", etc.
  race: string;                   // "Caucasian", "Dark Elf", "Latino", etc.
  gender: string;                 // "Female", "Male", "Non-binary", "Futa", etc.

  // ── Visual / Physical (great for image gen prompts) ──────────
  appearance: {
    height: string;               // "5'8\"", "172 cm", etc.
    weight: string;               // "135 lbs", "61 kg"
    build: string;                // "athletic", "curvy", "slender", "muscular"
    eyeColor: string;             // "emerald green", "heterochromia (blue/red)"
    hairColor: string;            // "raven black", "strawberry blonde"
    hairStyle: string;            // "long wavy", "pixie cut", "twin tails"
    attractiveness: string;        // "stunning", "cute", "exotic", "intimidatingly beautiful" (subjective scale)
    distinctiveFeatures?: string; // "freckles, scar on left cheek, glowing tattoos" (optional)
  };

  aesthetic: string;              // Comma-separated: "goth, cyberpunk, elegant, streetwear"

  currentOutfit: string;          // Comma-separated or short phrase: "black leather jacket, fishnet top, ripped jeans, combat boots"

  // ── Personality & Behavior (very important for LLM) ──────────
  personality: string;            // Comma-separated traits: "sarcastic, confident, nurturing, chaotic neutral, teasing, loyal"

  // ── Abilities / Profession ───────────────────────────────────
  skills: string;                 // Comma-separated: "hacking, swordsmanship, seduction, first aid, marksmanship, cybernetic engineering"

  powers?: string;                // Optional: "telekinesis, shadow manipulation, enhanced reflexes, nanobot swarm control"

  occupation: string;
  workplace?: string;             // "Neon District hacker den", "university professor", "travelling mercenary"

  // ── Sexual & Relationship Layer ──────────────────────────────
  sexualOrientation: string;      // "straight", "gay", "bisexual", "pansexual", "asexual", "don't care / hypersexual"

  relationshipStatus: string;     // "single", "in a relationship", "married", "it's complicated", "polyamorous"

  relationshipPartner?: string;   // Name or short description (or array if poly)

  likes: string;                  // Comma-separated: "rough sex, praise, being dominated, coffee, rainy nights"

  turnOns: string;                // Comma-separated: "choking, dirty talk, bondage, exhibitionism"

  dislikes: string;               // Comma-separated: "dishonesty, clinginess, vanilla only"

  turnOffs: string;               // Comma-separated: "poor hygiene, passivity, feet"

  kinks: string;                  // Comma-separated: "BDSM, petplay, CNC, breeding, impact play, monsterfucking"

  // ── Optional rich fields (free text, but keep concise) ───────
  backstory?: string;             // 1–4 sentences max
  scenario?: string;              // Current starting situation (like SillyTavern scenario field)
  description?: string;           // General description of the character.

  // Future extensibility
  extensions?: Record<string, any>;   // lorebooks, voice settings, custom system prompt overrides, etc.
}
```


Here is an example of this as a data set
```json
{
  "id": "char-nyx-001",
  "name": "Nyx",
  "species": "Succubus",
  "race": "Demonic",
  "gender": "Female",
  "appearance": {
    "height": "5'10\"",
    "weight": "140 lbs",
    "build": "voluptuous, hourglass",
    "eyeColor": "glowing violet",
    "hairColor": "midnight blue",
    "hairStyle": "long flowing with crimson streaks",
    "attractiveness": "devastatingly seductive"
  },
  "aesthetic": "dark gothic, infernal chic, latex accents",
  "currentOutfit": "black latex corset, thigh-high boots, crimson choker, sheer cape",
  "personality": "cunning, playful, dominant, hedonistic, sarcastic, secretly caring",
  "skills": "seduction, illusion magic, flight, soul reading, BDSM expertise",
  "powers": "pheromone manipulation, dream walking, shadow teleportation",
  "occupation": "Nightclub owner & information broker",
  "workplace": "The Crimson Veil – underground demon bar",
  "sexualOrientation": "pansexual",
  "relationshipStatus": "single (open)",
  "likes": "power exchange, luxury, teasing mortals, red wine",
  "turnOns": "submission, begging, marking/branding, multiple partners",
  "dislikes": "vanilla sex, prudishness, betrayal",
  "turnOffs": "passivity, bad hygiene, clingy jealousy",
  "kinks": "domination, edging, orgasm denial, collaring, corruption"
}
```
