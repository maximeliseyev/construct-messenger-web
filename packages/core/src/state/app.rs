use crate::api::contacts::{Contact, ContactManager};
use crate::api::crypto::CryptoCore;
use crate::storage::models::*;
use crate::utils::error::{ConstructError, Result};
use crate::utils::time::current_timestamp;
use std::collections::HashMap;

#[cfg(target_arch = "wasm32")]
use crate::storage::indexeddb::IndexedDbStorage;

#[cfg(not(target_arch = "wasm32"))]
use crate::storage::memory::MemoryStorage;

use crate::protocol::messages::ChatMessage;
use crate::state::conversations::ConversationsManager;
use crate::crypto::CryptoProvider;
use std::marker::PhantomData;

#[cfg(target_arch = "wasm32")]
use crate::protocol::transport::WebSocketTransport;



/// Состояние подключения к серверу
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

/// Состояние UI
#[derive(Debug, Clone)]
pub struct UiState {
    pub is_loading: bool,
    pub error_message: Option<String>,
    pub notification: Option<String>,
}

impl UiState {
    pub fn new() -> Self {
        Self {
            is_loading: false,
            error_message: None,
            notification: None,
        }
    }

    pub fn set_loading(&mut self, loading: bool) {
        self.is_loading = loading;
    }

    pub fn set_error(&mut self, error: String) {
        self.error_message = Some(error);
    }

    pub fn clear_error(&mut self) {
        self.error_message = None;
    }

    pub fn set_notification(&mut self, notification: String) {
        self.notification = Some(notification);
    }

    pub fn clear_notification(&mut self) {
        self.notification = None;
    }
}

impl Default for UiState {
    fn default() -> Self {
        Self::new()
    }
}

/// Состояние автоматического переподключения
#[derive(Debug, Clone)]
pub struct ReconnectState {
    /// Количество попыток переподключения
    attempts: u32,
    /// Максимальное количество попыток (0 = бесконечно)
    max_attempts: u32,
    /// Текущая задержка в миллисекундах
    current_delay_ms: u32,
    /// Начальная задержка в миллисекундах
    initial_delay_ms: u32,
    /// Максимальная задержка в миллисекундах
    max_delay_ms: u32,
    /// Включено ли автоматическое переподключение
    enabled: bool,
}

impl ReconnectState {
    /// Создать новое состояние переподключения
    pub fn new() -> Self {
        let cfg = crate::config::Config::global();
        let initial_delay = cfg.websocket_retry_initial_ms as u32;
        let max_delay = cfg.websocket_retry_max_ms as u32;

        Self {
            attempts: 0,
            max_attempts: 0,        // Бесконечные попытки
            current_delay_ms: initial_delay,
            initial_delay_ms: initial_delay,
            max_delay_ms: max_delay,
            enabled: true,
        }
    }

    /// Вычислить следующую задержку с exponential backoff
    pub fn next_delay(&mut self) -> u32 {
        let delay = self.current_delay_ms;

        // Exponential backoff: удваиваем задержку
        self.current_delay_ms = (self.current_delay_ms * 2).min(self.max_delay_ms);
        self.attempts += 1;

        delay
    }

    /// Сбросить счётчик попыток
    pub fn reset(&mut self) {
        self.attempts = 0;
        self.current_delay_ms = self.initial_delay_ms;
    }

    /// Проверить, можно ли продолжать попытки
    pub fn can_retry(&self) -> bool {
        self.enabled && (self.max_attempts == 0 || self.attempts < self.max_attempts)
    }

    /// Получить количество попыток
    pub fn attempts(&self) -> u32 {
        self.attempts
    }

    /// Включить/выключить автоматическое переподключение
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
}

impl Default for ReconnectState {
    fn default() -> Self {
        Self::new()
    }
}

/// Главное состояние всего приложения
pub struct AppState<P: CryptoProvider> {
    // === Идентификация пользователя ===
    user_id: Option<String>,
    username: Option<String>,

    // === Менеджеры ===
    crypto_manager: CryptoCore<P>,
    contact_manager: ContactManager,
    conversations_manager: ConversationsManager,

    // === Хранилище ===
    #[cfg(target_arch = "wasm32")]
    storage: IndexedDbStorage,
    #[cfg(not(target_arch = "wasm32"))]
    storage: MemoryStorage,

    // === Состояние соединения ===
    #[cfg(target_arch = "wasm32")]
    transport: Option<WebSocketTransport>,
    connection_state: ConnectionState,
    server_url: Option<String>,
    reconnect_state: ReconnectState,

    // === Кеш сообщений (в памяти) ===
    message_cache: HashMap<String, Vec<StoredMessage>>,

    // === Состояние UI ===
    active_conversation: Option<String>,
    ui_state: UiState,

