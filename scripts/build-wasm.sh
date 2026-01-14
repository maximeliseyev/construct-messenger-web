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

# Find construct-core path
# Try: 1) git submodule, 2) sibling directory, 3) local path (fallback)
if [ -d "$PROJECT_ROOT/packages/core" ]; then
    CORE_PATH="$PROJECT_ROOT/packages/core"
    echo "📦 Using local construct-core at: $CORE_PATH"
elif [ -d "$PROJECT_ROOT/../construct-core" ]; then
    CORE_PATH="$PROJECT_ROOT/../construct-core"
    echo "📦 Using sibling construct-core at: $CORE_PATH"
else
    echo "⚠️  construct-core not found locally. Cloning from git..."
    CORE_PATH="$PROJECT_ROOT/.construct-core-temp"
    if [ ! -d "$CORE_PATH" ]; then
        git clone --depth 1 https://github.com/maximeliseyev/construct-core.git "$CORE_PATH" || {
            echo "❌ Failed to clone construct-core. Please ensure you have access to the repository."
            echo "Alternatively, you can:"
            echo "  1. Clone construct-core manually to ../construct-core"
            echo "  2. Or use git submodule: git submodule add https://github.com/maximeliseyev/construct-core.git packages/core"
            exit 1
        }
    fi
    echo "📦 Cloned construct-core to: $CORE_PATH"
fi

# Build WASM
echo "🏗️ Building WASM module..."
cd "$CORE_PATH"
wasm-pack build --target web --release --out-dir "$PROJECT_ROOT/apps/pwa/src/wasm/pkg" --features wasm

# Cleanup temporary directory if we cloned it
if [ "$CORE_PATH" == "$PROJECT_ROOT/.construct-core-temp" ]; then
    echo "🧹 Cleaning up temporary construct-core clone..."
    rm -rf "$PROJECT_ROOT/.construct-core-temp"
fi

echo "✅ WASM build complete!"

