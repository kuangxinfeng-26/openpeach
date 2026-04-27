# Contributing to OpenPeach

OpenPeach is early-stage. Contributions should keep the project lightweight, Linux-friendly, and safe for family use.

## Development Setup

```bash
git clone <repo-url> openpeach
cd openpeach
npm install
cp .env.example .env
npm run phase0:check
```

Use Linux, WSL, or a Linux VM for runtime validation. Do not reuse a Windows `node_modules` directory for Linux tests.

## Change Guidelines

- Keep changes small and focused.
- Preserve the `main`, `home`, and `lab` agent boundaries.
- Keep session, memory, skill, and task concepts separate.
- Use typed task/event/state records instead of inferring runtime state from logs or chat text.
- Do not add new channels, device adapters, or sidecars without documenting configuration, safety boundaries, and tests.

## Security Guidelines

- Never commit real Telegram tokens, model API keys, proxy nodes, device credentials, `.env`, runtime DB files, or local model profiles.
- Prefer placeholders in examples.
- Treat camera, device control, and household memory as privacy-sensitive features.
- High-risk household actions must be policy-gated and auditable.

## Verification

Before opening a pull request, run:

```bash
npm run phase0:check
npm run build
```

If your change touches Telegram, model configuration, installer behavior, mihomo, or systemd units, also run the relevant real integration check on Linux and document what was verified.
