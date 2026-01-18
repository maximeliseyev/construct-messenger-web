import init, * as wasm from '../wasm/pkg/construct_core.js';

// Define the types locally as they are not exported from WASM
export type Contact = {
    id: string;
    username: string;
    // Add other fields as necessary
};

export type Conversation = {
    contact_id: string;
    messages: StoredMessage[];
    unread_count?: number;
};

export type StoredMessage = {
    id: string;
    conversation_id: string;
    from: string;
    to: string;
    encrypted_content: string;
    timestamp: number;
    status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
};

// Глобальная защита от повторной инициализации WASM модуля
let wasmInitPromise: Promise<void> | null = null;
let wasmInitialized = false;

class MessengerService {
  private stateId: string | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(serverUrl: string): Promise<void> {
    // Если уже инициализирован, возвращаемся
    if (this.isInitialized) {
      console.log('Messenger already initialized.');
      return;
    }

    // Если инициализация уже идёт, ждём её завершения
    if (this.initPromise) {
      return this.initPromise;
    }

    // Создаём промис инициализации
    this.initPromise = this._doInitialize(serverUrl);
    
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInitialize(serverUrl: string): Promise<void> {
    try {
      console.log('🔧 Initializing messenger with server URL:', serverUrl || '(empty - will use relative paths)');
      
      // Проверяем доступность необходимых API
      if (typeof fetch === 'undefined') {
        throw new Error('fetch API is not available. This application requires a modern browser.');
      }

      // Проверяем доступность IndexedDB
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB is not available. This application requires a modern browser with IndexedDB support.');
      }
      
      // 1. Initialize the WASM module (глобально, только один раз)
      if (!wasmInitPromise) {
        wasmInitPromise = (async () => {
          if (wasmInitialized) {
            console.log('WASM module already initialized globally.');
            return;
          }
          const wasmUrl = new URL('../wasm/pkg/construct_core_bg.wasm', import.meta.url);
          console.log('📦 Loading WASM module from:', wasmUrl.href);
          // Используем новый API wasm-bindgen: передаём объект с module_or_path
          await init({ module_or_path: wasmUrl.href });
          wasmInitialized = true;
          console.log('✅ WASM module loaded successfully');
        })();
      }
      
      await wasmInitPromise;
      
      // Проверяем, что функции WASM доступны
      if (typeof wasm.create_app_state !== 'function') {
        throw new Error('WASM module is not properly initialized. create_app_state function is not available.');
      }
      
      // 2. Create a new application state instance with server URL
      // Теперь create_app_state принимает server_url вместо db_name
      console.log('🔨 Creating app state with server URL:', serverUrl || '(empty)');
      
      // Проверяем состояние IndexedDB перед созданием
      let hasExistingDb = false;
      try {
        const dbList = await new Promise<string[]>((resolve, reject) => {
          const req = indexedDB.databases();
          req.then(dbs => resolve(dbs.map(db => db.name))).catch(reject);
        });
        hasExistingDb = dbList.includes('construct_messenger');
        console.log('📊 Existing IndexedDB databases:', dbList);
        if (hasExistingDb) {
          console.log('ℹ️ Found existing construct_messenger database (messages and keys will be preserved)');
        }
      } catch (e) {
        console.warn('⚠️ Could not list IndexedDB databases:', e);
      }
      
      try {
        // Создаём app state с таймаутом для предотвращения зависания
        const createPromise = wasm.create_app_state(serverUrl);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('create_app_state timeout after 15 seconds')), 15000)
        );
        