    _phantom: PhantomData<P>,
}

impl<P: CryptoProvider> AppState<P> {
    /// Создать новое состояние приложения
    #[cfg(target_arch = "wasm32")]
    pub async fn new() -> Result<Self> {
        let mut storage = IndexedDbStorage::new();
        storage.init().await?;

        let crypto_manager = CryptoCore::<P>::new()?;
        let contact_manager = ContactManager::new();
        let conversations_manager = ConversationsManager::new();

        Ok(Self {
            user_id: None,
            username: None,
            crypto_manager,
            contact_manager,
            conversations_manager,
            storage,
            transport: None,
            connection_state: ConnectionState::Disconnected,
            server_url: None,
            reconnect_state: ReconnectState::new(),
            message_cache: HashMap::new(),
            active_conversation: None,
            ui_state: UiState::new(),
            _phantom: PhantomData,
        })
    }

    /// Создать новое состояние приложения (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(_db_name: &str) -> Result<Self> {
        let storage = MemoryStorage::new();
        let crypto_manager = CryptoCore::<P>::new()?;
        let contact_manager = ContactManager::new();
        let conversations_manager = ConversationsManager::new();

        Ok(Self {
            user_id: None,
            username: None,
            crypto_manager,
            contact_manager,
            conversations_manager,
            storage,
            connection_state: ConnectionState::Disconnected,
            server_url: None,
            reconnect_state: ReconnectState::new(),
            message_cache: HashMap::new(),
            active_conversation: None,
            ui_state: UiState::new(),
            _phantom: PhantomData,
        })
    }

    // === Инициализация пользователя ===

    /// Инициализировать нового пользователя (только создать ключи, не сохранять)
    /// UUID будет получен от сервера после успешной регистрации
    #[cfg(target_arch = "wasm32")]
    pub async fn initialize_user(&mut self, username: String, password: String) -> Result<()> {
        use crate::crypto::master_key;

        self.ui_state.set_loading(true);

        // Валидация пароля
        master_key::validate_password(&password)?;

        // Криптографические ключи уже созданы в CryptoManager при создании AppState
        // Просто сохраняем username и password временно (password нужен для finalize_registration)
        self.username = Some(username);

        self.ui_state.set_loading(false);
        Ok(())
    }

    /// Завершить регистрацию после получения UUID от сервера
    #[cfg(target_arch = "wasm32")]
    pub async fn finalize_registration(
        &mut self,
        server_user_id: String,
        _session_token: String,
        password: String,
    ) -> Result<()> {
        use crate::crypto::master_key;
        use crate::storage::models::StoredPrivateKeys;
        use crate::utils::time::current_timestamp;

        // 1. Экспортировать приватные ключи из CryptoManager
        // Для этого нужно получить доступ к внутренним ключам
        // Пока используем упрощенный подход - ключи уже созданы при initialize_user
        
        // 2. Зашифровать приватные ключи мастер-паролем
        let salt = master_key::generate_salt();
        let master_key = master_key::derive_master_key(&password, &salt)?;
        
        // Получить приватные ключи из crypto_manager
        // Это требует доступа к внутренней структуре Client
        // Пока используем заглушку - в реальности нужно добавить метод export_private_keys в CryptoCore
        
        // 3. Сохранить зашифрованные ключи в IndexedDB
        let stored_keys = StoredPrivateKeys {
            user_id: server_user_id.clone(),
            encrypted_identity_private: vec![], // TODO: получить и зашифровать
            encrypted_signed_prekey_private: vec![], // TODO: получить и зашифровать
            encrypted_signing_key: vec![], // TODO: получить и зашифровать
            prekey_signature: vec![], // TODO: получить
            salt: salt.to_vec(),
            created_at: current_timestamp(),
        };
        
        self.storage.save_private_keys(stored_keys).await?;

        // 4. Сохранить user_id и username
        self.user_id = Some(server_user_id);
        
        // 5. Сохранить метаданные
        let metadata = crate::storage::models::StoredAppMetadata {
            user_id: self.user_id.as_ref().unwrap().clone(),
            username: self.username.as_ref().unwrap().clone(),
            last_sync: current_timestamp(),
            settings: vec![], // Пустые настройки по умолчанию
        };
        self.storage.save_metadata(metadata).await?;

        Ok(())
    }

    /// Инициализировать нового пользователя (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn initialize_user(&mut self, username: String, password: String) -> Result<()> {
        use crate::crypto::master_key;

        self.ui_state.set_loading(true);

        // Валидация пароля
        master_key::validate_password(&password)?;

        // Только сохраняем username
        self.username = Some(username);

        self.ui_state.set_loading(false);
        Ok(())
    }

    /// Завершить регистрацию (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn finalize_registration(
        &mut self,
        _server_user_id: String,
        _session_token: String,
        _password: String,
    ) -> Result<()> {
        unimplemented!()
    }

    /// Загрузить существующего пользователя
    #[cfg(target_arch = "wasm32")]
    pub async fn load_user(&mut self, user_id: String, password: String) -> Result<()> {
        use crate::crypto::master_key;
        use crate::storage::models::StoredPrivateKeys;

        // 1. Загрузить зашифрованные ключи из IndexedDB
        let stored_keys = self.storage.load_private_keys(&user_id).await?
            .ok_or_else(|| ConstructError::InvalidInput("User not found in storage".to_string()))?;

        // 2. Расшифровать ключи
        let master_key = master_key::derive_master_key(&password, &stored_keys.salt)?;
        let private_keys = master_key::decrypt_private_keys(&stored_keys, &master_key)?;

        // 3. Импортировать ключи в CryptoManager
        // Это требует доступа к внутренней структуре Client
        // Пока используем заглушку - в реальности нужно добавить метод import_private_keys в CryptoCore
        
        // 4. Загрузить метаданные
        if let Some(metadata) = self.storage.load_metadata(&user_id).await? {
            self.user_id = Some(metadata.user_id.clone());
            self.username = Some(metadata.username.clone());
        } else {
            return Err(ConstructError::InvalidInput("Metadata not found".to_string()));
        }

        // 5. Загрузить контакты
        let contacts = self.storage.load_all_contacts().await?;
        for stored_contact in contacts {
            let contact = crate::api::contacts::create_contact(stored_contact.id.clone(), stored_contact.username.clone());
            let _ = self.contact_manager.add_contact(contact);
        }

        // 6. Загрузить сессии
        let sessions = self.storage.load_all_sessions().await?;
        for stored_session in sessions {
            // Десериализовать сессию и восстановить в crypto_manager
            // Это требует доступа к внутренней структуре Client
            // Пока пропускаем - сессии будут созданы заново при первом сообщении
        }

        Ok(())
    }

    /// Загрузить существующего пользователя (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load_user(&mut self, _user_id: String, _password: String) -> Result<()> {
        unimplemented!()
    }

    // === Управление контактами ===

    /// Добавить контакт
    #[cfg(target_arch = "wasm32")]
    pub async fn add_contact(&mut self, contact_id: String, username: String) -> Result<()> {
        // 1. Добавить в ContactManager
        let contact = crate::api::contacts::create_contact(contact_id.clone(), username.clone());
        self.contact_manager.add_contact(contact)?;

        // 2. Сохранить в storage
        let stored = StoredContact {
            id: contact_id,
            username,
            public_key_bundle: None,
            added_at: current_timestamp(),
            last_message_at: None,
        };
        self.storage.save_contact(stored).await?;

        Ok(())
    }

    /// Добавить контакт (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn add_contact(&mut self, contact_id: String, username: String) -> Result<()> {
        let contact = crate::api::contacts::create_contact(contact_id.clone(), username.clone());
        self.contact_manager.add_contact(contact)?;

        let stored = StoredContact {
            id: contact_id,
            username,
            public_key_bundle: None,
            added_at: current_timestamp(),
            last_message_at: None,
        };
        self.storage.save_contact(stored)?;

        Ok(())
    }

    /// Получить все контакты
    pub fn get_contacts(&self) -> Vec<&Contact> {
        self.contact_manager.get_all_contacts()
    }

    // === Работа с сообщениями ===

    /// Отправить сообщение
    #[cfg(target_arch = "wasm32")]
    pub async fn send_message(
        &mut self,
        to_contact_id: &str,
        _session_id: &str,
        plaintext: &str,
    ) -> Result<String> {
        use crate::protocol::messages::{ClientMessage, ChatMessage};
        use crate::crypto::messaging::double_ratchet::EncryptedRatchetMessage;
        use crate::storage::models::{StoredMessage, MessageStatus};
        use crate::utils::time::current_timestamp;
        use base64::Engine;
        use uuid::Uuid;

        let current_user_id = self.user_id.clone()
            .ok_or_else(|| ConstructError::InvalidInput("User not logged in".to_string()))?;

        // 1. Проверить наличие сессии, если нет - инициализировать
        if !self.crypto_manager.has_session(to_contact_id) {
            // Нужно получить public key bundle контакта
            // Пока возвращаем ошибку - в реальности нужно запросить bundle с сервера
            return Err(ConstructError::SessionError(
                "Session not initialized. Need to request public key bundle first.".to_string()
            ));
        }

        // 2. Зашифровать сообщение
        let encrypted = self.crypto_manager_mut()
            .encrypt_message(to_contact_id, plaintext)?;

        // 3. Конвертировать EncryptedRatchetMessage в ChatMessage
        let message_id = Uuid::new_v4().to_string();
        
        // Объединить nonce и ciphertext в sealed box (base64)
        let mut sealed_box = encrypted.nonce.clone();
        sealed_box.extend_from_slice(&encrypted.ciphertext);
        let content = base64::engine::general_purpose::STANDARD.encode(&sealed_box);

        let chat_msg = ChatMessage {
            id: message_id.clone(),
            from: current_user_id.clone(),
            to: to_contact_id.to_string(),
            ephemeral_public_key: encrypted.dh_public_key.to_vec(),
            message_number: encrypted.message_number,
            content,
            timestamp: current_timestamp() as u64,
        };

        // 4. Отправить через WebSocket
        let transport = self.transport.as_ref()
            .ok_or_else(|| ConstructError::NetworkError("Not connected to server".to_string()))?;
        
        transport.send(&ClientMessage::SendMessage(chat_msg.clone()))?;

        // 5. Сохранить сообщение в хранилище
        let stored_msg = StoredMessage {
            id: message_id.clone(),
            conversation_id: to_contact_id.to_string(),
            from: current_user_id.clone(),
            to: to_contact_id.to_string(),
            encrypted_content: chat_msg.content.clone(),
            timestamp: current_timestamp(),
            status: MessageStatus::Sent,
        };

        self.storage.save_message(stored_msg.clone()).await?;

        // 6. Обновить кеш
        self.message_cache
            .entry(to_contact_id.to_string())
            .or_insert_with(Vec::new)
            .push(stored_msg);

        Ok(message_id)
    }

    /// Отправить сообщение (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn send_message(
        &mut self,
        to_contact_id: &str,
        _session_id: &str,
        plaintext: &str,
    ) -> Result<String> {
        unimplemented!()
    }

    /// Обработать входящее сообщение
    #[cfg(target_arch = "wasm32")]
    pub async fn receive_message(&mut self, chat_msg: ChatMessage, _session_id: &str) -> Result<()> {
        self.handle_incoming_message(chat_msg).await
    }

    /// Обработать входящее сообщение (non-WASM заглушка)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn receive_message(&mut self, _chat_msg: ChatMessage, _session_id: &str) -> Result<()> {
        Ok(())
    }

    /// Обновить кеш сообщений
    #[cfg(target_arch = "wasm32")]
    async fn update_message_cache(
        &mut self,
        conversation_id: &str,
        msg: StoredMessage,
    ) -> Result<()> {
        unimplemented!()
    }

    /// Загрузить беседу
    #[cfg(target_arch = "wasm32")]
    pub async fn load_conversation(&mut self, contact_id: &str) -> Result<Vec<StoredMessage>> {
        // 1. Попробовать загрузить из кеша
        if let Some(messages) = self.message_cache.get(contact_id) {
            return Ok(messages.clone());
        }

        // 2. Загрузить из хранилища
        let messages = self.storage.load_messages_for_conversation(contact_id, 100, 0).await?;

        // 3. Сохранить в кеш
        self.message_cache.insert(contact_id.to_string(), messages.clone());

        Ok(messages)
    }

    /// Загрузить беседу (non-WASM версия)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load_conversation(&mut self, contact_id: &str) -> Result<Vec<StoredMessage>> {
        unimplemented!()
    }

    /// Установить активную беседу
    pub fn set_active_conversation(&mut self, contact_id: Option<String>) {
        self.active_conversation = contact_id;
    }

    /// Получить активную беседу
    pub fn get_active_conversation(&self) -> Option<&str> {
        self.active_conversation.as_deref()
    }

    // === Управление соединением ===

    /// Подключиться к серверу WebSocket
    /// ВАЖНО: Этот метод НЕ используется в WASM версии!
    /// В WASM используется app_state_connect из bindings, который вызывает setup_transport_callbacks_with_arc
    #[cfg(target_arch = "wasm32")]
    pub fn connect(&mut self, server_url: &str) -> Result<()> {
        if self.connection_state == ConnectionState::Connected {
            return Err(ConstructError::NetworkError(
                "Already connected".to_string(),
            ));
        }

        self.connection_state = ConnectionState::Connecting;

        let mut transport = WebSocketTransport::new();
        transport.connect(server_url)?;

        // НЕ устанавливаем базовые callbacks здесь - они будут установлены через setup_transport_callbacks_with_arc
        // self.setup_transport_callbacks(&mut transport)?;

        self.transport = Some(transport);
        self.connection_state = ConnectionState::Connected;

        Ok(())
    }

    /// Настроить WebSocket callbacks (базовая версия без Arc)
    /// Эта версия используется внутри AppState, где мы не имеем доступа к Arc
    #[cfg(target_arch = "wasm32")]
    fn setup_transport_callbacks(&self, transport: &mut WebSocketTransport) -> Result<()> {
        // Callback для успешного подключения
        transport.set_on_open(|| {
            web_sys::console::log_1(&"✅ WebSocket connected successfully".into());
        })?;

        // Базовый callback для входящих сообщений
        transport.set_on_message(|msg| {
            web_sys::console::log_1(&format!("📩 Received message: {:?}", msg).into());
        })?;

        // Callback для ошибок
        transport.set_on_error(|err| {
            web_sys::console::log_1(&format!("❌ WebSocket error: {}", err).into());
        })?;

        // Callback для закрытия соединения
        transport.set_on_close(|code, reason| {
            web_sys::console::log_1(&format!("🔌 WebSocket closed: {} - {}", code, reason).into());
        })?;

        Ok(())
    }

    /// Настроить WebSocket callbacks с доступом к Arc<Mutex<AppState>>
    /// Эта версия вызывается из WASM bindings и имеет полный доступ к AppState
    #[cfg(target_arch = "wasm32")]
    pub fn setup_transport_callbacks_with_arc(
        transport: &mut WebSocketTransport,
        app_state_arc: std::sync::Arc<std::sync::Mutex<AppState<P>>>,
    ) -> Result<()> {
        use crate::protocol::messages::{ServerMessage, ChatMessage};
        use crate::crypto::messaging::double_ratchet::EncryptedRatchetMessage;
        use base64::Engine;

        // Callback для успешного подключения
        {
            let app_state_arc = app_state_arc.clone();
            transport.set_on_open(move || {
                web_sys::console::log_1(&"✅ WebSocket connected successfully".into());
                if let Ok(mut state) = app_state_arc.lock() {
                    state.set_connection_state(ConnectionState::Connected);
                }
            })?;
        }

        // Callback для входящих сообщений
        {
            let app_state_arc = app_state_arc.clone();
            transport.set_on_message(move |msg: ServerMessage| {
                let app_state_arc = app_state_arc.clone();
                
                // Используем wasm_bindgen_futures для async обработки
                wasm_bindgen_futures::spawn_local(async move {
                    if let Ok(mut state) = app_state_arc.lock() {
                        match msg {
                            ServerMessage::Message(chat_msg) => {
                                web_sys::console::log_1(&format!("📩 Received message from {}", chat_msg.from).into());
                                if let Err(e) = state.handle_incoming_message(chat_msg).await {
                                    web_sys::console::log_1(&format!("❌ Failed to handle message: {}", e).into());
                                }
                            }
                            ServerMessage::RegisterSuccess(data) => {
                                web_sys::console::log_1(&format!("🎯 RegisterSuccess handler called: {}", data.user_id).into());
                                // Сохранить в window для доступа из JavaScript
                                // Создаем объект вручную, чтобы избежать проблем с serde_wasm_bindgen
                                if let Some(window) = web_sys::window() {
                                    use js_sys::Object;
                                    let obj = Object::new();
                                    let _ = js_sys::Reflect::set(&obj, &"userId".into(), &data.user_id.clone().into());
                                    let _ = js_sys::Reflect::set(&obj, &"username".into(), &data.username.clone().into());
                                    let _ = js_sys::Reflect::set(&obj, &"sessionToken".into(), &data.session_token.clone().into());
                                    let _ = js_sys::Reflect::set(&obj, &"expires".into(), &(data.expires as f64).into());
                                    
                                    web_sys::console::log_1(&"💾 Created RegisterSuccess object manually".into());
                                    
                                    if let Err(e) = js_sys::Reflect::set(&window, &"__construct_register_success".into(), &obj) {
                                        web_sys::console::log_1(&format!("❌ Failed to set __construct_register_success: {:?}", e).into());
                                    } else {
                                        web_sys::console::log_1(&"✅ RegisterSuccess saved to window.__construct_register_success".into());
                                        // Проверить, что действительно сохранилось
                                        if let Ok(check) = js_sys::Reflect::get(&window, &"__construct_register_success".into()) {
                                            web_sys::console::log_1(&format!("🔍 Verification: window.__construct_register_success exists: {}", !check.is_undefined()).into());
                                            // Попробовать прочитать значения
                                            if let Ok(user_id_val) = js_sys::Reflect::get(&check, &"userId".into()) {
                                                web_sys::console::log_1(&format!("🔍 userId value: {:?}", user_id_val).into());
                                            }
                                        }
                                    }
                                } else {
                                    web_sys::console::log_1(&"❌ Failed to get window object".into());
                                }
                            }
                            ServerMessage::LoginSuccess(data) => {
                                web_sys::console::log_1(&format!("✅ Login successful: {}", data.user_id).into());
                                if let Some(window) = web_sys::window() {
                                    let value = serde_wasm_bindgen::to_value(&data).unwrap_or_default();
                                    let _ = js_sys::Reflect::set(&window, &"__construct_login_success".into(), &value);
                                }
                            }
                            ServerMessage::Ack(ack) => {
                                web_sys::console::log_1(&format!("✓ Message {} acknowledged", ack.message_id).into());
                                if let Err(e) = state.update_message_status(&ack.message_id, crate::storage::models::MessageStatus::Delivered).await {
                                    web_sys::console::log_1(&format!("❌ Failed to update message status: {}", e).into());
                                }
                            }
                            ServerMessage::Error(err) => {
                                web_sys::console::log_1(&format!("❌ Server error: {} - {}", err.code, err.message).into());
                                if let Some(window) = web_sys::window() {
                                    let value = serde_wasm_bindgen::to_value(&err).unwrap_or_default();
                                    let _ = js_sys::Reflect::set(&window, &"__construct_server_error".into(), &value);
                                }
                            }
                            ServerMessage::PublicKeyBundle(bundle) => {
                                web_sys::console::log_1(&format!("🔑 Received public key bundle for {}", bundle.user_id).into());
                                // Сохранить bundle для контакта
                                if let Err(e) = state.save_contact_bundle(&bundle.user_id, &bundle).await {
                                    web_sys::console::log_1(&format!("❌ Failed to save bundle: {}", e).into());
                                }
                            }
                            _ => {
                                web_sys::console::log_1(&format!("📨 Received server message: {:?}", msg).into());
                            }
                        }
                    }
                });
            })?;
        }

        // Callback для ошибок
        {
            let app_state_arc = app_state_arc.clone();
            transport.set_on_error(move |err: String| {
                web_sys::console::log_1(&format!("❌ WebSocket error: {}", err).into());
                if let Ok(mut state) = app_state_arc.lock() {
                    state.set_connection_state(ConnectionState::Error);
                }
            })?;
        }

        // Callback для закрытия соединения
        {
            let app_state_arc = app_state_arc.clone();
            transport.set_on_close(move |code: u16, reason: String| {
                web_sys::console::log_1(&format!("🔌 WebSocket closed: {} - {}", code, reason).into());
                if let Ok(mut state) = app_state_arc.lock() {
                    state.set_connection_state(ConnectionState::Disconnected);
                }
            })?;
        }

        Ok(())
    }

    /// Обработать входящее сообщение от сервера
    #[cfg(target_arch = "wasm32")]
    async fn handle_incoming_message(&mut self, chat_msg: ChatMessage) -> Result<()> {
        use crate::crypto::messaging::double_ratchet::EncryptedRatchetMessage;
        use crate::storage::models::{StoredMessage, MessageStatus};
        use base64::Engine;
        use crate::utils::time::current_timestamp;

        let current_user_id = self.user_id.as_ref()
            .ok_or_else(|| ConstructError::InvalidInput("User not logged in".to_string()))?;

        // Определить contact_id (отправитель или получатель)
        let contact_id = if chat_msg.from == *current_user_id {
            &chat_msg.to
        } else {
            &chat_msg.from
        };

        // Конвертировать ChatMessage в EncryptedRatchetMessage
        let dh_public_key: [u8; 32] = chat_msg.ephemeral_public_key[..32]
            .try_into()
            .map_err(|_| ConstructError::CryptoError("Invalid ephemeral key length".to_string()))?;

        // Декодировать content (base64) в ciphertext
        let sealed_box = base64::engine::general_purpose::STANDARD
            .decode(&chat_msg.content)
            .map_err(|e| ConstructError::SerializationError(format!("Invalid base64: {}", e)))?;

        // Извлечь nonce (первые 12 байт) и ciphertext (остальное)
        if sealed_box.len() < 12 {
            return Err(ConstructError::CryptoError("Invalid sealed box length".to_string()));
        }
        let nonce = sealed_box[..12].to_vec();
        let ciphertext = sealed_box[12..].to_vec();

        let encrypted_msg = EncryptedRatchetMessage {
            dh_public_key,
            message_number: chat_msg.message_number,
            ciphertext,
            nonce,
            previous_chain_length: 0, // Не используется при расшифровке
            suite_id: crate::config::Config::global().classic_suite_id,
        };

        // Расшифровать сообщение
        let plaintext = self.crypto_manager_mut()
            .decrypt_message(contact_id, &encrypted_msg)?;

        // Сохранить сообщение в хранилище
        let stored_msg = StoredMessage {
            id: chat_msg.id.clone(),
            conversation_id: contact_id.to_string(),
            from: chat_msg.from.clone(),
            to: chat_msg.to.clone(),
            encrypted_content: chat_msg.content.clone(), // Сохраняем зашифрованное для истории
            timestamp: chat_msg.timestamp as i64,
            status: MessageStatus::Delivered,
        };

        self.storage.save_message(stored_msg.clone()).await?;

        // Обновить кеш
        self.message_cache
            .entry(contact_id.to_string())
            .or_insert_with(Vec::new)
            .push(stored_msg);

        // Обновить последнее сообщение в беседе
        if let Some(contact) = self.contact_manager.get_contact(contact_id) {
            let mut stored_contact = crate::storage::models::StoredContact {
                id: contact.id.clone(),
                username: contact.username.clone(),
                public_key_bundle: None,
                added_at: current_timestamp(),
                last_message_at: Some(chat_msg.timestamp as i64),
            };
            self.storage.save_contact(stored_contact).await?;
        }

        Ok(())
    }

    /// Сохранить public key bundle для контакта
    #[cfg(target_arch = "wasm32")]
    async fn save_contact_bundle(
        &mut self,
        contact_id: &str,
        bundle: &crate::protocol::messages::PublicKeyBundleData,
    ) -> Result<()> {
        use crate::utils::time::current_timestamp;

        // Сериализовать bundle в JSON
        let bundle_json = serde_json::to_vec(bundle)
            .map_err(|e| ConstructError::SerializationError(format!("Failed to serialize bundle: {}", e)))?;

        // Найти контакт
        if let Some(contact) = self.contact_manager.get_contact(contact_id) {
            let mut stored_contact = crate::storage::models::StoredContact {
                id: contact.id.clone(),
                username: contact.username.clone(),
                public_key_bundle: Some(bundle_json),
                added_at: current_timestamp(),
                last_message_at: None,
            };
            self.storage.save_contact(stored_contact).await?;
        }

        Ok(())
    }

    /// Обновить статус сообщения
    #[cfg(target_arch = "wasm32")]
    async fn update_message_status(
        &mut self,
        message_id: &str,
        status: crate::storage::models::MessageStatus,
    ) -> Result<()> {
        // Найти сообщение в кеше и обновить статус
        for messages in self.message_cache.values_mut() {
            if let Some(msg) = messages.iter_mut().find(|m| m.id == message_id) {
                msg.status = status;
                // Сохранить в хранилище
                self.storage.save_message(msg.clone()).await?;
                return Ok(());
            }
        }

        // Если не найдено в кеше, загрузить из хранилища
        // (упрощенная версия - в реальности нужен индекс по message_id)
        Ok(())
    }

    /// Подключиться к серверу (non-WASM заглушка)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn connect(&mut self, _server_url: &str) -> Result<()> {
        Err(ConstructError::NetworkError(
            "WebSocket only available in WASM".to_string(),
        ))
    }

    /// Отключиться от сервера
    #[cfg(target_arch = "wasm32")]
    pub fn disconnect(&mut self) -> Result<()> {
        if let Some(transport) = &mut self.transport {
            transport.close()?;
        }

        self.transport = None;
        self.connection_state = ConnectionState::Disconnected;

        Ok(())
    }

    /// Отключиться от сервера (non-WASM заглушка)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn disconnect(&mut self) -> Result<()> {
        self.connection_state = ConnectionState::Disconnected;
        Ok(())
    }

    /// Установить WebSocket транспорт
    /// Используется из WASM bindings после настройки callbacks
    #[cfg(target_arch = "wasm32")]
    pub fn set_transport(&mut self, transport: WebSocketTransport) {
        self.transport = Some(transport);
        self.connection_state = ConnectionState::Connecting;
    }

    /// Установить состояние соединения
    pub fn set_connection_state(&mut self, state: ConnectionState) {
        self.connection_state = state;
    }

    /// Получить состояние соединения
    pub fn connection_state(&self) -> ConnectionState {
        self.connection_state
    }

    /// Проверить, подключен ли к серверу
    pub fn is_connected(&self) -> bool {
        self.connection_state == ConnectionState::Connected
    }

    /// Проверить реальное состояние WebSocket соединения
    #[cfg(target_arch = "wasm32")]
    pub fn is_websocket_ready(&self) -> bool {
        self.transport.as_ref()
            .map(|t| t.is_connected())
            .unwrap_or(false)
    }

    /// Установить URL сервера
    pub fn set_server_url(&mut self, url: String) {
        self.server_url = Some(url);
    }

    /// Получить URL сервера
    pub fn get_server_url(&self) -> Option<&str> {
        self.server_url.as_deref()
    }

    /// Получить состояние переподключения
    pub fn reconnect_state(&self) -> &ReconnectState {
        &self.reconnect_state
    }

    /// Получить мутабельное состояние переподключения
    pub fn reconnect_state_mut(&mut self) -> &mut ReconnectState {
        &mut self.reconnect_state
    }

    /// Запланировать автоматическое переподключение
    #[cfg(target_arch = "wasm32")]
    pub fn schedule_reconnect(app_state_arc: std::sync::Arc<std::sync::Mutex<AppState<P>>>) {
        unimplemented!()
    }

    /// Попытка переподключения
    #[cfg(target_arch = "wasm32")]
    async fn attempt_reconnect(
        app_state_arc: std::sync::Arc<std::sync::Mutex<AppState<P>>>,
        server_url: &str,
    ) -> Result<()> {
        unimplemented!()
    }

    // === Геттеры для UI ===

    pub fn get_user_id(&self) -> Option<&str> {
        self.user_id.as_deref()
    }

    pub fn get_username(&self) -> Option<&str> {
        self.username.as_deref()
    }

    pub fn ui_state(&self) -> &UiState {
        &self.ui_state
    }

    pub fn ui_state_mut(&mut self) -> &mut UiState {
        &mut self.ui_state
    }

    pub fn crypto_manager(&self) -> &CryptoCore<P> {
        &self.crypto_manager
    }

    pub fn crypto_manager_mut(&mut self) -> &mut CryptoCore<P> {
        &mut self.crypto_manager
    }

    pub fn conversations_manager(&self) -> &ConversationsManager {
        &self.conversations_manager
    }

    pub fn conversations_manager_mut(&mut self) -> &mut ConversationsManager {
        &mut self.conversations_manager
    }

    // === Очистка ===

    /// Очистить все данные
    pub async fn clear_all_data(&mut self) -> Result<()> {
        // Очистить кеши
        self.message_cache.clear();
        self.conversations_manager.clear_all();
        self.contact_manager.clear_all();

        // Очистить хранилище
        #[cfg(target_arch = "wasm32")]
        self.storage.clear_all().await?;
        #[cfg(not(target_arch = "wasm32"))]
        self.storage.clear_all()?;

        // Сбросить состояние
        self.user_id = None;
        self.username = None;
        self.active_conversation = None;
        self.connection_state = ConnectionState::Disconnected;

        Ok(())
    }

    // === Регистрация на сервере ===

    /// Зарегистрировать пользователя на сервере
    /// Отправляет сообщение Register с username, password и registration bundle
    #[cfg(target_arch = "wasm32")]
    pub fn register_on_server(&self, password: String) -> Result<()> {
        use crate::protocol::messages::{ClientMessage, RegisterData};

        // 1. Проверить, что пользователь инициализирован
        let username = self.username.as_ref()
            .ok_or_else(|| ConstructError::InvalidInput(
                "User not initialized. Call initialize_user first.".to_string()
            ))?;

        // 2. Проверить, что есть transport и он подключен
        let transport = self.transport.as_ref()
            .ok_or_else(|| ConstructError::NetworkError(
                "Not connected to server. Call connect first.".to_string()
            ))?;
        
        // Проверить реальное состояние WebSocket соединения
        if !transport.is_connected() {
            return Err(ConstructError::NetworkError(
                "WebSocket is not connected. Wait for connection to be established.".to_string()
            ));
        }

        // 3. Создать UploadableKeyBundle согласно API v3
        let public_key = self.crypto_manager.create_uploadable_key_bundle()?;

        // 4. Создать RegisterData
        let register_data = RegisterData {
            username: username.clone(),
            password,
            public_key,
        };

        // 6. Отправить через transport
        let message = ClientMessage::Register(register_data);
        transport.send(&message)?;

        Ok(())
    }

    /// Зарегистрировать пользователя на сервере (non-WASM заглушка)
    #[cfg(not(target_arch = "wasm32"))]
    pub fn register_on_server(&self, _password: String) -> Result<()> {
        Err(ConstructError::NetworkError(
            "Registration only available in WASM".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::suites::classic::ClassicSuiteProvider;

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_app_state_creation() {
        let state = AppState::<ClassicSuiteProvider>::new("test_db");
        assert!(state.is_ok());

        let state = state.unwrap();
        assert!(state.get_user_id().is_none());
        assert_eq!(state.connection_state(), ConnectionState::Disconnected);
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_app_state_initialize_user() {
        let mut state = AppState::<ClassicSuiteProvider>::new("test_db").unwrap();
        state
            .initialize_user("alice".to_string(), "testpass123".to_string())
            .unwrap();

        assert_eq!(state.get_username(), Some("alice"));
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn test_app_state_contacts() {
        let mut state = AppState::<ClassicSuiteProvider>::new("test_db").unwrap();
        state
            .initialize_user("alice".to_string(), "testpass123".to_string())
            .unwrap();

        state
            .add_contact("contact1".to_string(), "bob".to_string())
            .unwrap();

        let contacts = state.get_contacts();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].username, "bob");
    }
}