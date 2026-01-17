import React from 'react';

interface TopBarProps {
  onLeftToggle: () => void;
  onRightToggle: () => void;
  onConfigClick?: () => void;
  onLLMConfigClick?: () => void;
  onChatClick?: () => void;
  onCharacterClick?: () => void;
  onLoreClick?: () => void;
  onImageClick?: () => void;
  onWorldClick?: () => void;
  onDebugClick?: () => void;
  onDebugConfigClick?: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  title?: string;
  breadcrumbs?: string[];
}

const TopBar: React.FC<TopBarProps> = ({ 
  onLeftToggle, 
  onRightToggle, 
  onConfigClick,
  onLLMConfigClick,
  onChatClick,
  onCharacterClick,
  onLoreClick,
  onImageClick,
  onWorldClick,
  onDebugClick,
  onDebugConfigClick,
  leftOpen, 
  rightOpen, 
  title = 'RoleForge', 
  breadcrumbs = [] 
}) => {
  return (
    <header className="fixed top-0 w-screen h-[50px] bg-primary-bg/95 backdrop-blur-[10px] border-b border-border-color flex items-center justify-between px-6 z-200">
      <div className="flex items-center gap-4">
        <button 
          className={`w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors ${leftOpen ? 'bg-accent-primary text-white' : 'text-text-primary'}`} 
          onClick={onLeftToggle}
          aria-label="Toggle left panel"
          aria-pressed={leftOpen}
        >
          ☰
        </button>
        {onConfigClick && (
          <button
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary"
            onClick={onConfigClick}
            aria-label="Open configuration"
          >
            ⚙️
          </button>
        )}
        {onLLMConfigClick && (
          <button
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary"
            onClick={onLLMConfigClick}
            aria-label="Configure LLM backends"
            title="LLM Configuration"
          >
            🤖
          </button>
        )}
        {onChatClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onChatClick}
            aria-label="Switch to chat view"
          >
            💬
          </button>
        )}
        {onCharacterClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onCharacterClick}
            aria-label="Switch to characters view"
          >
            👤
          </button>
        )}
        {onLoreClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onLoreClick}
            aria-label="Open lore manager"
          >
            📖
          </button>
        )}
        {onImageClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onImageClick}
            aria-label="Open ComfyUI settings"
          >
            🖼️
          </button>
        )}
        {onWorldClick && (
          <button 
            className="w-10 h-10 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onWorldClick}
            aria-label="Switch to worlds view"
          >
            🌍
          </button>
        )}
        {onDebugClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onDebugClick}
            aria-label="Debug vector store"
            title="Vector Store Debug"
          >
            🔍
          </button>
        )}
        {onDebugConfigClick && (
          <button 
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors text-text-primary" 
            onClick={onDebugConfigClick}
            aria-label="Open debug configuration"
            title="Debug Configuration"
          >
            🛠️
          </button>
        )}
      </div>
      
      <div className="flex-1 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <span className="text-sm text-text-secondary">{breadcrumbs.join(' > ')}</span>
          </nav>
        )}
      </div>
      
      <div className="flex items-center">
        <button 
          className={`w-8 h-8 flex items-center justify-center rounded hover:bg-panel-tertiary transition-colors ${rightOpen ? 'bg-accent-primary text-white' : 'text-text-primary'}`} 
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