        this.stateId = await Promise.race([createPromise, timeoutPromise]);
        console.log('✅ App state created successfully with ID:', this.stateId);
      } catch (createError) {
        console.error('❌ Error creating app state:', createError);
        // Пробуем получить больше информации об ошибке
        if (createError instanceof Error) {
          console.error('Error name:', createError.name);
          console.error('Error message:', createError.message);
          console.error('Error stack:', createError.stack);
        }
        
        // Если это таймаут, возможно база данных повреждена или заблокирована
        if (createError instanceof Error && createError.message.includes('timeout')) {
          console.error('💡 Timeout detected. The database might be locked or corrupted.');
          console.error('   ⚠️ WARNING: Deleting the database will remove ALL messages, keys, and contacts!');
          console.error('   If you want to try deleting the database, run: window.clearConstructDB()');
          console.error('   Or manually delete IndexedDB in DevTools (Application → Storage)');
        } else {
          console.error('💡 Possible solutions:');
          console.error('   1. Try refreshing the page');
          console.error('   2. Check browser console for IndexedDB errors');
          console.error('   3. If the problem persists, you may need to clear IndexedDB');
          console.error('      (⚠️ This will delete all messages, keys, and contacts)');
          console.error('      Run: window.clearConstructDB()');
        }
        
        throw createError;
      }

      this.isInitialized = true;
      console.log('✅ Messenger initialized successfully with state ID:', this.stateId, 'server URL:', serverUrl);
    } catch (error) {
      console.error('Failed to initialize WASM module:', error);
      // Extract more detailed error information
      const errorMessage = error instanceof Error 
        ? error.message 
        : String(error);
      const errorDetails = error instanceof Error && error.stack
        ? `\n${error.stack}`
        : '';
      throw new Error(`Failed to initialize messenger core: ${errorMessage}${errorDetails}`);
    }
  }

  /**
   * Check if messenger is initialized
   */
  checkInitialized(): boolean {
    return this.isInitialized && this.stateId !== null;
  }

  /**
   * Asserts that the messenger is initialized and returns the state ID.
   */
  private getStateId(): string {
    if (!this.stateId) {
      throw new Error('Messenger is not initialized. Call initialize() first.');
    }
    return this.stateId;
  }

  /**
   * Register a new user via REST API
   * Combines old initialize_user + register_on_server steps
   */
  async registerUser(username: string, password: string): Promise<string> {
    const stateId = this.getStateId();
    const userId = await wasm.app_state_register(stateId, username, password);
    return userId;
  }

  /**
   * Login an existing user via REST API
   * Combines old load_user + connect steps
   */
  async loginUser(username: string, password: string): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_login(stateId, username, password);
  }

  getCurrentUser(): { userId?: string; username?: string } {
    const stateId = this.getStateId();
    const userId = wasm.app_state_get_user_id(stateId);
    const username = wasm.app_state_get_username(stateId);
    return { userId, username };
  }

  async addContact(contactId: string, username: string): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_add_contact(stateId, contactId, username);
  }

  getContacts(): Contact[] {
    const stateId = this.getStateId();
    // serde-wasm-bindgen automatically converts the JsValue to a JS object/array
    return wasm.app_state_get_contacts(stateId) as Contact[];
  }

  /**
   * Send a message via REST API
   * Note: session_id is now auto-managed by WASM core
   */
  async sendMessage(toContactId: string, text: string): Promise<string> {
    const stateId = this.getStateId();
    return wasm.app_state_send_message(stateId, toContactId, text);
  }

  /**
   * Start long polling for incoming messages
   */
  async startPolling(): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_start_polling(stateId);
    console.log('✅ Long polling started');
  }

  /**
   * Stop long polling for incoming messages
   */
  stopPolling(): void {
    const stateId = this.getStateId();
    wasm.app_state_stop_polling(stateId);
    console.log('✅ Long polling stopped');
  }

  /**
   * Check if long polling is active
   */
  isPolling(): boolean {
    const stateId = this.getStateId();
    return wasm.app_state_is_polling(stateId);
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    const stateId = this.getStateId();
    // Stop polling before logout
    this.stopPolling();
    await wasm.app_state_logout(stateId);
    console.log('✅ User logged out');
  }

  /**
   * Get messages for a conversation from local storage (IndexedDB)
   * Messages are stored by WASM module through polling
   */
  async getMessages(contactId: string): Promise<StoredMessage[]> {
    // Ensure messenger is initialized
    this.getStateId();
    
    try {
      // Get messages from IndexedDB where WASM module stores them through polling
      // The WASM module stores messages in IndexedDB with key structure
      const dbName = 'construct_messenger';
      
      return new Promise((resolve) => {
        const request = indexedDB.open(dbName);
        
        request.onerror = () => {
          console.warn('Could not open IndexedDB, returning empty messages');
          resolve([]);
        };
        
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          // Try to find the messages store
          // WASM might use different store names, so we'll try common ones
          const storeNames = ['messages', 'conversations', 'message_store'];
          let found = false;
          
          for (const storeName of storeNames) {
            if (db.objectStoreNames.contains(storeName)) {
              found = true;
              const transaction = db.transaction([storeName], 'readonly');
              const store = transaction.objectStore(storeName);
              
              // Try to get messages by conversation_id or contact_id
              // The exact key structure depends on WASM implementation
              const indexName = store.indexNames.contains('conversation_id') 
                ? 'conversation_id' 
                : store.indexNames.contains('contact_id')
                ? 'contact_id'
                : null;
              
              if (indexName) {
                const index = store.index(indexName);
                const getRequest = index.getAll(contactId);
                
                getRequest.onsuccess = () => {
                  const messages = getRequest.result || [];
                  // Sort by timestamp
                  messages.sort((a: StoredMessage, b: StoredMessage) => a.timestamp - b.timestamp);
                  resolve(messages);
                };
                
                getRequest.onerror = () => {
                  console.warn('Could not get messages from IndexedDB');
                  resolve([]);
                };
              } else {
                // No index, try to get all and filter
                const getAllRequest = store.getAll();
                
                getAllRequest.onsuccess = () => {
                  const allMessages = getAllRequest.result || [];
                  const filtered = allMessages.filter((msg: StoredMessage) => 
                    msg.conversation_id === contactId || msg.to === contactId || msg.from === contactId
                  );
                  filtered.sort((a: StoredMessage, b: StoredMessage) => a.timestamp - b.timestamp);
                  resolve(filtered);
                };
                
                getAllRequest.onerror = () => {
                  console.warn('Could not get messages from IndexedDB');
                  resolve([]);
                };
              }
              
              break;
            }
          }
          
          if (!found) {
            console.warn('Messages store not found in IndexedDB');
            resolve([]);
          }
        };
        
        request.onupgradeneeded = () => {
          // Database doesn't exist or needs upgrade
          resolve([]);
        };
      });
    } catch (err) {
      console.warn('Error getting messages from IndexedDB:', err);
      return [];
    }
  }

  /**
   * @deprecated Use getMessages instead. Messages should be retrieved through polling and stored locally.
   */
  async loadConversation(contactId: string): Promise<Conversation> {
    console.warn('loadConversation is deprecated. Use getMessages instead.');
    const messages = await this.getMessages(contactId);
    return {
      contact_id: contactId,
      messages,
    };
  }


  destroy(): void {
    // Stop polling before destroying
    if (this.isPolling()) {
      this.stopPolling();
    }
    
    if (this.stateId) {
      try {
        wasm.destroy_app_state(this.stateId);
      } catch (error) {
        console.error('Error destroying app state:', error);
      }
      this.stateId = null;
    }
    this.isInitialized = false;
    this.initPromise = null;
    
    console.log('Messenger destroyed.');
  }
}

// Export a singleton instance of the service
export const messenger = new MessengerService();

/**
 * Утилита для очистки IndexedDB (можно вызвать из консоли браузера)
 * Использование: window.clearConstructDB()
 */
if (typeof window !== 'undefined') {
  (window as any).clearConstructDB = async () => {
    console.log('🧹 Clearing IndexedDB databases...');
    try {
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          console.log(`Deleting database: ${db.name}`);
          const deleteReq = indexedDB.deleteDatabase(db.name);
          await new Promise<void>((resolve, reject) => {
            deleteReq.onsuccess = () => {
              console.log(`✅ Deleted: ${db.name}`);
              resolve();
            };
            deleteReq.onerror = () => {
              console.error(`❌ Failed to delete: ${db.name}`);
              reject(deleteReq.error);
            };
            deleteReq.onblocked = () => {
              console.warn(`⚠️ Blocked: ${db.name} (close all connections first)`);
              resolve(); // Продолжаем даже если заблокировано
            };
          });
        }
      }
      console.log('✅ IndexedDB cleared. Please refresh the page.');
    } catch (error) {
      console.error('❌ Error clearing IndexedDB:', error);
    }
  };
  console.log('💡 To clear IndexedDB, run: window.clearConstructDB()');
}