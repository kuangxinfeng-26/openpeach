#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="${OPENPEACH_APP_DIR:-$REPO_ROOT}"
ENV_FILE="${OPENPEACH_ENV_FILE:-$APP_DIR/.env}"
SERVICE_NAME="${OPENPEACH_SERVICE_NAME:-openpeach}"
SERVICE_USER="${OPENPEACH_SERVICE_USER:-openpeach}"
NODE_VERSION="${OPENPEACH_NODE_VERSION:-v24.15.0}"
NODE_GYP_PYTHON="${OPENPEACH_NODE_GYP_PYTHON:-}"
MIHOMO_VERSION="${OPENPEACH_MIHOMO_VERSION:-v1.19.24}"
SYSTEMD_DIR="${OPENPEACH_SYSTEMD_DIR:-/etc/systemd/system}"
WITH_MIHOMO=0
PROXY_PROFILE="${OPENPEACH_PROXY_PROFILE:-none}"
PROXY_ENV_FILE="${OPENPEACH_PROXY_ENV_FILE:-}"
MODEL_CONFIG_FILE="${OPENPEACH_MODEL_CONFIG_FILE:-$APP_DIR/.openpeach/model.runtime.local.toml}"
MODEL_CONFIG_EXPLICIT=0
OPENPEACH_HOME_DIR="${OPENPEACH_HOME:-$APP_DIR/.openpeach}"
RUNTIME_FAMILY_ID="${TAOQIBAO_FAMILY_ID:-main}"

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/linux/install-openpeach.sh [options]

Options:
  --app-dir <path>          Deployment directory. Defaults to the current repo root.
  --env-file <path>         Runtime env file. Defaults to <app-dir>/.env.
  --service-name <name>     systemd service name. Defaults to openpeach.
  --service-user <name>     Service user/group name. Defaults to openpeach.
  --node-version <version>  Node.js version to install. Defaults to v24.15.0.
  --with-mihomo             Install and enable the mihomo sidecar.
  --proxy-profile <name>    Proxy profile. Currently supports: vmess.
  --proxy-env-file <path>   Shell env file that defines OPENPEACH_VMESS_* values.
  --mihomo-version <ver>    Mihomo version to install. Defaults to v1.19.24.
  --model-config <path>     Project-local OpenPeach model TOML to sync into .env.
  --help                    Show this help.

Environment overrides:
  OPENPEACH_MODEL_CONFIG_FILE
  OPENPEACH_NODE_DOWNLOAD_URL
  OPENPEACH_NODE_GYP_PYTHON
  OPENPEACH_MIHOMO_DOWNLOAD_URL
  OPENPEACH_MIHOMO_HTTP_PORT
  OPENPEACH_MIHOMO_SOCKS_PORT
  OPENPEACH_HOME
  TAOQIBAO_FAMILY_ID
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --node-version)
      NODE_VERSION="$2"
      shift 2
      ;;
    --with-mihomo)
      WITH_MIHOMO=1
      shift
      ;;
    --proxy-profile)
      PROXY_PROFILE="$2"
      shift 2
      ;;
    --proxy-env-file)
      PROXY_ENV_FILE="$2"
      shift 2
      ;;
    --mihomo-version)
      MIHOMO_VERSION="$2"
      shift 2
      ;;
    --model-config)
      MODEL_CONFIG_FILE="$2"
      MODEL_CONFIG_EXPLICIT=1
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this installer as root, for example: sudo bash deploy/linux/install-openpeach.sh" >&2
  exit 1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer currently supports Linux only." >&2
  exit 1
fi

if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "This installer currently supports x86_64 only." >&2
  exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Expected package.json under $APP_DIR. Clone the repo first or override --app-dir." >&2
  exit 1
fi

