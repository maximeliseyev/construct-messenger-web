#!/bin/bash
set -e

echo "🔧 Checking Rust installation..."

# Check if Rust is installed
if ! command -v rustc &> /dev/null; then
    echo "📦 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    export PATH="$HOME/.cargo/bin:$PATH"
    source $HOME/.cargo/env 2>/dev/null || true
else
    echo "✅ Rust is already installed: $(rustc --version)"
fi

# Ensure cargo is in PATH
export PATH="$HOME/.cargo/bin:$PATH"

# Check if wasm32 target is installed
if ! rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
    echo "📦 Installing wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown
else
    echo "✅ wasm32-unknown-unknown target is already installed"
fi

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "📦 Installing wasm-pack..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
    export PATH="$HOME/.cargo/bin:$PATH"
else
    echo "✅ wasm-pack is already installed: $(wasm-pack --version)"
fi

# Ensure we're in the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Build WASM
echo "🏗️ Building WASM module..."
cd packages/core
wasm-pack build --target web --release --out-dir ../../apps/pwa/src/wasm/pkg

echo "✅ WASM build complete!"

