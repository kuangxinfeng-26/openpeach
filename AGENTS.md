# OpenPeach Agent Guide

OpenPeach is the English project name for Taoqibao. It is a lightweight family agent hub, not a generic chatbot. Future agents working in this repository should preserve that direction: companionship first, family-safe automation second, and continuous learning through auditable memory, skills, and task execution.

This guide is inspired by the discipline of small, verifiable, well-scoped agent work. It adapts those ideas to OpenPeach's architecture and runtime constraints.

## Core Behavior

- Do not fabricate source analysis, test results, runtime status, or external facts. If something has not been inspected or verified, say so.
- Prefer simple, direct designs over clever abstractions. Add architecture only when it removes real future friction.
- Make surgical changes. Touch the smallest set of files that solves the current problem.
- Preserve user work. The repository may be dirty; never revert unrelated changes unless explicitly asked.
- Keep OpenPeach decoupled from Codex-specific runtime assumptions. Local Codex workflows may help development, but the product must be portable to normal Linux machines.

## Product Direction

- OpenPeach has three long-lived core agents: `main`, `home`, and `lab`.
- `main` owns companionship, conversation, and user-facing orchestration.
- `home` owns family devices, home state, camera events, and safety-gated automation.
- `lab` owns project work, skill evolution, GitHub idea absorption, and OpenPeach's self-improvement loop.
- Internal worker agents are temporary execution helpers. They should not become permanent user-facing personalities unless the product design explicitly changes.
- The first supported human channels are personal WeChat and Telegram. Treat other channels as future adapters, not Phase 0 scope.

## Architecture Rules

- Keep logical agent boundaries OpenClaw-like, but keep sessions, search, memory, and task state in a unified Hermes-like SQLite core.
- Keep session, memory, skill, and task records separate. A session records what happened; memory records stable facts; skills record reusable procedures; tasks record execution state.
- Use `TaskPacket`-style structured task descriptions for non-trivial work. Do not rely only on free-form prompts for durable execution.
- Separate task state from worker state. A task is what should be done; a worker is the current execution vehicle.
- Prefer typed events and SQLite-backed registries over scraping logs or chat text to infer state.

## Runtime Rules

- The target runtime is Linux. Local development may happen from any checkout, but runtime validation must happen on Linux.
- Run tests, builds, doctor checks, Telegram validation, model probes, and service validation from WSL or a real Linux host. Do not assume a project-specific local path.
- Use npm for deployment and development workflows unless the project explicitly changes package managers.
- The live OpenClaw-style agent workspace should live under `~/.openpeach/families/<family_id>/`, with files such as `agents/main/agent.md` and `users/owner/user.md`.
- Repository files under `.openpeach/agents/` and `.openpeach/users/` are templates only. Runtime copies are local user configuration and should not be overwritten blindly.
- Runtime services should be portable systemd services, not Codex-specific processes.
- If using mihomo as a sidecar, prefer a local HTTP proxy such as `http://127.0.0.1:7890` and verify real traffic with curl, service logs, and OpenPeach probes.

## Configuration Rules

- Do not commit real tokens, API keys, bot tokens, or private proxy credentials.
- Model configuration should be expressed through profile files or environment variables: `base_url`, `api_key`, and `model_name`.
- External NLP models are acceptable. Local ASR and TTS are optional future sidecars.
- Keep examples in `.env.example` and runtime-local secrets in untracked files.

## Testing Rules

- Before claiming completion, run the smallest relevant verification command and report the exact result.
- For Phase 0 readiness, prefer `npm run phase0:check`, `npm run build`, and `npm run doctor` from Linux.
- For Telegram changes, verify both adapter tests and a real Bot API probe when credentials are available.
- For proxy changes, verify both direct proxy reachability and application-level usage.
- For installer changes, verify help output, shell syntax, and a non-destructive Linux install path when a clean host is available.

## Safety Rules

- Multi-user support must isolate channel identity, person identity, household identity, memory visibility, and device permissions.
- Private person memory must not leak into family-shared memory without an explicit rule or confirmation.
- High-risk device actions require policy approval and, where appropriate, user confirmation.
- Camera integrations should start from event summaries and media pointers, not continuous raw video ingestion.
- Any external-service error output shown to users should avoid leaking tokens, URLs with secrets, or private headers.

## Documentation Rules

- If a decision is settled in conversation and affects future work, record it in project docs or this guide.
- Keep design docs honest about their source: clearly distinguish confirmed source-code findings from OpenPeach-specific design choices.
- Prefer concise Markdown with concrete rules, commands, and acceptance checks.
- When borrowing ideas from another repository, cite the idea and adapt it. Do not copy large text blocks blindly.

## Working Style

- Think before editing. State assumptions when they matter.
- Do not stop at a proposal when the user asked for implementation and the next step is safe.
- Do not overfit the current desktop environment. OpenPeach should remain installable on a clean Linux machine.
- Optimize for a family agent that can grow for years: clear boundaries, auditable memory, safe execution, and boring reliability.
