#!/usr/bin/env bash
# Start the one assistant-runtime Design Studio talks to (text, voice, design
# decisions) from this repository's checked-in launch file. Run from anywhere:
#   scripts/runtime-up.sh              # 127.0.0.1:7100, replaces a previous runtime there
#   scripts/runtime-up.sh --no-replace
# RUNTIME_DIR points at an assistant-runtime source checkout (default:
# ../assistant-runtime); without one, an installed `assistant-runtime` with the
# voice extra is used. Provider credentials stay in the runtime's .env or the
# environment; nothing here is a secret.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-$APP_DIR/../assistant-runtime}"
export ASSISTANT__PROFILE="$APP_DIR/profiles/design-studio.toml"
export VOICE__CONVERSATION_INSTRUCTIONS_FILE="$APP_DIR/profiles/live-instructions.md"
HOST="${RUNTIME_HOST:-127.0.0.1}"
PORT="${RUNTIME_PORT:-7100}"
if [ -f "$RUNTIME_DIR/pyproject.toml" ]; then
  cd "$RUNTIME_DIR"
  if [ -z "${OAUTH__ENCRYPTION_KEY:-}" ]; then
    # Ephemeral: without a database nothing is persisted with it.
    OAUTH__ENCRYPTION_KEY="$(uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
    export OAUTH__ENCRYPTION_KEY
  fi
  exec uv run --env-file "$APP_DIR/runtime/design-runtime.env" \
    assistant-runtime serve --host "$HOST" --port "$PORT" "$@"
fi
if ! command -v assistant-runtime >/dev/null; then
  echo "assistant-runtime not found: set RUNTIME_DIR to a checkout or install it (pip install 'assistant-runtime[voice]')" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. "$APP_DIR/runtime/design-runtime.env"
set +a
exec assistant-runtime serve --host "$HOST" --port "$PORT" "$@"
