# OpenPeach Open-Source Readiness

OpenPeach is being prepared as a public GitHub project. This checklist keeps the repository portable, safe, and installable by someone who only has a clean Linux machine and a fresh clone.

## Release Principles

- A fresh clone should install through npm and the Linux installer without relying on Codex, WSL-only paths, or private local files.
- Repository templates may live under `.openpeach/`, but live runtime state belongs under `~/.openpeach/families/<family_id>/` or an installer-selected `OPENPEACH_HOME`.
- No real tokens, API keys, proxy nodes, private model endpoints, SQLite state, logs, or personal runtime profiles should enter Git.
- User-facing names should say OpenPeach. The `TAOQIBAO_*` env prefix is retained only as Phase 0 compatibility until a migration is implemented.

## Files That Must Stay Private

- `.env`
- `.env.*` except `.env.example`
- `.openpeach/model.runtime.local.toml`
- `deploy/mihomo/*.local.env`
- runtime `state.db`, `*.db-wal`, and `*.db-shm`
- logs, media artifacts, transcripts, and local device credentials

## Minimum Verification Before Publishing

Run these on Linux, not from a Windows `node_modules` tree:

```bash
npm install
npm run release:check
```

The repository includes an MIT License with copyright assigned to 2026 OpenPeach Contributors.

The repository includes a CONTRIBUTING guide and a GitHub Actions workflow that runs `npm ci` and `npm run release:check` on push and pull request events.

For a real clean-host install, also verify the Linux installer from a fresh clone or copied checkout. If the service uses a dedicated system user, install under a traversable path such as `/opt/openpeach`; if the app lives under `/home/<user>`, run the service as that same user or explicitly handle parent directory permissions. On distributions with old default Python versions, set `OPENPEACH_NODE_GYP_PYTHON` to Python 3.8+ so native npm modules can rebuild through `node-gyp`.

When credentials are available, also verify:

- Telegram Bot API `getMe` succeeds.
- Telegram `sendChatAction` succeeds so users see a typing/read-style status.
- The configured external model returns a short completion.
- `openpeach.service` can start under systemd.
- Optional mihomo sidecar starts and the gateway uses the local proxy when configured.

## Publish Blockers

- Run a clean-machine installer test on a new Linux host or container/VM.
- Confirm the repository contains no private `_sources` material unless those folders are intentionally excluded, relicensed, or replaced by links.
- Finish the public-facing rename audit from legacy Taoqibao identifiers to OpenPeach, except documented compatibility env vars.
