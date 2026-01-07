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
  private messageCallback: MessageCallback | null = null;
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
  async waitForConnection(timeout: number = 10000): Promise<void> {
    const stateId = this.getStateId();
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Проверяем состояние соединения
      const state = wasm.app_state_connection_state(stateId);
      if (state === 'connected') {
        // Дополнительная проверка - даем немного времени для полной инициализации
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
      }
      if (state === 'error') {
        throw new Error('Connection error');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Connection timeout');
  }

  /**
   * Зарегистрировать пользователя на сервере
   */
  registerOnServer(password: string): void {
    const stateId = this.getStateId();
    wasm.app_state_register_on_server(stateId, password);
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
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallback = callback;
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
    this.connectionCheckInterval = window.setInterval(() => {
      // Проверить RegisterSuccess
      const registerSuccess = (window as any).__construct_register_success;
      
      // Логируем каждую итерацию для отладки (можно убрать позже)
      if (registerSuccess) {
        console.log('🔔 Polling detected RegisterSuccess object:', registerSuccess);
        console.log('🔍 RegisterSuccess type:', typeof registerSuccess);
        console.log('🔍 RegisterSuccess keys:', Object.keys(registerSuccess));
        console.log('🔍 RegisterSuccess values:', {
          userId: registerSuccess.userId,
          user_id: registerSuccess.user_id,
          sessionToken: registerSuccess.sessionToken,
          session_token: registerSuccess.session_token,
          username: registerSuccess.username,
        });
        
        if (this.registerSuccessCallback) {
          const data = registerSuccess;
          // serde_wasm_bindgen использует camelCase для полей (из-за rename_all = "camelCase")
          const userId = data.userId || data.user_id;
          const sessionToken = data.sessionToken || data.session_token;
          
          console.log('🔍 Extracted:', { userId, sessionToken, hasCallback: !!this.registerSuccessCallback });
          
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
            console.error('❌ Invalid RegisterSuccess data structure:', data);
            console.error('❌ Missing fields:', { 
              hasUserId: !!userId, 
              hasSessionToken: !!sessionToken 
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
      if (serverError && this.serverErrorCallback) {
        const data = serverError;
        this.serverErrorCallback(data.code, data.message);
        delete (window as any).__construct_server_error;
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
    this.messageCallback = null;
    
    console.log('Messenger destroyed.');
  }
}

// Export a singleton instance of the service
export const messenger = new MessengerService();