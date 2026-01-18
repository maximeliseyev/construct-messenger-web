import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { messenger } from '../services/messenger';
import './ChatScreen.css';

type ChatScreenProps = {
  chatId: string;
  onBack: () => void;
  showHeader?: boolean;
  layoutMode?: 'mobile' | 'desktop';
};

type Message = {
  id: string;
  from: string;
  to: string;
  content: string; // encrypted content (base64) - TODO: расшифровать
  timestamp: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
};

const ChatScreen: React.FC<ChatScreenProps> = ({
  chatId,
  onBack,
  showHeader = true,
  layoutMode = 'mobile'
}) => {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const screenClassName = `chat-screen ${layoutMode === 'desktop' ? 'chat-screen-desktop' : ''}`;

  // Загрузка текущего пользователя при монтировании
  useEffect(() => {
    try {
      if (messenger.checkInitialized()) {
        const user = messenger.getCurrentUser();
        setCurrentUserId(user.userId);
      }
    } catch (err) {
      console.error('Failed to get current user:', err);
    }
  }, []);

  // Загрузка сообщений при монтировании
  useEffect(() => {
    if (!messenger.checkInitialized()) {
      setError('Messenger is not initialized');
      return;
    }

    loadMessages();

    // Polling для обновления сообщений (пока нет WebSocket callbacks)
    const interval = setInterval(() => {
      if (messenger.checkInitialized()) {
        loadMessages();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [chatId]);

  const loadMessages = async () => {
    if (!messenger.checkInitialized()) {
      setError('Messenger is not initialized');
      return;
    }

    try {
      // Получаем сообщения из локального хранилища (IndexedDB)
      // Сообщения сохраняются автоматически через polling
      const storedMessages = await messenger.getMessages(chatId);
      
      // Конвертировать StoredMessage в Message формат для UI
      const uiMessages: Message[] = storedMessages.map(msg => ({
        id: msg.id,
        from: msg.from,
        to: msg.to,
        content: msg.encrypted_content, // TODO: расшифровать через crypto_manager
        timestamp: msg.timestamp,
        status: msg.status,
      }));
      setMessages(uiMessages);
      setError(null);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    }
  };

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [inputValue]);

  const handleSendMessage = async () => {
    if (inputValue.trim() === '') return;

    if (!messenger.checkInitialized()) {
      setError('Messenger is not initialized');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // ✅ РЕАЛЬНАЯ ОТПРАВКА через WASM REST API!
      // Note: session_id is now auto-managed by WASM core
      const messageId = await messenger.sendMessage(chatId, inputValue);

      console.log('✅ Message sent:', messageId);

      // Очистить input
      setInputValue('');

      // Обновить список сообщений
      await loadMessages();
    } catch (err) {
      console.error('❌ Failed to send message:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMsg);
      // Показываем более подробную информацию об ошибке
      if (err instanceof Error && err.message.includes('unreachable')) {
        console.error('WASM unreachable error - messenger may need to be reinitialized');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };


  return (
    <div className={screenClassName}>
      {showHeader && (
        <header className="chat-header">
          <button onClick={onBack} className="back-button">&lt;</button>
          <h1>Chat with {chatId}</h1>
        </header>
      )}

      {error && (
        <div style={{
          padding: '10px',
          background: '#fee',
          border: '1px solid #f00',
          margin: '10px'
        }}>
          ❌ Error: {error}
        </div>
      )}

      <div className="message-list">
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
            No messages yet. Send a message to start the conversation!
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = currentUserId ? msg.from === currentUserId : false;
            const nextMsg = messages[index + 1];
            const showTimestamp = !nextMsg || nextMsg.from !== msg.from;

            return (
              <div key={msg.id} className={`message-row ${isMe ? 'me' : 'other'}`}>
                <div className="message-content">
                  <span className="message-text">
                    {/* TODO: Расшифровать content из base64 encrypted */}
                    {msg.content}
                  </span>
                  {showTimestamp && (
                    <span className="timestamp">{formatTimestamp(msg.timestamp)}</span>
                  )}
                  {isMe && (
                    <span style={{ fontSize: '10px', marginLeft: '5px', color: '#999' }}>
                      {msg.status === 'sent' ? '✓' :
                       msg.status === 'delivered' ? '✓✓' :
                       msg.status === 'read' ? '✓✓' :
                       msg.status === 'failed' ? '✗' : '⏳'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="message-input-container">
        <textarea
          ref={textareaRef}
          placeholder="Сообщение..."
          className="message-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button
          className="send-button"
          onClick={handleSendMessage}
          disabled={loading || !inputValue.trim()}
        >
          {loading ? (
            <span>⏳</span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default ChatScreen;
