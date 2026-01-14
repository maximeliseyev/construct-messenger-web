// TypeScript wrapper for WASM crypto module
// NOTE: This file is deprecated. The old crypto API is no longer exported from WASM.
// Use AppState API instead (see messenger.ts for examples).

import init from '../wasm/pkg/construct_core.js';

let wasmInitialized = false;

export interface KeyBundle {
  identity_public: number[];
  signed_prekey_public: number[];
  signature: number[];
  verifying_key: number[];
}

export interface EncryptedMessage {
  session_id: string;
  ciphertext: number[];
  dh_public_key: number[];
  nonce: number[];
  message_number: number;
  previous_chain_length: number;
}

export class CryptoClient {
  private clientId: string | null = null;

  async initialize(): Promise<void> {
    if (!wasmInitialized) {
      await init();
      wasmInitialized = true;
      console.log('🔐 Construct Crypto WASM initialized');
    }

    // Old API is deprecated - this is a stub for backward compatibility
    console.warn('⚠️ CryptoClient is deprecated. Use AppState API instead.');
    this.clientId = 'deprecated';
  }

  getKeyBundle(): KeyBundle {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  getKeyBundleJSON(): string {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  initSession(_contactId: string, _remoteBundleJSON: string): string {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  initReceivingSession(_contactId: string, _remoteBundleJSON: string, _firstMessageJSON: string): string {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  encryptMessage(_sessionId: string, _plaintext: string): EncryptedMessage {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  encryptMessageJSON(_sessionId: string, _plaintext: string): string {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  decryptMessage(_sessionId: string, _encryptedJSON: string): string {
    throw new Error('CryptoClient is deprecated. Use AppState API instead.');
  }

  destroy(): void {
    this.clientId = null;
  }

  getId(): string | null {
    return this.clientId;
  }
}

// Singleton instance for the app
let appCryptoClient: CryptoClient | null = null;

export async function getAppCryptoClient(): Promise<CryptoClient> {
  if (!appCryptoClient) {
    appCryptoClient = new CryptoClient();
    await appCryptoClient.initialize();
  }
  return appCryptoClient;
}

export function getCryptoVersion(): string {
  return 'deprecated';
}
