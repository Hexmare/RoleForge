import React from 'react';

interface TopBarProps {
  onLeftToggle: () => void;
  onRightToggle: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  title?: string;
  breadcrumbs?: string[];
}

const TopBar: React.FC<TopBarProps> = ({ 
  onLeftToggle, 
  onRightToggle, 
  leftOpen, 
  rightOpen, 
  title = 'RoleForge', 
  breadcrumbs = [] 
}) => {
  return (
    <header className="top-bar">
      <div className="top-bar-start">
        <button 
          className={`panel-toggle${leftOpen ? ' active' : ''}`} 
          onClick={onLeftToggle}
          aria-label="Toggle left panel"
          aria-pressed={leftOpen}
        >
          ☰
        </button>
      </div>
      
      <div className="top-bar-center">
        <h1 className="text-heading-2">{title}</h1>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <span className="text-small">{breadcrumbs.join(' > ')}</span>
          </nav>
        )}
      </div>
      
      <div className="top-bar-end">
        <button 
          className={`panel-toggle${rightOpen ? ' active' : ''}`} 
          onClick={onRightToggle}
          aria-label="Toggle right panel"
          aria-pressed={rightOpen}
        >
          ⚙
        </button>
      </div>
    </header>
  );
};

export default TopBar;