# RoleForge UI/UX Redesign Specification

## Overview
Transform RoleForge into a modern, professional application with dockable panels, smooth animations, and a full-viewport layout system that never requires scrolling.

---

## Core Layout Requirements

### 1. Full Viewport Layout
- **Main container must fill 100vw × 100vh**
- **Zero scrollbars**: Use `overflow: hidden` on body and main containers
- **All content must be visible** within viewport at all times
- Use flexbox or CSS Grid for responsive internal layouts

### 2. Panel Architecture

#### Panel Types:
1. **Left Sidebar Panel** (character/world management)
2. **Right Sidebar Panel** (settings/configuration)
3. **Center Content Area** (primary workspace)

#### Panel Behavior:
- **Default state**: Both panels closed, center content at 100% width
- **Single panel open**: Center content shrinks by panel width, slides smoothly
- **Both panels open**: Center content shrinks by both widths, remains centered
- **Panel widths**: Left = 320px, Right = 360px (configurable)
- **Transition speed**: 300ms ease-in-out for all animations

---

## Technical Implementation

### 3. CSS Architecture

```css
/* Root container - no scroll ever */
body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
}

/* Main layout container */
.app-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* Panels */
.panel {
  position: fixed;
  top: 0;
  height: 100vh;
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  z-index: 100;
  overflow-y: auto;
  transition: transform 300ms ease-in-out;
}

.panel-left {
  left: 0;
  width: 320px;
  transform: translateX(-100%);
}

.panel-left.open {
  transform: translateX(0);
}

.panel-right {
  right: 0;
  width: 360px;
  transform: translateX(100%);
}

.panel-right.open {
  transform: translateX(0);
}

/* Center content area */
.content-main {
  flex: 1;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  transition: margin 300ms ease-in-out, width 300ms ease-in-out;
  margin-left: 0;
  margin-right: 0;
}

.content-main.left-open {
  margin-left: 320px;
}

.content-main.right-open {
  margin-right: 360px;
}

.content-main.both-open {
  margin-left: 320px;
  margin-right: 360px;
}
```

### 4. React Component Structure

```typescript
// App.tsx structure
interface AppState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
}

const App = () => {
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const contentClasses = [
    'content-main',
    leftPanelOpen && 'left-open',
    rightPanelOpen && 'right-open',
    leftPanelOpen && rightPanelOpen && 'both-open'
  ].filter(Boolean).join(' ');

  return (
    <div className="app-container">
      <Panel 
        side="left" 
        open={leftPanelOpen}
        onToggle={setLeftPanelOpen}
      >
        {/* Left panel content */}
      </Panel>

      <main className={contentClasses}>
        <TopBar 
          onLeftToggle={() => setLeftPanelOpen(!leftPanelOpen)}
          onRightToggle={() => setRightPanelOpen(!rightPanelOpen)}
        />
        <ContentArea />
      </main>

      <Panel 
        side="right" 
        open={rightPanelOpen}
        onToggle={setRightPanelOpen}
      >
        {/* Right panel content */}
      </Panel>
    </div>
  );
};
```

---

## Design System

### 5. Color Palette (Dark Theme Primary)

```css
:root {
  /* Base colors */
  --bg-primary: #0f1419;
  --bg-secondary: #1a1f2e;
  --bg-tertiary: #252b3b;
  
  /* Panel colors */
  --panel-bg: #1a1f2e;
  --panel-border: #2a3142;
  
  /* Content area */
  --content-bg: #0f1419;
  
  /* Text */
  --text-primary: #e6e8ec;
  --text-secondary: #a1a8b8;
  --text-muted: #6b7280;
  
  /* Accents */
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
  --accent-active: #1d4ed8;
  
  /* Borders & shadows */
  --border-color: #2a3142;
  --panel-shadow: 2px 0 12px rgba(0, 0, 0, 0.5);
  
  /* Status colors */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
}
```

### 6. Typography

```css
/* Font loading */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Text styles */
.text-heading-1 {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-primary);
}

.text-heading-2 {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}

.text-body {
  font-size: 0.9375rem;
  font-weight: 400;
  line-height: 1.6;
  color: var(--text-secondary);
}

.text-small {
  font-size: 0.8125rem;
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-muted);
}
```

### 7. Component Patterns

#### Toggle Buttons
```css
.panel-toggle {
  width: 40px;
  height: 40px;
  border: none;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;
}

.panel-toggle:hover {
  background: var(--accent-primary);
  color: white;
}

.panel-toggle.active {
  background: var(--accent-active);
  color: white;
}
```

#### Cards/Sections
```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color);
}
```

---

## Specific UI Components

### 8. Top Navigation Bar

**Requirements:**
- Fixed at top of center content area
- Height: 60px
- Contains: Left toggle, breadcrumbs/title, actions, right toggle
- Semi-transparent background with backdrop blur
- Stays visible when content scrolls

```css
.top-bar {
  position: sticky;
  top: 0;
  height: 60px;
  background: rgba(15, 20, 25, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 1.5rem;
  gap: 1rem;
  z-index: 50;
}

.top-bar-start {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.top-bar-center {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.top-bar-end {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
```

### 9. Panel Headers

**Requirements:**
- Collapsible sections within panels
- Sticky headers during panel scroll
- Clear hierarchy

```css
.panel-header {
  position: sticky;
  top: 0;
  background: var(--panel-bg);
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--panel-border);
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-section {
  padding: 1rem 1.5rem;
}

.panel-section-title {
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}
```