NODE_DIST_BASENAME="node-${NODE_VERSION}-linux-x64"
NODE_INSTALL_DIR="$APP_DIR/.local/$NODE_DIST_BASENAME"
NODE_CURRENT_DIR="$APP_DIR/.local/node-current"
NODE_BIN="$NODE_CURRENT_DIR/bin/node"
NPM_BIN="$NODE_CURRENT_DIR/bin/npm"
NODE_DOWNLOAD_URL="${OPENPEACH_NODE_DOWNLOAD_URL:-https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST_BASENAME}.tar.xz}"

MIHOMO_HTTP_PORT="${OPENPEACH_MIHOMO_HTTP_PORT:-7890}"
MIHOMO_SOCKS_PORT="${OPENPEACH_MIHOMO_SOCKS_PORT:-7891}"
MIHOMO_DIR="$APP_DIR/.config/mihomo"
MIHOMO_BIN="$APP_DIR/.local/bin/mihomo"
MIHOMO_SERVICE_NAME="${SERVICE_NAME}-mihomo"
MIHOMO_DOWNLOAD_URL="${OPENPEACH_MIHOMO_DOWNLOAD_URL:-https://sourceforge.net/projects/mihomo.mirror/files/${MIHOMO_VERSION}/mihomo-linux-amd64-${MIHOMO_VERSION}.gz/download}"

