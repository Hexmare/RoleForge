import React from 'react';

interface PanelProps {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  title?: string;
}

const Panel: React.FC<PanelProps> = ({ side, open, onToggle, children, title }) => {
  const panelClass = `panel panel-${side}${open ? ' open' : ''}`;

  return (
    <>
      {open && <div className="panel-backdrop" onClick={onToggle} />}
      <aside className={panelClass} role="complementary" aria-label={`${side} panel`} aria-hidden={!open}>
        <header className="panel-header">
          <h2 className="text-heading-2">{title || `${side} Panel`}</h2>
          <button 
            className="panel-toggle panel-close" 
            onClick={onToggle} 
            aria-label={`Close ${side} panel`}
            aria-pressed={open}
          >
            ✕
          </button>
        </header>
        <div className="panel-body">
          {children}
        </div>
      </aside>
    </>
  );
};

export default Panel;