### 10. Content Area Layout

**Requirements:**
- Maximum width constraint for readability
- Centered content
- Proper spacing

```css
.content-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
  min-height: calc(100vh - 60px);
}

/* For full-width content when needed */
.content-full-width {
  max-width: none;
  padding: 0;
}
```

---

## Animation & Interaction

### 11. Smooth Transitions

**All state changes must animate:**
- Panel open/close: 300ms
- Hover effects: 150ms
- Active states: 100ms
- Layout shifts: 300ms

```css
/* Global transition settings */
* {
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Loading states */
@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-secondary) 0%,
    var(--bg-tertiary) 50%,
    var(--bg-secondary) 100%
  );
  background-size: 1000px 100%;
  animation: shimmer 2s infinite;
}
```

### 12. Interactive States

```css
/* Focus states for accessibility */
*:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* Button states */
button, .clickable {
  cursor: pointer;
  user-select: none;
  transition: all 150ms ease;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
}

button:active:not(:disabled) {
  transform: translateY(0);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Responsive Considerations

### 13. Breakpoints

```css
/* Mobile-first approach */
/* Small devices: collapse both panels to overlay mode */
@media (max-width: 768px) {
  .panel {
    width: 100vw;
    max-width: 320px;
  }
  
  .content-main.left-open,
  .content-main.right-open,
  .content-main.both-open {
    margin-left: 0;
    margin-right: 0;
  }
  
  /* Add backdrop overlay */
  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 90;
  }
}

/* Tablet: single panel at a time */
@media (max-width: 1024px) {
  .panel-right {
    width: 100vw;
    max-width: 360px;
  }
}

/* Desktop: full experience */
@media (min-width: 1025px) {
  /* Full implementation as specified above */
}
```

---

## Accessibility

### 14. ARIA & Keyboard Navigation

```typescript
// Panel component accessibility
<Panel
  role="complementary"
  aria-label="Left navigation panel"
  aria-hidden={!open}
  tabIndex={open ? 0 : -1}
>
  <button
    aria-label="Close panel"
    aria-pressed={open}
    onClick={onToggle}
  >
    {/* Close icon */}
  </button>
</Panel>

// Keyboard shortcuts
useEffect(() => {
  const handleKeyboard = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '[') {
        e.preventDefault();
        toggleLeftPanel();
      }
      if (e.key === ']') {
        e.preventDefault();
        toggleRightPanel();
      }
    }
  };
  
  window.addEventListener('keydown', handleKeyboard);
  return () => window.removeEventListener('keydown', handleKeyboard);
}, []);
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Remove all existing scrollbars from body/html
- [ ] Implement base `app-container` with 100vw × 100vh
- [ ] Create Panel component with slide-in animation
- [ ] Create TopBar component with toggle buttons
- [ ] Implement CSS variable system for theming

### Phase 2: Layout System
- [ ] Add left panel with transform animation
- [ ] Add right panel with transform animation
- [ ] Implement content area margin transitions
- [ ] Test panel combinations (left, right, both)
- [ ] Verify no scrollbars appear during transitions

### Phase 3: Content Areas
- [ ] Build panel content layouts
- [ ] Add panel section components
- [ ] Implement scrollable content within panels
- [ ] Create center content area structure
- [ ] Add max-width constraints and centering

### Phase 4: Polish
- [ ] Add all hover/active states
- [ ] Implement loading skeletons
- [ ] Add micro-interactions
- [ ] Test keyboard navigation
- [ ] Verify ARIA attributes
- [ ] Test responsive breakpoints

### Phase 5: Testing
- [ ] Test in Chrome, Firefox, Safari
- [ ] Test on mobile devices
- [ ] Verify no horizontal scrolling
- [ ] Check animation performance
- [ ] Validate accessibility with screen reader

---

## Notes for Implementation

1. **Never use global scrollbars**: Every scrollable area must be a child element with `overflow-y: auto`

2. **Panel content scrolling**: Only the panel content area scrolls, not the entire panel

3. **Content area scrolling**: The main content area can scroll, but not the entire viewport

4. **Animation performance**: Use `transform` and `opacity` for animations (GPU accelerated), avoid animating `width`, `height`, `top`, `left`

5. **Z-index layers**:
   - Backdrop: 90
   - Panels: 100
   - Top bar: 50
   - Modals/Dialogs: 200

6. **Testing**: Always test with both panels open simultaneously to ensure layout integrity

7. **Edge cases**: Handle window resizing gracefully, maintain panel states in localStorage

---

## Visual Reference

```
┌─────────────────────────────────────────────────────────────┐
│                         TopBar (60px)                       │
│  [☰] RoleForge > Scene Name              [Actions]  [⚙]    │
├──────┬────────────────────────────────────────────┬─────────┤
│      │                                            │         │
│ Left │                                            │  Right  │
│ Panel│         Center Content Area                │  Panel  │
│      │         (max-width: 1400px)                │         │
│ 320px│         Centered, padded                   │  360px  │
│      │                                            │         │
│      │         (scrollable if needed)             │         │
│      │------------------------------------------- │         │
│      │    Text input area ALWAYS ON SCREEN        │         │
└──────┴────────────────────────────────────────────┴─────────┘
     Slide in/out          Adapts width         Slide in/out
```

This specification provides complete direction for creating a professional, smooth, and intuitive UI/UX for RoleForge.