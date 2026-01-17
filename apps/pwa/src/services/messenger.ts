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

class MessengerService {
  private stateId: string | null = null;
  private isInitialized = false;

  async initialize(serverUrl: string): Promise<void> {
    if (this.isInitialized) {
      console.log('Messenger already initialized.');
      return;
    }
    try {
      console.log('🔧 Initializing messenger with server URL:', serverUrl || '(empty - will use relative paths)');
      
      // 1. Initialize the WASM module
      // Явно указываем путь к WASM файлу для правильной загрузки
      const wasmUrl = new URL('../wasm/pkg/construct_core_bg.wasm', import.meta.url);
      console.log('📦 Loading WASM module from:', wasmUrl.href);
      await init(wasmUrl);
      console.log('✅ WASM module loaded successfully');
      
      // 2. Create a new application state instance with server URL
      // Теперь create_app_state принимает server_url вместо db_name
      console.log('🔨 Creating app state with server URL:', serverUrl || '(empty)');
      this.stateId = await wasm.create_app_state(serverUrl);

      this.isInitialized = true;
      console.log('Messenger initialized successfully with state ID:', this.stateId, 'server URL:', serverUrl);
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
   * Note: loadConversation is no longer available in the new API
   * Messages should be retrieved through polling and stored locally
   */
  async loadConversation(contactId: string): Promise<Conversation> {
    // TODO: Implement message loading from local storage
    // For now, return empty conversation
    console.warn('loadConversation is deprecated. Use polling to receive messages.');
    return {
      contact_id: contactId,
      messages: [],
    };
  }


  destroy(): void {
    // Stop polling before destroying
    if (this.isPolling()) {
      this.stopPolling();
    }
    
    if (this.stateId) {
      wasm.destroy_app_state(this.stateId);
      this.stateId = null;
    }
    this.isInitialized = false;
    
    console.log('Messenger destroyed.');
  }
}

// Export a singleton instance of the service
export const messenger = new MessengerService();