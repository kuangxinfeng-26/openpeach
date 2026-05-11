# OpenPeach Agent Profiles

This directory contains template profiles for OpenPeach's long-lived core agents.

These are repository templates, not the live runtime workspace.

The OpenClaw-style runtime workspace should live on the Linux host under:

```text
~/.openpeach/families/main/
```

During installation or first boot, OpenPeach should copy these templates into the runtime workspace if the target files do not exist. After that, the runtime files become user-owned local configuration.

Current status: the gateway initializes the runtime workspace on startup and loads `agents/main/agent.md` as the active `main` agent system profile. `home` and `lab` now have narrow runtime paths in code, while these files remain repository templates for live runtime copies.

## Layout

- `main/agent.md`: companionship, conversation, and user-facing orchestration.
- `home/agent.md`: home devices, safety-gated automation, camera events, and household state.
- `lab/agent.md`: project work, skill evolution, source-code analysis, and experiments.

## Rules

- Keep each profile small enough to be read before a turn.
- Put stable identity and boundaries here, not volatile session memory.
- Do not store secrets, tokens, API keys, or private device credentials in these files.
- If a rule affects all agents, put it in the root `AGENTS.md` instead.
