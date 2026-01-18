import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
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
  const initRef = useRef(false); // Защита от двойной инициализации в StrictMode

  // Логирование изменений состояния для отладки
  useEffect(() => {
    console.log('📊 App state changed:', { initialized, loading, authenticated, error: error?.substring(0, 50) });
  }, [initialized, loading, authenticated, error]);

  // Auth форма
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Инициализация WASM при монтировании
  useEffect(() => {
    let isActive = true;

    const initWasm = async () => {
      try {
        // Проверяем, не инициализирован ли уже messenger
        // (может быть инициализирован в предыдущем монтировании из-за StrictMode)
        const wasAlreadyInitialized = initRef.current;
        
        // Проверяем, действительно ли messenger инициализирован
        if (wasAlreadyInitialized && messenger.checkInitialized()) {
          console.log('ℹ️ Messenger already initialized, just updating UI state');
          // Messenger действительно инициализирован, обновляем только UI
          if (isActive) {
            flushSync(() => {
              setLoading(false);
              setInitialized(true);
            });
          }
          return;
        }
        
        // Если был попытка инициализации, но messenger не инициализирован - сбрасываем флаг
        if (wasAlreadyInitialized && !messenger.checkInitialized()) {
          console.warn('⚠️ Previous initialization failed, retrying...');
          initRef.current = false;
        }
        
        setLoading(true);
        setError(null);
        console.log('🔄 Starting WASM initialization...');
        initRef.current = true;
        
        // Initialize with server URL (REST API endpoint)
        await messenger.initialize(SERVER_URL);
        console.log('✅ WASM initialized with server URL:', SERVER_URL);
        
        // Обновляем состояние UI только после успешной инициализации
        if (isActive) {
          console.log('🔄 Updating React state: initialized=true, loading=false');
          flushSync(() => {
            setLoading(false);
            setInitialized(true);
          });
          console.log('✅ React state updated with flushSync');
        }
      } catch (err) {
        if (isActive) {
          console.error('❌ Failed to initialize WASM:', err);
          setError(err instanceof Error ? err.message : 'Failed to initialize');
          setLoading(false);
          setInitialized(false);
          // Сбрасываем флаг, чтобы можно было повторить попытку
          initRef.current = false;
        }
      }
    };

    initWasm();

    // Cleanup функция
    return () => {
      isActive = false;
      console.log('🧹 Component cleanup (React StrictMode)');
      // НЕ сбрасываем initRef.current здесь, так как messenger должен остаться инициализированным
      // Не уничтожаем messenger здесь, так как он singleton
    };
  }, []);

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

  // Экран загрузки (показываем только если действительно загружается и не инициализирован)
  // Также показываем, если initialized=false независимо от loading (на случай, если loading не обновился)
  if (!initialized) {
    console.log('🔄 Rendering loading screen: loading=', loading, 'initialized=', initialized);
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white flex-col gap-5">
        <h1 className="m-0 text-2xl font-bold">Konstruct</h1>
        <div className="text-gray-400">Loading WASM module...</div>
      </div>
    );
  }

  // Экран ошибки
  if (error && !initialized) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white flex-col gap-5">
        <h1 className="m-0 text-2xl font-bold">Konstruct</h1>
        <div className="p-5 bg-red-900/30 border border-red-600 rounded-lg max-w-md">
          {error}
        </div>
        <button 
          onClick={initWasm}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Экран авторизации
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white p-5">
        <div className="bg-gray-900 p-10 rounded-xl shadow-2xl max-w-md w-full border border-gray-800">
          <h1 className="m-0 mb-2 text-2xl text-center font-bold">
           Konstruct
          </h1>
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-600 rounded mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleAuth}>
            <div className="mb-2 text-center">
              <button
                type="button"
                onClick={toggleAuthMode}
                className="bg-transparent border-none text-blue-400 cursor-pointer text-sm hover:text-blue-300 transition-colors"
              >
                {isRegistering ? 'Already have an account? Login' : 'No account? Register'}
              </button>
            </div>

            <h2 className="text-lg mb-5 font-semibold">
              {isRegistering ? 'Register' : 'Login'}
            </h2>

            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-3 mb-4 border border-gray-700 bg-black text-white rounded text-sm box-border focus:outline focus:outline-1 focus:outline-white transition-colors"
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full p-3 ${isRegistering ? 'mb-4' : 'mb-5'} border border-gray-700 bg-black text-white rounded text-sm box-border focus:outline focus:outline-1 focus:outline-white transition-colors`}
              required
            />

            {isRegistering && (
              <input
                type="password"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-3 mb-5 border border-gray-700 bg-black text-white rounded text-sm box-border focus:outline focus:outline-1 focus:outline-white transition-colors"
                required
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full p-3.5 text-white rounded text-base font-bold transition-colors ${
                loading 
                  ? 'bg-gray-600 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
              }`}
            >
              {loading ? 'Loading...' : isRegistering ? 'Register' : 'Login'}
            </button>
          </form>

          <div className="mt-5 text-xs text-gray-500 text-center">
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
