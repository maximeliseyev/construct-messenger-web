import { useState } from 'react';
import { useMessenger } from '../hooks/useMessenger';

/**
 * Пример использования Rust WASM мессенджера в React
 */
export function MessengerExample() {
  const {
    initialized,
    loading,
    error,
    currentUser,
    contacts,
    isPolling,
    register,
    login,
    addContact,
    sendMessage,
  } = useMessenger();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(true);

  // Регистрация/Вход
  // Note: connect() is now integrated into register/login via REST API
  const handleAuth = async () => {
    try {
      if (isRegistering) {
        const newUserId = await register(username, password);
        alert(`✅ Пользователь создан!\nID: ${newUserId}\n\nСохраните этот ID для входа!`);
      } else {
        await login(username, password);
        alert('✅ Вход выполнен!');
      }
    } catch (err) {
      console.error('Auth error:', err);
    }
  };

  // Добавить контакт
  const handleAddContact = async () => {
    const contactId = prompt('Введите UUID контакта:');
    const contactName = prompt('Введите имя контакта:');
    if (contactId && contactName) {
      try {
        await addContact(contactId, contactName);
        alert('✅ Контакт добавлен!');
      } catch (err) {
        console.error('Add contact error:', err);
      }
    }
  };

  // Отправить сообщение
  // Note: session_id is now auto-managed by WASM core
  const handleSendMessage = async (contactId: string) => {
    const text = prompt('Введите сообщение:');
    if (text) {
      try {
        await sendMessage(contactId, text);
        alert('✅ Сообщение отправлено!');
      } catch (err) {
        console.error('Send message error:', err);
      }
    }
  };

  if (!initialized) {
    return <div>Loading WASM...</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h1> Konstruct (Rust WASM)</h1>

      {error && (
        <div style={{ padding: '10px', background: '#fee', border: '1px solid #f00', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      {/* Статус */}
      <div style={{ marginBottom: '20px', padding: '10px', background: '#f0f0f0' }}>
        <div><strong>Пользователь:</strong> {currentUser.username || 'Не авторизован'}</div>
        <div><strong>User ID:</strong> {currentUser.userId || '—'}</div>
        <div>
          <strong>Long Polling:</strong>{' '}
          {isPolling ? '✅ Активен' : '❌ Неактивен'}
        </div>
      </div>

      {/* Авторизация */}
      {!currentUser.userId && (
        <div style={{ marginBottom: '20px', padding: '20px', border: '1px solid #ccc' }}>
          <h2>{isRegistering ? '📝 Регистрация' : '🔑 Вход'}</h2>

          <div style={{ marginBottom: '10px' }}>
            <button onClick={() => setIsRegistering(!isRegistering)}>
              {isRegistering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
            </button>
          </div>

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: '10px', padding: '8px' }}
          />

          <input
            type="password"
            placeholder="Password (min 8 символов, буквы + цифры)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: '10px', padding: '8px' }}
          />

          <button
            onClick={handleAuth}
            disabled={loading || !username || !password}
            style={{ padding: '10px 20px', fontSize: '16px' }}
          >
            {loading ? '⏳ Загрузка...' : isRegistering ? '📝 Зарегистрироваться' : '🔑 Войти'}
          </button>
        </div>
      )}

      {/* Контакты */}
      {currentUser.userId && (
        <div style={{ marginBottom: '20px', padding: '20px', border: '1px solid #ccc' }}>
          <h2>👥 Контакты ({contacts.length})</h2>

          <button onClick={handleAddContact} style={{ marginBottom: '10px', padding: '8px 16px' }}>
            ➕ Добавить контакт
          </button>

          <div>
            {contacts.length === 0 ? (
              <p>Нет контактов</p>
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  style={{
                    padding: '10px',
                    border: '1px solid #ddd',
                    marginBottom: '5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{contact.username}</strong>
                    <br />
                    <small style={{ color: '#666' }}>{contact.id}</small>
                  </div>
                  <button onClick={() => handleSendMessage(contact.id)}>✉️ Написать</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Инфо */}
      <div style={{ marginTop: '40px', padding: '10px', background: '#f9f9f9', fontSize: '12px' }}>
        <h3>ℹ️ Как это работает:</h3>
        <ol>
          <li><strong>WASM модуль</strong> - Rust код компилируется в WebAssembly</li>
          <li><strong>Шифрование</strong> - Приватные ключи шифруются мастер-паролем (PBKDF2 + AES-256-GCM)</li>
          <li><strong>IndexedDB</strong> - Хранилище в браузере для ключей, сессий, сообщений</li>
          <li><strong>Double Ratchet</strong> - Протокол E2EE для сообщений (как в Signal)</li>
          <li><strong>REST API + Long Polling</strong> - REST API для отправки, long polling для получения сообщений</li>
        </ol>
      </div>
    </div>
  );
}
