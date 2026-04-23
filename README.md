# Taoqibao Phase 0 MVP

This repository is the Linux-targeted Taoqibao Phase 0 MVP workspace. It uses npm workspaces for a small TypeScript monorepo, and the current Phase 0 target is a Telegram gateway that loads the `main` family and core agent configuration from environment variables.

Start with the design doc in [`docs/taoqibao-design-v2.md`](./docs/taoqibao-design-v2.md) and the implementation plan in [`docs/superpowers/plans/2026-04-23-taoqibao-phase0-mvp-plan.md`](./docs/superpowers/plans/2026-04-23-taoqibao-phase0-mvp-plan.md).

## Current Phase 0 State

The repository currently includes the scripts needed to validate and run the gateway locally:

- `npm run check` runs the TypeScript project build checks.
- `npm test` runs the Phase 0 test suite with Vitest.
- `npm run doctor` validates the runtime environment, writable SQLite path, FTS5 migration support, Telegram bot token, and model configuration.
- `npm run phase0:check` runs `check`, `test`, and `doctor` as a single readiness pass.
- `npm run dev` starts the Phase 0 gateway from the TypeScript source entrypoint.

For Linux setup and service installation, use the runbook in [`docs/phase0-runbook.md`](./docs/phase0-runbook.md).
