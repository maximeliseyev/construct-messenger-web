import React, { useState, useEffect } from 'react';
import { useDeviceType } from './hooks/useDeviceType';
import { messenger } from './services/messenger';
import MobileApp from './MobileApp';
import DesktopApp from './DesktopApp';
import { SERVER_URL } from './config/constants';

/**
 * Главный компонент с интеграцией WASM
 * Управляет:
 * - Инициализацией WASM модуля
 * - Аутентификацией пользователя
 * - Подключением к серверу
 */
const App: React.FC = () => {
  const deviceType = useDeviceType();
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth форма
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Инициализация WASM при монтировании
  useEffect(() => {
    initWasm();
  }, []);

  const initWasm = async () => {
    try {
      setLoading(true);
      // Initialize with server URL (REST API endpoint)
      await messenger.initialize(SERVER_URL);
      setInitialized(true);
      console.log('✅ WASM initialized with server URL:', SERVER_URL);
    } catch (err) {
      console.error('Failed to initialize WASM:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        // Проверить совпадение паролей
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }

        // РЕГИСТРАЦИЯ через REST API:
        // registerUser() теперь делает всё: создаёт ключи, регистрируется на сервере,
        // сохраняет токены и запускает polling автоматически
        console.log('📝 Starting registration via REST API...');
        const userId = await messenger.registerUser(username, password);
        console.log('✅ Registration successful, userId:', userId);

        // Сохранить маппинг username → userId для будущих логинов
        const userMap = JSON.parse(localStorage.getItem('construct_user_map') || '{}');
        userMap[username.toLowerCase()] = userId;
        localStorage.setItem('construct_user_map', JSON.stringify(userMap));
        console.log('✅ User mapping saved');

        // Start long polling for incoming messages (автоматически после регистрации)
        await messenger.startPolling();
        console.log('✅ Long polling started');

        setAuthenticated(true);
        setLoading(false);

      } else {
        // ЛОГИН через REST API:
        // loginUser() теперь принимает username (не userId!) и делает всё:
        // загружает ключи, логинится на сервере, сохраняет токены
        console.log('🔑 Starting login via REST API...');
        await messenger.loginUser(username, password);
        console.log('✅ Login successful');

        // Start long polling for incoming messages
        await messenger.startPolling();
        console.log('✅ Long polling started');

        setAuthenticated(true);
        setLoading(false);
      }
    } catch (err) {
      console.error('Auth failed:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await messenger.logout();
      setAuthenticated(false);
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      // Re-initialize for next login
      await initWasm();
    } catch (err) {
      console.error('Logout error:', err);
      // Continue with logout even if there's an error
      setAuthenticated(false);
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      messenger.destroy();
      initWasm();
    }
  };

  const toggleAuthMode = () => {
    setIsRegistering(!isRegistering);
    setError(null);
    setPassword('');
    setConfirmPassword('');
  };

  // Экран загрузки
  if (loading && !initialized) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5',
        flexDirection: 'column',
        gap: '20px',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>Construct Messenger</h1>
        <div>⏳ Loading WASM module...</div>
      </div>
    );
  }

  // Экран ошибки
  if (error && !initialized) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5',
        flexDirection: 'column',
        gap: '20px',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>Construct Messenger</h1>
        <div style={{
          padding: '20px',
          background: '#fee',
          border: '1px solid #f00',
          borderRadius: '8px',
        }}>
          {error}
        </div>
        <button onClick={initWasm}>Retry</button>
      </div>
    );
  }

  // Экран авторизации
  if (!authenticated) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f5f5f5',
        padding: '20px',
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          maxWidth: '400px',
          width: '100%',
        }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '24px', textAlign: 'center' }}>
            Construct Messenger
          </h1>
          {error && (
            <div style={{
              padding: '10px',
              background: '#fee',
              border: '1px solid #f00',
              borderRadius: '4px',
              marginBottom: '20px',
              fontSize: '14px',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleAuth}>
            <div style={{ marginBottom: '10px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={toggleAuthMode}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#007aff',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                {isRegistering ? 'Already have an account? Login' : 'No account? Register'}
              </button>
            </div>

            <h2 style={{ fontSize: '18px', margin: '0 0 20px 0' }}>
              {isRegistering ? 'Register' : 'Login'}
            </h2>

            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '15px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: isRegistering ? '15px' : '20px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              required
            />

            {isRegistering && (
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '20px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
                required
              />
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                background: loading ? '#ccc' : '#007aff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Loading...' : isRegistering ? 'Register' : 'Login'}
            </button>
          </form>

          <div style={{ marginTop: '20px', fontSize: '12px', color: '#999', textAlign: 'center' }}>
          </div>
        </div>
      </div>
    );
  }

  // Главное приложение
  const MainApp = deviceType === 'desktop' ? DesktopApp : MobileApp;

  return <MainApp onLogout={handleLogout} />;
};

export default App;
