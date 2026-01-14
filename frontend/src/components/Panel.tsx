import React from 'react';

interface PanelProps {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  title?: string;
}

const Panel: React.FC<PanelProps> = ({ side, open, onToggle, children, title }) => {
  // For flex layout, use different styling
  const baseClasses = "glass shadow-panel overflow-y-auto transition-all duration-300 ease-in-out";
  const sideClasses = side === 'left' 
    ? "w-80 flex-shrink-0"
    : "w-96 flex-shrink-0";

  if (!open) return null; // Don't render when closed in flex layout

  const panelWidth = side === 'right' ? '384px' : '320px'; // w-96 = 384px, w-80 = 320px
  
  return (
    <aside 
      className={`${baseClasses} ${sideClasses}`} 
      role="complementary" 
      aria-label={`${side} panel`}
      style={{ width: panelWidth, minWidth: panelWidth, maxWidth: panelWidth, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <header className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
        <h2 className="text-lg font-semibold text-text-primary overflow-hidden" style={{ minWidth: 0 }}>{title || `${side} Panel`}</h2>
        <button 
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-text-primary transition-colors flex-shrink-0" 
          onClick={onToggle} 
          aria-label={`Close ${side} panel`}
          aria-pressed={open}
        >
          ✕
        </button>
      </header>
      <div className="p-4 overflow-y-auto flex-1" style={{ width: '100%', maxWidth: '100%', overflow: 'hidden auto', minWidth: 0 }}>
        {children}
      </div>
    </aside>
  );
};

export default Panel;