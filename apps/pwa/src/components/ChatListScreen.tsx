import React, { useEffect, useState, useRef } from 'react';
import { messenger, Contact } from '../services/messenger';
import { parseContactUrl } from '../utils/url';
import './ChatListScreen.css';

type ChatListScreenProps = {
  onChatSelect: (chatId: string) => void;
};

type ChatListItem = {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
};

const ChatListScreen: React.FC<ChatListScreenProps> = ({ onChatSelect }) => {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlProcessedRef = useRef(false);

  // Обработка URL при загрузке для автоматического добавления контакта
  useEffect(() => {
    const processContactUrl = async () => {
      // Проверяем, не обрабатывали ли мы уже этот URL
      if (urlProcessedRef.current) {
        return;
      }

      // Проверяем, что messenger инициализирован
      if (!messenger.checkInitialized()) {
        console.log('Messenger not initialized yet, waiting...');
        // Повторим попытку через небольшую задержку
        setTimeout(processContactUrl, 500);
        return;
      }

      const currentUrl = window.location.href;
      const contactData = parseContactUrl(currentUrl);

      if (contactData) {
        urlProcessedRef.current = true;
        
        try {
          // Проверяем, есть ли уже такой контакт
          const existingContacts = messenger.getContacts();
          const existingContact = existingContacts.find(c => c.id === contactData.contactId);
          
          if (!existingContact) {
            // Добавляем новый контакт
            await messenger.addContact(contactData.contactId, contactData.username);
            console.log(`✅ Contact added from URL: ${contactData.username} (${contactData.contactId})`);
          }
          
          // Перезагружаем чаты и открываем чат с контактом
          await loadChats();
          
          // Небольшая задержка, чтобы убедиться, что контакт добавлен
          setTimeout(() => {
            onChatSelect(contactData.contactId);
          }, 100);
          
          // Очищаем URL от параметров контакта
          const urlWithoutParams = window.location.origin + window.location.pathname;
          window.history.replaceState({}, '', urlWithoutParams);
        } catch (err) {
          console.error('Failed to process contact URL:', err);
          setError(err instanceof Error ? err.message : 'Failed to add contact from URL');
        }
      }
    };

    processContactUrl();
  }, [onChatSelect]);

  useEffect(() => {
    // Проверяем инициализацию перед загрузкой чатов
    if (messenger.checkInitialized()) {
      loadChats();
    }

    // Polling для обновления списка (пока нет WebSocket callbacks)
    const interval = setInterval(() => {
      if (messenger.checkInitialized()) {
        loadChats();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadChats = async () => {
    if (!messenger.checkInitialized()) {
      setError('Messenger is not initialized');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // ✅ РЕАЛЬНАЯ ЗАГРУЗКА из WASM!
      const contacts: Contact[] = messenger.getContacts();

      // Преобразовать контакты в список чатов
      const chatList: ChatListItem[] = await Promise.all(
        contacts.map(async (contact) => {
          try {
            // Получаем сообщения из локального хранилища
            const messages = await messenger.getMessages(contact.id);
            const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

            return {
              id: contact.id,
              name: contact.username,
              lastMessage: lastMsg ? lastMsg.encrypted_content : 'No messages', // TODO: расшифровать
              timestamp: lastMsg ? formatTimestamp(lastMsg.timestamp) : '',
              unread: 0, // TODO: реализовать подсчет непрочитанных сообщений
            };
          } catch (err) {
            console.error(`Failed to load messages for ${contact.username}:`, err);
            return {
              id: contact.id,
              name: contact.username,
              lastMessage: 'Error loading messages',
              timestamp: '',
              unread: 0,
            };
          }
        })
      );

      setChats(chatList);
    } catch (err) {
      console.error('Failed to load chats:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to load chats';
      setError(errorMsg);
      // Если это WASM ошибка, не падаем полностью, просто показываем ошибку
      if (err instanceof Error && err.message.includes('unreachable')) {
        console.error('WASM unreachable error - messenger may need to be reinitialized');
        // Не очищаем существующие чаты, просто показываем ошибку
      }
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (diff < 172800000) return 'yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleAddContact = async () => {
    if (!messenger.checkInitialized()) {
      setError('Messenger is not initialized');
      alert('❌ Мессенджер не инициализирован. Пожалуйста, перезагрузите страницу.');
      return;
    }

    try {
      // Пытаемся прочитать ссылку из буфера обмена
      let contactUrl = '';
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText && parseContactUrl(clipboardText)) {
          contactUrl = clipboardText;
        }
      } catch (clipboardError) {
        // Если не удалось прочитать из буфера обмена, игнорируем ошибку
        console.log('Could not read from clipboard:', clipboardError);
      }

      // Если в буфере обмена нет валидной ссылки, запрашиваем у пользователя
      if (!contactUrl) {
        contactUrl = prompt('Вставьте ссылку на контакт:\n(например: https://konstruct.cc/c/af70cf9a-b176-4df3-b6bf-00196a6f173e?username=max)') || '';
      }

      if (!contactUrl.trim()) {
        return; // Пользователь отменил ввод
      }

      // Парсим ссылку
      const contactData = parseContactUrl(contactUrl.trim());
      if (!contactData) {
        alert('❌ Неверный формат ссылки. Ожидается: https://konstruct.cc/c/{uuid}?username={username}');
        return;
      }

      // Проверяем, есть ли уже такой контакт
      const existingContacts = messenger.getContacts();
      const existingContact = existingContacts.find(c => c.id === contactData.contactId);

      if (existingContact) {
        // Контакт уже существует, просто открываем диалог
        await loadChats();
        onChatSelect(contactData.contactId);
        return;
      }

      // Добавляем новый контакт (messenger.addContact запросит ключи с сервера)
      await messenger.addContact(contactData.contactId, contactData.username);
      console.log(`✅ Contact added: ${contactData.username} (${contactData.contactId})`);

      // Перезагружаем список чатов
      await loadChats();

      // Открываем диалог с новым контактом
      onChatSelect(contactData.contactId);
    } catch (err) {
      console.error('Failed to add contact:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`❌ Не удалось добавить контакт: ${errorMessage}`);
      setError(errorMessage);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black text-white">
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
        <h1 className="mono text-base font-normal">CHATS</h1>
        <button
          onClick={handleAddContact}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded cursor-pointer transition-colors"
        >
          ➕ Add Contact
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-600 m-3 rounded text-sm">
          ❌ Error: {error}
        </div>
      )}

      {loading && chats.length === 0 && (
        <div className="text-center py-5">
          ⏳ Loading chats...
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && !loading ? (
          <div className="py-10 px-5 text-center text-gray-400">
            <p className="mono text-base mb-2">NO CHATS</p>
            <p className="text-sm text-gray-500">
              Click "Add Contact" to start chatting
            </p>
          </div>
        ) : (
          chats.map(chat => (
            <div
              key={chat.id}
              className="px-4 py-3 border-b border-gray-800 cursor-pointer hover:bg-gray-900 transition-colors"
              onClick={() => onChatSelect(chat.id)}
            >
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="mono text-sm text-white font-medium">{chat.name}</span>
                  <span className="mono text-xs text-gray-400">{chat.timestamp}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate flex-1">
                    {/* TODO: Расшифровать последнее сообщение */}
                    {chat.lastMessage.length > 50
                      ? chat.lastMessage.substring(0, 50) + '...'
                      : chat.lastMessage}
                  </span>
                  {chat.unread > 0 && (
                    <span className="mono text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full min-w-[20px] text-center">
                      {chat.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatListScreen;
