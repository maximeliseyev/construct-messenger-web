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


type RegisterSuccessCallback = (userId: string, sessionToken: string) => void;
type LoginSuccessCallback = (userId: string, sessionToken: string) => void;
type ServerErrorCallback = (code: string, message: string) => void;
type MessageCallback = (message: any) => void;

class MessengerService {
  private stateId: string | null = null;
  private isInitialized = false;
  private registerSuccessCallback: RegisterSuccessCallback | null = null;
  private loginSuccessCallback: LoginSuccessCallback | null = null;
  private serverErrorCallback: ServerErrorCallback | null = null;
  private connectionCheckInterval: number | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('Messenger already initialized.');
      return;
    }
    try {
      // 1. Initialize the WASM module
      // Явно указываем путь к WASM файлу для правильной загрузки
      const wasmUrl = new URL('../wasm/pkg/construct_core_bg.wasm', import.meta.url);
      await init(wasmUrl);
      
      // 2. Create a new application state instance
      // "construct-db" is an arbitrary name for the IndexedDB database
      this.stateId = await wasm.create_app_state("construct-db");

      this.isInitialized = true;
      console.log('Messenger initialized successfully with state ID:', this.stateId);
    } catch (error) {
      console.error('Failed to initialize WASM module:', error);
      throw new Error('Failed to initialize messenger core.');
    }
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

  async registerUser(username: string, password: string): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_initialize_user(stateId, username, password);
    // user_id будет получен от сервера после успешной регистрации (RegisterSuccess)
    // Не пытаемся получить его здесь, так как он еще не существует
  }

  async loginUser(userId: string, password: string): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_load_user(stateId, userId, password);
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

  async sendMessage(toContactId: string, sessionId: string, text: string): Promise<string> {
    const stateId = this.getStateId();
    return wasm.app_state_send_message(stateId, toContactId, sessionId, text);
  }

  async loadConversation(contactId: string): Promise<Conversation> {
    const stateId = this.getStateId();
    const messagesJson = await wasm.app_state_load_conversation(stateId, contactId);
    const messages = JSON.parse(messagesJson) as StoredMessage[];
    
    return {
      contact_id: contactId,
      messages: messages,
    };
  }

  async connect(serverUrl: string): Promise<void> {
    const stateId = this.getStateId();
    
    // Проверить, не подключены ли мы уже
    const currentState = wasm.app_state_connection_state(stateId);
    if (currentState === 'connected') {
      console.log('⚠️ Already connected, skipping connect');
      return;
    }
    
    await wasm.app_state_connect(stateId, serverUrl);
    
    // Начать проверку событий от сервера
    this.startEventPolling();
  }

  async disconnect(): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_disconnect(stateId);
    
    // Остановить проверку событий
    this.stopEventPolling();
  }

  /**
   * Ожидание установки соединения
   */
  async waitForConnection(timeout: number = 15000): Promise<void> {
    const stateId = this.getStateId();
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Проверяем состояние соединения
      const state = wasm.app_state_connection_state(stateId);
      if (state === 'connected') {
        // Дополнительная проверка - даем больше времени для полной инициализации WebSocket
        // Проверяем несколько раз, чтобы убедиться, что соединение стабильно
        let stableCount = 0;
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 200));
          const checkState = wasm.app_state_connection_state(stateId);
          if (checkState === 'connected') {
            stableCount++;
          } else {
            break;
          }
        }
        if (stableCount === 3) {
          console.log('✅ Connection is stable and ready');
          return;
        }
      }
      if (state === 'error') {
        throw new Error('Connection error');
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    throw new Error('Connection timeout');
  }

  /**
   * Зарегистрировать пользователя на сервере
   */
  registerOnServer(password: string): void {
    const stateId = this.getStateId();
    
    // Проверить состояние соединения перед отправкой
    const state = wasm.app_state_connection_state(stateId);
    if (state !== 'connected') {
      throw new Error(`WebSocket is not connected. Current state: ${state}. Wait for connection to be established.`);
    }
    
    console.log('📤 Sending Register message to server...');
    wasm.app_state_register_on_server(stateId, password);
    console.log('✅ Register message sent');
  }

  /**
   * Завершить регистрацию после получения UUID от сервера
   */
  async finalizeRegistration(userId: string, sessionToken: string, password: string): Promise<void> {
    const stateId = this.getStateId();
    await wasm.app_state_finalize_registration(stateId, userId, sessionToken, password);
  }

  /**
   * Установить callback для RegisterSuccess
   */
  onRegisterSuccess(callback: RegisterSuccessCallback): void {
    this.registerSuccessCallback = callback;
  }

  /**
   * Установить callback для LoginSuccess
   */
  onLoginSuccess(callback: LoginSuccessCallback): void {
    this.loginSuccessCallback = callback;
  }

  /**
   * Установить callback для ошибок сервера
   */
  onServerError(callback: ServerErrorCallback): void {
    this.serverErrorCallback = callback;
  }

  /**
   * Установить callback для входящих сообщений
   * @deprecated Not implemented yet
   */
  onMessage(_callback: MessageCallback): void {
    // TODO: Implement message callback
    console.warn('onMessage callback is not implemented yet');
  }

  /**
   * Начать опрос событий от сервера (через window объект)
   */
  private startEventPolling(): void {
    if (this.connectionCheckInterval) {
      console.log('⚠️ Event polling already started');
      return;
    }

    console.log('🔄 Starting event polling...');
    let pollCount = 0;
    this.connectionCheckInterval = window.setInterval(() => {
      pollCount++;
      // Логируем каждые 50 итераций (5 секунд) для отладки
      if (pollCount % 50 === 0) {
        const win = window as any;
        console.log('🔄 Event polling active, checking for events...', {
          hasRegisterSuccess: !!win.__construct_register_success,
          hasLoginSuccess: !!win.__construct_login_success,
          hasServerError: !!win.__construct_server_error,
          hasCallback: !!this.registerSuccessCallback,
        });
        
        // Проверим все возможные варианты имени объекта
        const allWindowKeys = Object.keys(win).filter(key => 
          key.includes('register') || key.includes('Register') || key.includes('success') || key.includes('Success')
        );
        if (allWindowKeys.length > 0) {
          console.log('🔍 Found potential RegisterSuccess keys in window:', allWindowKeys);
          allWindowKeys.forEach(key => {
            console.log(`  ${key}:`, win[key]);
          });
        }
      }

      // Проверить RegisterSuccess - проверяем все возможные варианты
      const win = window as any;
      let registerSuccess = win.__construct_register_success;
      
      // Если не нашли в стандартном месте, проверим другие возможные варианты
      if (!registerSuccess) {
        // Проверим все ключи window, которые могут содержать RegisterSuccess
        for (const key of Object.keys(win)) {
          if (key.toLowerCase().includes('register') && key.toLowerCase().includes('success')) {
            console.log(`🔍 Found alternative RegisterSuccess key: ${key}`);
            registerSuccess = win[key];
            break;
          }
        }
      }
      
      // Детальное логирование для отладки при первом обнаружении
      if (registerSuccess && !(win as any).__construct_register_success_logged) {
        console.log('🔍 Full RegisterSuccess object dump:', JSON.stringify(registerSuccess, null, 2));
        (win as any).__construct_register_success_logged = true;
      }
      
      if (registerSuccess) {
        console.log('🔔 Polling detected RegisterSuccess object:', registerSuccess);
        console.log('🔍 RegisterSuccess type:', typeof registerSuccess);
        console.log('🔍 RegisterSuccess constructor:', registerSuccess.constructor?.name);
        
        // Попробуем получить все свойства объекта (включая не-enumerable)
        const allProps: string[] = [];
        let obj = registerSuccess;
        while (obj && obj !== Object.prototype) {
          allProps.push(...Object.getOwnPropertyNames(obj));
          obj = Object.getPrototypeOf(obj);
        }
        console.log('🔍 All RegisterSuccess properties:', allProps);
        
        console.log('🔍 RegisterSuccess enumerable keys:', Object.keys(registerSuccess));
        console.log('🔍 RegisterSuccess values:', {
          userId: registerSuccess.userId,
          user_id: registerSuccess.user_id,
          sessionToken: registerSuccess.sessionToken,
          session_token: registerSuccess.session_token,
          username: registerSuccess.username,
        });
        
        // Попробуем получить данные через JSON.stringify
        try {
          const jsonStr = JSON.stringify(registerSuccess);
          console.log('🔍 RegisterSuccess as JSON:', jsonStr);
        } catch (e) {
          console.log('🔍 Cannot stringify RegisterSuccess:', e);
        }
        
        // Попробуем разные варианты извлечения данных
        let userId: string | undefined;
        let sessionToken: string | undefined;
        
        // Вариант 1: camelCase (serde_wasm_bindgen default)
        userId = registerSuccess.userId;
        sessionToken = registerSuccess.sessionToken;
        
        // Вариант 2: snake_case
        if (!userId) userId = registerSuccess.user_id;
        if (!sessionToken) sessionToken = registerSuccess.session_token;
        
        // Вариант 3: прямой доступ к полям объекта
        if (!userId && registerSuccess.data) {
          userId = registerSuccess.data.userId || registerSuccess.data.user_id;
          sessionToken = registerSuccess.data.sessionToken || registerSuccess.data.session_token;
        }
        
        // Вариант 4: попробуем получить через методы объекта (если это класс)
        if (!userId && typeof registerSuccess === 'object') {
          // Попробуем вызвать методы, если они есть
          if (typeof (registerSuccess as any).getUserId === 'function') {
            userId = (registerSuccess as any).getUserId();
          }
          if (typeof (registerSuccess as any).getSessionToken === 'function') {
            sessionToken = (registerSuccess as any).getSessionToken();
          }
          // Попробуем получить через индексацию
          if (!userId) {
            for (const prop of allProps) {
              if (prop.toLowerCase().includes('user') && prop.toLowerCase().includes('id')) {
                userId = (registerSuccess as any)[prop];
                break;
              }
            }
          }
          if (!sessionToken) {
            for (const prop of allProps) {
              if (prop.toLowerCase().includes('session') && prop.toLowerCase().includes('token')) {
                sessionToken = (registerSuccess as any)[prop];
                break;
              }
            }
          }
        }
        
        console.log('🔍 Extracted after all attempts:', { userId, sessionToken, hasCallback: !!this.registerSuccessCallback });
        
        if (this.registerSuccessCallback) {
          if (userId && sessionToken) {
            console.log('✅ Calling registerSuccessCallback with:', { userId, sessionToken });
            try {
              this.registerSuccessCallback(userId, sessionToken);
              console.log('✅ registerSuccessCallback completed');
              delete (window as any).__construct_register_success;
            } catch (err) {
              console.error('❌ Error in registerSuccessCallback:', err);
            }
          } else {
            console.error('❌ Invalid RegisterSuccess data structure:', registerSuccess);
            console.error('❌ Missing fields:', { 
              hasUserId: !!userId, 
              hasSessionToken: !!sessionToken,
              fullObject: registerSuccess
            });
          }
        } else {
          console.warn('⚠️ RegisterSuccess received but no callback set');
        }
      }

      // Проверить LoginSuccess
      const loginSuccess = (window as any).__construct_login_success;
      if (loginSuccess && this.loginSuccessCallback) {
        const data = loginSuccess;
        this.loginSuccessCallback(data.user_id, data.session_token);
        delete (window as any).__construct_login_success;
      }

      // Проверить ServerError
      const serverError = (window as any).__construct_server_error;
      if (serverError) {
        console.log('🔔 Polling detected ServerError:', serverError);
        if (this.serverErrorCallback) {
          const data = serverError;
          this.serverErrorCallback(data.code, data.message);
          delete (window as any).__construct_server_error;
        } else {
          console.warn('⚠️ ServerError received but no callback set:', serverError);
          // Очистить ошибку даже если нет callback
          delete (window as any).__construct_server_error;
        }
      }
    }, 100); // Проверять каждые 100ms
  }

  /**
   * Остановить опрос событий
   */
  private stopEventPolling(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  destroy(): void {
    this.stopEventPolling();
    
    if (this.stateId) {
      wasm.destroy_app_state(this.stateId);
      this.stateId = null;
    }
    this.isInitialized = false;
    
    // Очистить callbacks
    this.registerSuccessCallback = null;
    this.loginSuccessCallback = null;
    this.serverErrorCallback = null;
    
    console.log('Messenger destroyed.');
  }
}

// Export a singleton instance of the service
export const messenger = new MessengerService();