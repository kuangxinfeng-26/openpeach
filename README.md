# Taoqibao Phase 0 MVP

This repository is the Linux-targeted Taoqibao Phase 0 MVP workspace. It uses npm workspaces for a small TypeScript monorepo, with Telegram ingress and the `main` agent planned for Phase 0.

Start with the design doc in [`docs/taoqibao-design-v2.md`](./docs/taoqibao-design-v2.md) and the implementation plan in [`docs/superpowers/plans/2026-04-23-taoqibao-phase0-mvp-plan.md`](./docs/superpowers/plans/2026-04-23-taoqibao-phase0-mvp-plan.md).

Bootstrap note: Task 1 only guarantees the workspace scaffold plus `npm run check` and `npm test`. The `dev`, `doctor`, `start`, and `phase0:check` scripts, along with the package `main` and `types` entries, are forward-looking and become meaningful in later tasks once source entrypoints exist.
