# RoleForge Frontend UI/UX Design & Development Vision
**Project Context** — January 2026  
RoleForge is an immersive, local-first LLM-powered roleplaying application.  
A Node.js + TypeScript backend communicates with OpenAI-compatible endpoints (OpenAI, Kobold.cpp, LM Studio, etc.) to power multi-agent storytelling.  
The frontend is currently Vite + TypeScript + Nunjucks templating — we plan to evolve toward a modern component-based framework (strongly prefer **React + Vite + TypeScript** + Tailwind CSS).

**Core Goals for the UI/UX**
- Create the most immersive, elegant, and user-friendly roleplaying chat experience possible in 2026.
- Draw strong inspiration from SillyTavern (clean chat flow, inline image gen, lorebooks/world info) and Talemate (multi-agent/world separation).
- Target aesthetic: **Dark Glassmorphism** — moody, sophisticated, premium fantasy/sci-fi feel.
  - Deep blacks/grays + subtle vibrant accents (emerald, indigo, crimson, deep purple)
  - Frosted glass (backdrop-blur + translucency) for cards, sidebars, modals
  - Smooth micro-animations (message reveal, hover scale, typing glow) - optional, low priority
- Accent colors per character/world (stored in DB)
- Animations: Framer Motion optional for enhanced smoothness (fade-in-up for messages, scale on hover)

## Key Screens & Layout Structure

### 1. World / Story Dashboard (Home)
- Full-height, immersive gradient background (dark nebula / ancient parchment / cyber void — customizable per world)
- Grid of large glassmorphic cards (translucent, blur(12px), subtle border + inner glow)
  - Each card: generated thumbnail image (scene preview), story title, last active, character avatars (small circle stack), quick stats
  - Hover: slight scale + stronger glow
  - New World button: floating action button (FAB) with plus icon
- Top bar: minimal — logo, search worlds, user avatar/settings
- Bottom: quick theme/world style switcher

**Visual Inspiration** (imagine these aesthetics):  
Dark fantasy glass cards on gradient → deep luxurious feel  
Sleek layered translucent UI elements  

### 2. Main Roleplay Chat Screen (Core Experience)
- Layout: classic three-panel (collapsible)
  - **Left Sidebar** (collapsible, ~280–340px):
    - Tabs: Characters | Lorebooks/World Info | Agents | Notes
    - Character switcher: avatar list + quick bio hover
    - Lorebooks: accordion tree, searchable, drag-reorder, inline edit
  - **Main Area** (flex-1):
    - Chat messages feed (reverse scroll, smooth appear-from-bottom)
    - Message bubbles:
      - User: right-aligned, solid accent color (e.g. emerald-600)
      - AI/Characters: left-aligned, glassmorphic (slight blur + border), color based on character
      - Inline generated images/videos: full-width cards with subtle frame, lazy load, click to zoom/modal
    - Typing indicator: animated ellipsis with soft glow matching character color
  - **Right Sidebar** (optional/collapsible): Scene metadata, active agents overview, quick world facts
- Bottom input bar:
  - Large expanding textarea
  - Toolbar: voice input (mic), /commands menu, image/video gen trigger, emoji, attachments
  - Send button with subtle pulse when LLM is thinking

**Visual Style Rules**
- Default theme: Dark Glassmorphism
  ```css
  .glass {
    background: rgba(30, 30, 50, 0.35);
    backdrop-filter: blur(12px) saturate(180%);
    -webkit-backdrop-filter: blur(12px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
  ```
- Accent colors per character/world (stored in DB)
- Animations: Framer Motion optional (low priority) for smooth micro-animations (fade-in-up for messages, scale on hover)

### 3. Image & Video Generation Integration
- Inline triggers: `/image forest battle at dusk, cinematic` or dedicated button
- Generation modal/preview:
  - Glass overlay with prompt editor, style presets (anime, realistic, pixel, oil painting), aspect ratio, negative prompt
  - Live preview thumbnails when possible
  - Insert into chat automatically after generation
- Video clips: short 3–8s action sequences (future — AnimateDiff / SVD style)

### 4. Character & World Creation/Editor
- Modal-first (large centered glass card)
- Tabs: Basics | Appearance | Personality | Backstory | Voice (TTS preview)
- AI assist buttons: "Suggest appearance", "Generate portrait"
- Drag-drop image upload + auto-generate button

### Tech Stack & Implementation Guidelines
- Strongly prefer migrating to **React 19** + **Vite** + **TypeScript** + **Tailwind CSS 4**
- State management: **Zustand** (lightweight) or **Jotai**
- Real-time: Socket.io from Node backend
- Styling: Tailwind + custom glass utilities
- Animations: Framer Motion (optional, low priority)
- Image handling: lazy loading + blur placeholder
- Accessibility:
  - High contrast mode toggle
  - Keyboard nav & screen reader support
  - Never sacrifice readability for glass effects

### Priority Order for Iteration
1. Convert existing Nunjucks → React structure (App → Dashboard → ChatPage)
2. Implement glassmorphic chat UI (messages + bubbles)
3. Add collapsible sidebars with lore/characters
4. Inline image generation trigger & display
5. World dashboard with cards
6. Theme system + per-world custom backgrounds/accents
7. Character editor modal
8. Optional: Framer Motion animations for enhanced polish (low priority)

**Tone & Philosophy**
Make it feel magical, premium, and addictive for long roleplaying sessions.  
Prioritize immersion > flashy features.  
Every visual choice should serve the story.

Use this document as your primary design bible when generating or refactoring frontend code for RoleForge.


