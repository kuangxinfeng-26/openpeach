# OpenPeach (Taoqibao)

OpenPeach, also called Taoqibao, is a lightweight family agent hub. It is designed for Linux, npm-based deployment, Telegram and future personal WeChat entry points, external NLP models, optional local ASR/TTS sidecars, and an OpenClaw-style runtime workspace that can grow into a long-lived family companion and automation center.

Before making agent-driven changes in this repository, read [AGENTS.md](./AGENTS.md) for the project working rules, runtime assumptions, and safety boundaries.

## Current Status

Phase 0 is complete and Phase 2 has started with a narrow home-device MVP. The verified runtime path currently includes:

- Telegram gateway with Bot API polling and typing/read-style chat actions.
- `main` agent runtime loaded from an OpenPeach workspace `agent.md` profile.
- `home` agent routing for mock household device work while preserving a separate home session.
- Mock `DeviceAdapter` support for a living-room lamp and high-risk camera confirmation flow.
- SQLite-backed sessions, messages, task records, events, device events, and outbox state.
- External OpenAI-compatible model configuration through `.env` or a private model profile.
- Linux installer with Node.js, systemd service rendering, runtime workspace initialization, and optional mihomo sidecar support.

Planned next phases add personal WeChat, real Home Assistant/camera/toy adapters, `lab` skill evolution, multi-user household permissions, camera event summaries, AI toy integration, and richer memory/search flows.

## Quick Start for Development

```bash
git clone <repo-url> openpeach
cd openpeach
npm install
cp .env.example .env
npm run doctor
npm run phase0:check
npm run dev
```

Fill the real values in `.env` before starting the gateway:

- `TELEGRAM_BOT_TOKEN`
- `TAOQIBAO_OWNER_TELEGRAM_USER_IDS`
- `TAOQIBAO_MODEL_BASE_URL`
- `TAOQIBAO_MODEL_API_KEY`
- `TAOQIBAO_MODEL_NAME`

The `TAOQIBAO_*` environment prefix is currently kept for compatibility with the Phase 0 code and installer. New user-facing docs and package names use OpenPeach.

## Linux Installation

The open-source target is a normal Linux machine that can deploy from a clone:

```bash
git clone <repo-url> openpeach
cd openpeach
cp .env.example .env
sudo bash deploy/linux/install-openpeach.sh
```

The installer creates a service user, installs a project-local Node.js runtime, runs `npm install`, initializes the OpenPeach runtime workspace, renders systemd units, and starts `openpeach.service`.

For restricted networks, the installer can also render and start a mihomo sidecar from a private vmess env file:

```bash
cp deploy/mihomo/vmess.env.example deploy/mihomo/vmess.local.env
sudo bash deploy/linux/install-openpeach.sh \
  --with-mihomo \
  --proxy-profile vmess \
  --proxy-env-file deploy/mihomo/vmess.local.env
```

Never commit `deploy/mihomo/*.local.env`, `.env`, or real model profiles.

## Runtime Workspace

OpenPeach keeps user-owned runtime state outside the Git checkout. By default:

```text
~/.openpeach/families/main/
```

That runtime workspace contains live `agent.md` files, user profiles, memory domains, task artifacts, outbox artifacts, logs, and `state.db`. Repository files under `.openpeach/agents/` and `.openpeach/users/` are templates only. Installers and first-boot initialization copy templates only when the target file does not already exist.

A typical runtime layout is:

```text
~/.openpeach/families/main/
  agents/main/agent.md
  agents/home/agent.md
  agents/lab/agent.md
  users/owner/user.md
  memory/
  tasks/
  outbox/
  logs/
  state.db
```

## Development Workflow

OpenPeach is developed for Linux. If you use Windows, edit in any checkout you like, but run install, tests, doctor checks, gateway startup, and service validation from a Linux environment such as WSL or a real Linux host. Avoid sharing `node_modules` between Windows and Linux because native packages are platform-specific.

Useful commands:

- `npm run check` runs TypeScript build checks.
- `npm test` runs the Vitest test suite.
- `npm run doctor` validates env, SQLite, runtime workspace, FTS5, Telegram token presence, and model config.
- `npm run model:sync` syncs `.openpeach/model.runtime.local.toml` into `.env` when you keep local model settings in a private file.
- `npm run phase0:check` runs `check`, `test`, and `doctor` as a readiness pass.
- `npm run release:check` runs release hygiene checks, `npm audit`, `check`, `test`, `build`, and `doctor`.
- `npm run dev` starts the Phase 0 gateway from TypeScript source.
- `npm run install:linux` runs the Linux installer from the current checkout.

Phase 2 home-device details live in [docs/phase2-home-device-mvp.md](./docs/phase2-home-device-mvp.md).

## Security

Do not commit real tokens, API keys, private proxy nodes, private device credentials, SQLite state files, logs, media, or runtime-local agent/user profiles. OpenPeach should be safe for a public GitHub repository and portable to a clean Linux host.

## License

OpenPeach is released under the [MIT License](./LICENSE).

For Linux setup and service installation details, use [docs/phase0-runbook.md](./docs/phase0-runbook.md). For public-release hygiene, use [docs/open-source-readiness.md](./docs/open-source-readiness.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