ensure_service_user() {
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home "$APP_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

prepare_directories() {
  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" \
    "$APP_DIR" \
    "$APP_DIR/.local" \
    "$APP_DIR/.local/bin" \
    "$APP_DIR/.config" \
    "$MIHOMO_DIR" \
    "$OPENPEACH_HOME_DIR"
}

copy_if_missing() {
  local source="$1"
  local target="$2"
  local fallback="$3"

  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$(dirname "$target")"
  if [[ -f "$target" ]]; then
    return
  fi

  if [[ -f "$source" ]]; then
    install -m 0644 -o "$SERVICE_USER" -g "$SERVICE_USER" "$source" "$target"
  else
    printf "%b\n" "$fallback" > "$target"
    chown "$SERVICE_USER:$SERVICE_USER" "$target"
    chmod 0644 "$target"
  fi
}

initialize_runtime_workspace() {
  local family_dir="$OPENPEACH_HOME_DIR/families/$RUNTIME_FAMILY_ID"
  local agent
  local child

  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" \
    "$family_dir" \
    "$family_dir/agents" \
    "$family_dir/users" \
    "$family_dir/household" \
    "$family_dir/memory/private" \
    "$family_dir/memory/shared" \
    "$family_dir/memory/device" \
    "$family_dir/memory/project" \
    "$family_dir/memory/restricted" \
    "$family_dir/tasks" \
    "$family_dir/outbox" \
    "$family_dir/logs"

  for agent in main home lab; do
    for child in workspace state sessions artifacts skills; do
      install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$family_dir/agents/$agent/$child"
    done
    copy_if_missing \
      "$APP_DIR/.openpeach/agents/$agent/agent.md" \
      "$family_dir/agents/$agent/agent.md" \
      "# $agent Agent\n\nRuntime profile for the $agent core agent."
  done

  copy_if_missing \
    "$APP_DIR/.openpeach/users/owner/user.md" \
    "$family_dir/users/owner/user.md" \
    "# Owner User Profile\n\nPrimary owner profile for this OpenPeach family workspace."

  copy_if_missing \
    "$APP_DIR/.openpeach/agents/README.md" \
    "$family_dir/README.md" \
    "# OpenPeach Runtime Workspace\n\nFamily: $RUNTIME_FAMILY_ID"

  "$NODE_BIN" "$REPO_ROOT/scripts/render-openpeach-install-artifacts.mjs" \
    env-upsert "$ENV_FILE" \
    "OPENPEACH_HOME=$OPENPEACH_HOME_DIR" \
    "TAOQIBAO_STATE_DB=$family_dir/state.db"
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
}

install_node() {
  if [[ -x "$NODE_BIN" ]]; then
    echo "Node.js already installed at $NODE_BIN"
    return
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"

  echo "Downloading Node.js $NODE_VERSION"
  curl -L --fail --show-error -o "$tmpdir/node.tar.xz" "$NODE_DOWNLOAD_URL"
  rm -rf "$NODE_INSTALL_DIR"
  tar -xJf "$tmpdir/node.tar.xz" -C "$APP_DIR/.local"
  ln -sfn "$NODE_INSTALL_DIR" "$NODE_CURRENT_DIR"
  rm -rf "$tmpdir"
}

ensure_env_file() {
  if [[ ! -f "$APP_DIR/.env.example" ]]; then
    echo "Expected .env.example under $APP_DIR before generating $ENV_FILE" >&2
    exit 1
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$APP_DIR/.env.example" "$ENV_FILE"
  fi
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
}

sync_model_config() {
  if [[ ! -f "$MODEL_CONFIG_FILE" ]]; then
    if [[ "$MODEL_CONFIG_EXPLICIT" -eq 1 ]]; then
      echo "OpenPeach model config file not found: $MODEL_CONFIG_FILE" >&2
      exit 1
    fi
    return
  fi

  echo "Syncing runtime model config from $MODEL_CONFIG_FILE"
  "$NODE_BIN" "$REPO_ROOT/scripts/sync-openpeach-env-from-profile.mjs" \
    --config "$MODEL_CONFIG_FILE" \
    --env-file "$ENV_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
}

install_dependencies() {
  local node_gyp_python_env=""

  if [[ -n "$NODE_GYP_PYTHON" ]]; then
    node_gyp_python_env=" NODE_GYP_FORCE_PYTHON=\"$NODE_GYP_PYTHON\" PYTHON=\"$NODE_GYP_PYTHON\""
  fi

  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  su -s /bin/bash -c "cd \"$APP_DIR\" && env PATH=\"$NODE_CURRENT_DIR/bin:$PATH\"$node_gyp_python_env \"$NPM_BIN\" install" "$SERVICE_USER"
}

render_gateway_service() {
  OPENPEACH_APP_DIR="$APP_DIR" \
  OPENPEACH_ENV_FILE="$ENV_FILE" \
  OPENPEACH_SERVICE_NAME="$SERVICE_NAME" \
  OPENPEACH_SERVICE_USER="$SERVICE_USER" \
  OPENPEACH_REQUIRE_MIHOMO="$WITH_MIHOMO" \
    "$NODE_BIN" "$REPO_ROOT/scripts/render-openpeach-install-artifacts.mjs" service \
    > "$SYSTEMD_DIR/${SERVICE_NAME}.service"
}

install_mihomo() {
  if [[ "$WITH_MIHOMO" -ne 1 ]]; then
    return
  fi

  if [[ "$PROXY_PROFILE" != "vmess" ]]; then
    echo "--with-mihomo currently requires --proxy-profile vmess" >&2
    exit 1
  fi

  if [[ -n "$PROXY_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$PROXY_ENV_FILE"
  fi

  : "${OPENPEACH_VMESS_NAME:?Missing OPENPEACH_VMESS_NAME}"
  : "${OPENPEACH_VMESS_SERVER:?Missing OPENPEACH_VMESS_SERVER}"
  : "${OPENPEACH_VMESS_PORT:?Missing OPENPEACH_VMESS_PORT}"
  : "${OPENPEACH_VMESS_UUID:?Missing OPENPEACH_VMESS_UUID}"
  : "${OPENPEACH_VMESS_WS_PATH:?Missing OPENPEACH_VMESS_WS_PATH}"

  echo "Installing mihomo $MIHOMO_VERSION"
  local tmpdir
  tmpdir="$(mktemp -d)"

  curl -L --fail --show-error -o "$tmpdir/mihomo.gz" "$MIHOMO_DOWNLOAD_URL"
  gzip -dc "$tmpdir/mihomo.gz" > "$MIHOMO_BIN"
  chmod 0755 "$MIHOMO_BIN"
  chown "$SERVICE_USER:$SERVICE_USER" "$MIHOMO_BIN"

  OPENPEACH_VMESS_NAME="$OPENPEACH_VMESS_NAME" \
  OPENPEACH_VMESS_SERVER="$OPENPEACH_VMESS_SERVER" \
  OPENPEACH_VMESS_PORT="$OPENPEACH_VMESS_PORT" \
  OPENPEACH_VMESS_UUID="$OPENPEACH_VMESS_UUID" \
  OPENPEACH_VMESS_ALTER_ID="${OPENPEACH_VMESS_ALTER_ID:-0}" \
  OPENPEACH_VMESS_CIPHER="${OPENPEACH_VMESS_CIPHER:-auto}" \
  OPENPEACH_VMESS_TLS="${OPENPEACH_VMESS_TLS:-true}" \
  OPENPEACH_VMESS_SERVER_NAME="${OPENPEACH_VMESS_SERVER_NAME:-$OPENPEACH_VMESS_SERVER}" \
  OPENPEACH_VMESS_WS_PATH="$OPENPEACH_VMESS_WS_PATH" \
  OPENPEACH_VMESS_WS_HOST="${OPENPEACH_VMESS_WS_HOST:-$OPENPEACH_VMESS_SERVER}" \
  OPENPEACH_VMESS_UDP="${OPENPEACH_VMESS_UDP:-true}" \
  OPENPEACH_VMESS_SKIP_CERT_VERIFY="${OPENPEACH_VMESS_SKIP_CERT_VERIFY:-true}" \
  OPENPEACH_MIHOMO_HTTP_PORT="$MIHOMO_HTTP_PORT" \
  OPENPEACH_MIHOMO_SOCKS_PORT="$MIHOMO_SOCKS_PORT" \
    "$NODE_BIN" "$REPO_ROOT/scripts/render-openpeach-install-artifacts.mjs" mihomo-vmess \
    > "$MIHOMO_DIR/config.yaml"

  OPENPEACH_APP_DIR="$APP_DIR" \
  OPENPEACH_SERVICE_NAME="$SERVICE_NAME" \
  OPENPEACH_SERVICE_USER="$SERVICE_USER" \
    "$NODE_BIN" "$REPO_ROOT/scripts/render-openpeach-install-artifacts.mjs" mihomo-service \
    > "$SYSTEMD_DIR/${MIHOMO_SERVICE_NAME}.service"

  "$NODE_BIN" "$REPO_ROOT/scripts/render-openpeach-install-artifacts.mjs" \
    env-upsert "$ENV_FILE" \
    "HTTP_PROXY=http://127.0.0.1:${MIHOMO_HTTP_PORT}" \
    "HTTPS_PROXY=http://127.0.0.1:${MIHOMO_HTTP_PORT}" \
    "NO_PROXY=localhost,127.0.0.1,::1"

  chown "$SERVICE_USER:$SERVICE_USER" "$MIHOMO_DIR/config.yaml"
  rm -rf "$tmpdir"
}

reload_and_start_services() {
  systemctl daemon-reload

  if [[ "$WITH_MIHOMO" -eq 1 ]]; then
    systemctl enable --now "${MIHOMO_SERVICE_NAME}.service"
  fi

  systemctl enable --now "${SERVICE_NAME}.service"
}

print_summary() {
  cat <<EOF
OpenPeach install complete.

App directory: $APP_DIR
Env file: $ENV_FILE
OpenPeach home: $OPENPEACH_HOME_DIR
Runtime family: $RUNTIME_FAMILY_ID
Service: ${SERVICE_NAME}.service
Node: $NODE_BIN
EOF

  if [[ "$WITH_MIHOMO" -eq 1 ]]; then
    cat <<EOF
Mihomo: ${MIHOMO_SERVICE_NAME}.service
Mihomo config: $MIHOMO_DIR/config.yaml
EOF
  fi
}

ensure_service_user
prepare_directories
install_node
ensure_env_file
initialize_runtime_workspace
sync_model_config
install_dependencies
install_mihomo
render_gateway_service
reload_and_start_services
print_summary
