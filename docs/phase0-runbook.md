# OpenPeach Phase 0 Runbook

This runbook covers local bring-up and a basic Linux `systemd` deployment for the OpenPeach Phase 0 gateway.

## Prerequisites

- Linux host with Node.js 22+ and npm 10+
- A Telegram bot token
- Model API endpoint, API key, and model name

## Local Bring-Up

Clone the repository onto a Linux host or into a Linux-native WSL filesystem, install dependencies, copy the example environment file, and run the built-in checks before starting the gateway:

```bash
git clone <repo-url> openpeach
cd openpeach
npm install
cp .env.example .env
```

If you keep the real model endpoint and credentials in `.openpeach/model.runtime.local.toml`, sync them into `.env` before the first `doctor` run:

```bash
npm run model:sync
```

Update `.env` with your real deployment values, then verify the setup:

```bash
npm run doctor
npm run phase0:check
```

If the Linux host cannot reach `api.telegram.org` directly from Node.js, add
standard proxy variables to `.env` before starting the gateway. The Telegram
adapter honors `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` when
`TAOQIBAO_TELEGRAM_API_ROOT` is empty. If you intentionally route Telegram
through a local relay, keep `TAOQIBAO_TELEGRAM_API_ROOT` set and leave the
proxy vars blank for that path.

At runtime, OpenPeach loads `.env` with override enabled. This is intentional:
the deployment `.env` is the source of truth, and it prevents inherited host
proxy variables from bypassing a configured local mihomo sidecar.

The default `.env.example` uses `OPENPEACH_HOME="$HOME/.openpeach"` and leaves `TAOQIBAO_STATE_DB` empty. When `TAOQIBAO_STATE_DB` is empty, OpenPeach stores the runtime database under `$OPENPEACH_HOME/families/$TAOQIBAO_FAMILY_ID/state.db`. This keeps the SQLite state beside the OpenClaw-style runtime workspace that contains `agents/*/agent.md`, `users/*/user.md`, memory domains, task artifacts, outbox artifacts, and logs.

Start the Phase 0 gateway in the foreground:

```bash
npm run dev
```

## systemd Installation

The recommended path is to run the bundled installer from the checked-out repo. It installs a user-local Node 24 runtime under the app directory, initializes the OpenPeach runtime workspace, syncs the runtime model settings from `.openpeach/model.runtime.local.toml` when that file exists, installs npm dependencies, renders a `systemd` unit, and optionally installs a `mihomo` sidecar with a parameterized `vmess` config:

```bash
sudo bash deploy/linux/install-openpeach.sh
```

For an open-source style deployment with a dedicated service user, prefer a traversable system path such as `/opt/openpeach`:

```bash
sudo mkdir -p /opt/openpeach
sudo chown "$USER:$USER" /opt/openpeach
git clone <repo-url> /opt/openpeach
cd /opt/openpeach
cp .env.example .env
sudo bash deploy/linux/install-openpeach.sh \
  --app-dir /opt/openpeach \
  --env-file /opt/openpeach/.env \
  --service-user openpeach
```

If you intentionally deploy inside your own home directory, run the service as the same user or make sure the service user can traverse every parent directory. A system user such as `openpeach` cannot normally access `/home/<other-user>/openpeach` because home directories are often not world-traversable.

Some clean Linux distributions ship an old default Python. Native npm dependencies such as `better-sqlite3` may need to rebuild when Node prebuilt binaries are unavailable, and `node-gyp` requires a modern Python. Install Python 3.8+ and pass it to the installer when needed:

```bash
sudo dnf install -y python3.11
sudo OPENPEACH_NODE_GYP_PYTHON=/usr/bin/python3.11 \
  bash deploy/linux/install-openpeach.sh
```

To enable `mihomo` with a `vmess` profile, copy [`deploy/mihomo/vmess.env.example`](../deploy/mihomo/vmess.env.example) to a private file such as `deploy/mihomo/vmess.local.env`, fill in the real node values, and point the installer at it:

```bash
cp deploy/mihomo/vmess.env.example deploy/mihomo/vmess.local.env
sudo bash deploy/linux/install-openpeach.sh \
  --with-mihomo \
  --proxy-profile vmess \
  --proxy-env-file deploy/mihomo/vmess.local.env
```

If you keep the model profile somewhere else, point the installer at it explicitly:

```bash
sudo bash deploy/linux/install-openpeach.sh \
  --model-config /opt/openpeach/.openpeach/model.runtime.local.toml
```

The installer writes:

- `openpeach.service` to `/etc/systemd/system`
- `openpeach-mihomo.service` when `--with-mihomo` is enabled
- `config.yaml` to `<app-dir>/.config/mihomo/config.yaml`
- runtime workspace files to `<app-dir>/.openpeach/families/main`, without overwriting existing local `agent.md` or `user.md` files
- `OPENPEACH_HOME` and `TAOQIBAO_STATE_DB` into the runtime `.env`
- standard Telegram proxy env vars into the runtime `.env` when the `mihomo` sidecar is enabled

Follow the service logs during startup or troubleshooting:

```bash
sudo journalctl -u openpeach -f
sudo journalctl -u openpeach-mihomo -f
```

## Operational Checks

- `npm run doctor` validates the required environment, writable SQLite path, runtime workspace initialization, FTS5 migration support, Telegram token presence, and model configuration.
- `npm run model:sync` syncs `.openpeach/model.runtime.local.toml` into the runtime `.env`.
- `npm run phase0:check` runs `npm run check`, `npm test`, and `npm run doctor` as a combined readiness check.
- `npm run dev` starts the Telegram gateway directly from TypeScript sources for Phase 0.
