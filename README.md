# 🔐 Construct Messenger (Web PWA)

**Secure end-to-end encrypted messenger with crypto-agility and post-quantum readiness**

This repository contains the web-based Progressive Web App (PWA) for Construct Messenger, built with React, TypeScript, and Vite. The core cryptographic logic is powered by a Rust-based WebAssembly (WASM) module from the separate [`construct-core`](https://github.com/maximeliseyev/construct-core) repository.

---

## 🚀 Quick Start for Web Developers

This guide will get you up and running with the PWA.

### Requirements

- **Node.js** v18+
- **pnpm** v8+

### 1. Install Dependencies

First, install the necessary dependencies using `pnpm`:

```bash
pnpm install
```

### 2. Build the WASM Module

The cryptographic core is a WASM module that must be built before running the app. A convenient script is provided to handle this. It will automatically check for Rust and `wasm-pack`, and then clone the [`construct-core`](https://github.com/maximeliseyev/construct-core) repository to compile it.

```bash
pnpm build:wasm
```
**Note:** This step requires an internet connection to download the Rust toolchain and the core repository if they are not already present.

### 3. Run the Development Server

Once the WASM module is built, you can start the Vite development server:

```bash
pnpm dev
```

The application will be available at `http://localhost:5173` (or the next available port).

---

## 🛠️ Project Structure

This is a `pnpm` monorepo using `Turborepo`.

```
construct-messenger-web/
│
├── apps/
│   └── pwa/                # 🌐 Web PWA application (React + Vite)
│       ├── src/
│       │   ├── components/ # React components
│       │   ├── services/   # Messenger service (interacts with WASM)
│       │   ├── lib/        # Shared libraries and utilities
│       │   └── wasm/       # Generated WASM bindings (output of build:wasm)
│       ├── vite.config.ts  # Vite configuration
│       └── package.json
│
├── scripts/
│   └── build-wasm.sh      # Script to build the WASM module from construct-core
│
├── package.json           # Root package.json for the monorepo
├── pnpm-workspace.yaml    # pnpm workspace configuration
└── README.md              # 📖 This file
```

---

## 🎯 About the Project

Construct Messenger is a modern **end-to-end encrypted** messenger built on:

- **Double Ratchet Protocol** (Signal Protocol) for forward secrecy
- **X3DH** for asynchronous key agreement
- **Rust Core** for the cryptographic logic
- **Crypto-Agility** and **Post-Quantum Ready** architecture

### Key Features

- ✅ **100% E2EE** - The server never sees plaintext
- ✅ **Forward Secrecy** - Compromised keys do not reveal history
- ✅ **Multi-Platform** - Single Rust core for iOS, Android, and Web
- ✅ **QR Code Sharing** - For easy contact exchange
- ✅ **Offline Message Queue**

---
## 🤝 Contributing

We welcome contributions! Please familiarize yourself with:

1. Create an Issue to discuss new features
2. Submit a Pull Request

### Priority Areas

- 🔴 **Critical:** Complete profile sharing implementation
- 🟠 **Important:** Enhanced message delivery status (seen/read receipts)
- 🟡 **Useful:** UI/UX polish (toast notifications, loading states)

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details