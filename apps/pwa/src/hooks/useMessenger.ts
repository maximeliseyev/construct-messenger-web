import { useState, useEffect, useCallback } from 'react';
import { messenger, Contact, Conversation } from '../services/messenger';
import { SERVER_URL } from '../config/constants';

/**
 * React Hook для работы с мессенджером
 */
export function useMessenger() {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ userId?: string; username?: string }>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  // Инициализация при монтировании
  useEffect(() => {
    const init = async () => {
      try {
        // Initialize with server URL (REST API endpoint)
        await messenger.initialize(SERVER_URL);
        setInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize messenger');
      }
    };
    init();

    return () => {
      // Cleanup при размонтировании
      messenger.destroy();
    };
  }, []);

  // Регистрация нового пользователя
  // Note: registerUser now combines old initialize + register steps via REST API
  const register = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const userId = await messenger.registerUser(username, password);
      const user = messenger.getCurrentUser();
      setCurrentUser(user);
      
      // Start polling after registration
      await messenger.startPolling();
      setIsPolling(true);
      
      // Загрузить контакты
      const contactsList = messenger.getContacts();
      setContacts(contactsList);
      
      return userId;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Registration failed';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Вход существующего пользователя
  // Note: loginUser now combines old load + connect steps via REST API
  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      await messenger.loginUser(username, password);
      const user = messenger.getCurrentUser();
      setCurrentUser(user);

      // Start polling after login
      await messenger.startPolling();
      setIsPolling(true);

      // Загрузить контакты
      const contactsList = messenger.getContacts();
      setContacts(contactsList);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Login failed';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Добавить контакт
  const addContact = useCallback(async (contactId: string, username: string) => {
    setLoading(true);
    setError(null);
    try {
      await messenger.addContact(contactId, username);
      const contactsList = messenger.getContacts();
      setContacts(contactsList);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to add contact';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Отправить сообщение
  // Note: session_id is now auto-managed by WASM core
  const sendMessage = useCallback(async (toContactId: string, text: string) => {
    setLoading(true);
    setError(null);
    try {
      const messageId = await messenger.sendMessage(toContactId, text);
      return messageId;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Загрузить беседу
  const loadConversation = useCallback(async (contactId: string): Promise<Conversation> => {
    setLoading(true);
    setError(null);
    try {
      const conversation = await messenger.loadConversation(contactId);
      return conversation;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load conversation';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Start polling for incoming messages
  const startPolling = useCallback(async () => {
    setError(null);
    try {
      await messenger.startPolling();
      setIsPolling(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start polling';
      setError(errorMsg);
      throw new Error(errorMsg);
    }
  }, []);

  // Stop polling for incoming messages
  const stopPolling = useCallback(() => {
    try {
      messenger.stopPolling();
      setIsPolling(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to stop polling';
      setError(errorMsg);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await messenger.logout();
      setCurrentUser({});
      setContacts([]);
      setIsPolling(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Logout failed';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
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
    loadConversation,
    startPolling,
    stopPolling,
    logout,
  };
}
