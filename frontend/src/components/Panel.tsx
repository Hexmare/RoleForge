import React from 'react';

interface PanelProps {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  title?: string;
}

const Panel: React.FC<PanelProps> = ({ side, open, onToggle, children, title }) => {
  const baseClasses = "fixed top-[50px] h-[calc(100vh-50px)] bg-panel-bg shadow-panel z-100 overflow-y-auto transition-transform duration-300 ease-in-out";
  const sideClasses = side === 'left' 
    ? `left-0 w-80 ${open ? 'translate-x-0' : '-translate-x-full'}`
    : `w-96 ${open ? 'left-[calc(100vw-190px)] translate-x-0' : 'left-[100vw] translate-x-0'}`;

  return (
    <>
      {open && <div className="fixed inset-0 bg-black bg-opacity-50 z-90" onClick={onToggle} />}
      <aside className={`${baseClasses} ${sideClasses}`} role="complementary" aria-label={`${side} panel`} aria-hidden={!open}>
        <header className="flex items-center justify-between p-4 border-b border-panel-border">
          <h2 className="text-lg font-semibold text-text-primary">{title || `${side} Panel`}</h2>
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary text-text-primary" 
            onClick={onToggle} 
            aria-label={`Close ${side} panel`}
            aria-pressed={open}
          >
            ✕
          </button>
        </header>
        <div className="p-4">
          {children}
        </div>
      </aside>
    </>
  );
};

export default Panel;