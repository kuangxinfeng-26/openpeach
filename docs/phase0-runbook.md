# Taoqibao Phase 0 Runbook

This runbook covers local bring-up and a basic Linux `systemd` deployment for the Taoqibao Phase 0 gateway.

## Prerequisites

- Linux host with Node.js 22+ and npm 10+
- A Telegram bot token
- Model API endpoint, API key, and model name

## Local Bring-Up

Clone the repository into `/opt/taoqibao`, install dependencies, copy the example environment file, and run the built-in checks before starting the gateway:

```bash
git clone <repo> /opt/taoqibao
cd /opt/taoqibao
npm install
cp .env.example .env
```

Update `.env` with your real deployment values, then verify the setup:

```bash
npm run doctor
npm run phase0:check
```

The default `.env.example` uses `$HOME/.taoqibao/state.db` for `TAOQIBAO_STATE_DB`. Taoqibao expands `$HOME` and `~` itself at runtime, so this works for both local bring-up and the documented `systemd` deployment. If you prefer a different location, replace it with another absolute path in `.env`.

Start the Phase 0 gateway in the foreground:

```bash
npm run dev
```

## systemd Installation

Create a dedicated service account, make sure the deployment directory is owned by that user, install the provided unit file, and enable the service:

```bash
sudo useradd --system --home /opt/taoqibao --shell /usr/sbin/nologin taoqibao
sudo chown -R taoqibao:taoqibao /opt/taoqibao
sudo cp deploy/systemd/taoqibao.service /etc/systemd/system/taoqibao.service
sudo systemctl daemon-reload
sudo systemctl enable --now taoqibao
```

Follow the service logs during startup or troubleshooting:

```bash
sudo journalctl -u taoqibao -f
```

## Operational Checks

- `npm run doctor` validates the required environment, writable SQLite path, FTS5 migration support, Telegram token presence, and model configuration.
- `npm run phase0:check` runs `npm run check`, `npm test`, and `npm run doctor` as a combined readiness check.
- `npm run dev` starts the Telegram gateway directly from TypeScript sources for Phase 0.
