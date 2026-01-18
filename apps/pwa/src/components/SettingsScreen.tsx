import React, { useState, useEffect } from 'react';
import { messenger } from '../services/messenger';
import { SERVER_URL } from '../config/constants';
import { validateServerUrl } from '../utils/url';
import './SettingsScreen.css';

interface SettingsScreenProps {
  onLogout: () => void;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({ onLogout }) => {
  const [serverUrl, setServerUrl] = useState('');

  useEffect(() => {
    // Загрузить сохраненный адрес сервера или использовать дефолтный
    const savedUrl = localStorage.getItem('construct_server_url') || SERVER_URL;
    setServerUrl(savedUrl);
  }, []);

  const handleChangeServer = async () => {
    const newUrl = prompt(
      'Enter server URL (supports domain, IPv4, IPv6):\n\n' +
      'Examples:\n' +
      '  wss://example.com\n' +
      '  wss://192.168.1.1:443\n' +
      '  wss://[2a09:8280:1::b9:e736:0]:443',
      serverUrl
    );

    if (newUrl && newUrl !== serverUrl) {
      // Валидировать URL
      const validation = validateServerUrl(newUrl);
      if (!validation.valid) {
        alert('Invalid server URL: ' + validation.error);
        return;
      }

      try {
        // Сохранить новый адрес (переподключение будет при следующей инициализации)
        const normalizedUrl = validation.normalized!;
        localStorage.setItem('construct_server_url', normalizedUrl);
        setServerUrl(normalizedUrl);

        console.log('Server URL changed to:', normalizedUrl);
        alert('Server URL updated. Changes will take effect after restart.');
      } catch (err) {
        console.error('Failed to change server:', err);
        alert('Failed to update server URL: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    }
  };

  const handleLogout = async () => {
    if (confirm('Are you sure you want to logout?')) {
      try {
        await messenger.logout();
        onLogout();
      } catch (err) {
        console.error('Logout error:', err);
        // Продолжаем с logout даже при ошибке
        onLogout();
      }
    }
  };

  const handleClearData = async () => {
    const confirmed = confirm(
      '⚠️ WARNING: This will delete ALL local data:\n\n' +
      '• All messages\n' +
      '• All contacts\n' +
      '• All encryption keys\n' +
      '• Settings\n\n' +
      'This action cannot be undone!\n\n' +
      'Are you absolutely sure?'
    );

    if (!confirmed) {
      return;
    }

    try {
      // Остановить polling перед очисткой
      messenger.stopPolling();
      
      // Уничтожить состояние messenger
      messenger.destroy();

      // Очистить IndexedDB
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          const deleteReq = indexedDB.deleteDatabase(db.name);
          await new Promise<void>((resolve, reject) => {
            deleteReq.onsuccess = () => resolve();
            deleteReq.onerror = () => reject(deleteReq.error);
            deleteReq.onblocked = () => {
              console.warn(`Blocked: ${db.name}`);
              resolve();
            };
          });
        }
      }

      // Очистить localStorage
      localStorage.clear();

      alert('✅ All data cleared. Please refresh the page.');
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear data:', err);
      alert('Failed to clear data: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleClearIndexedDB = async () => {
    const confirmed = confirm(
      '⚠️ WARNING: This will delete all IndexedDB data (messages, keys, contacts).\n\n' +
      'This action cannot be undone!\n\n' +
      'Are you sure?'
    );

    if (!confirmed) {
      return;
    }

    try {
      messenger.stopPolling();
      messenger.destroy();

      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          const deleteReq = indexedDB.deleteDatabase(db.name);
          await new Promise<void>((resolve, reject) => {
            deleteReq.onsuccess = () => resolve();
            deleteReq.onerror = () => reject(deleteReq.error);
            deleteReq.onblocked = () => resolve();
          });
        }
      }

      alert('✅ IndexedDB cleared. Please refresh the page.');
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear IndexedDB:', err);
      alert('Failed to clear IndexedDB: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <div className="settings-screen bg-black text-white min-h-screen p-4">
      <div className="settings-header mb-6">
        <h1 className="mono text-2xl font-bold">SETTINGS</h1>
      </div>

      <div className="settings-list space-y-2">
        <div 
          className="settings-item bg-gray-900 p-4 rounded cursor-pointer hover:bg-gray-800 transition-colors"
          onClick={handleChangeServer}
        >
          <div className="settings-item-label mono text-xs text-gray-400 uppercase mb-1">SERVER</div>
          <div className="settings-item-value text-sm break-all">{serverUrl}</div>
        </div>

        <div 
          className="settings-item bg-gray-900 p-4 rounded cursor-pointer hover:bg-gray-800 transition-colors"
          onClick={handleLogout}
        >
          <div className="settings-item-label mono text-xs text-gray-400 uppercase">LOGOUT</div>
        </div>

        <div className="border-t border-gray-800 my-4"></div>

        <div className="settings-item bg-gray-900 p-4 rounded">
          <div className="settings-item-label mono text-xs text-gray-400 uppercase mb-3">DATA MANAGEMENT</div>
          
          <button
            onClick={handleClearIndexedDB}
            className="w-full text-left py-2 px-3 bg-red-900/30 hover:bg-red-900/50 rounded mb-2 transition-colors text-sm"
          >
            <div className="mono text-xs text-gray-400 uppercase mb-1">CLEAR INDEXEDDB</div>
            <div className="text-xs text-gray-500">Delete messages, keys, and contacts</div>
          </button>

          <button
            onClick={handleClearData}
            className="w-full text-left py-2 px-3 bg-red-900/50 hover:bg-red-900/70 rounded transition-colors text-sm"
          >
            <div className="mono text-xs text-red-400 uppercase mb-1">⚠️ CLEAR ALL DATA</div>
            <div className="text-xs text-gray-500">Delete everything including settings</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsScreen;
