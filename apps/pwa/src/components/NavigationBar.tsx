import React from 'react';
import './NavigationBar.css';

type Screen = 'chats' | 'settings';

type NavigationBarProps = {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  layoutMode?: 'mobile' | 'desktop';
};

const NavigationBar: React.FC<NavigationBarProps> = ({ currentScreen, onNavigate, layoutMode = 'mobile' }) => {
  const baseClasses = layoutMode === 'desktop' 
    ? 'flex flex-row items-center justify-around border-t border-gray-800 bg-black'
    : 'flex flex-row items-center justify-around border-t border-gray-800 bg-black';
  
  return (
    <nav className={baseClasses}>
      <button
        className={`flex-1 py-3 px-4 cursor-pointer transition-colors mono text-xs uppercase ${
          currentScreen === 'chats' 
            ? 'text-white border-b-2 border-blue-600 bg-gray-900' 
            : 'text-gray-400 hover:text-white hover:bg-gray-900'
        }`}
        onClick={() => onNavigate('chats')}
      >
        CHATS
      </button>
      <button
        className={`flex-1 py-3 px-4 cursor-pointer transition-colors mono text-xs uppercase ${
          currentScreen === 'settings' 
            ? 'text-white border-b-2 border-blue-600 bg-gray-900' 
            : 'text-gray-400 hover:text-white hover:bg-gray-900'
        }`}
        onClick={() => onNavigate('settings')}
      >
        SETTINGS
      </button>
    </nav>
  );
};

export default NavigationBar;
