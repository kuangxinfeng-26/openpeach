# OpenPeach Phase 2 Home Device MVP

Phase 2 starts the `home` agent path without connecting real household hardware yet. The goal is to prove the device boundary, safety gate, task routing, and audit trail before adding Home Assistant, cameras, or the AI toy bridge.

## Implemented Slice

- `@openpeach/device-adapter` defines the device adapter boundary.
- `createMockDeviceAdapter()` exposes a mock living-room lamp and a mock front camera.
- `admitTask()` routes obvious living-room lamp and camera requests to `targetAgent: "home"` with `priority: "P1"` and a device resource lock.
- `handleHumanEnvelope()` keeps Telegram as one user-facing entrance but dispatches home-device tasks to a `home` session and `HomeAgentRuntime`.
- `HomeAgentRuntime` can read mock lamp state, execute owner low-risk lamp commands, and park high-risk camera recording in `awaiting_confirmation`.
- Explicit confirmation messages such as `confirm task:<task_id>` resume parked high-risk owner tasks and keep the original task audit trail.
- SQLite now has `device_events` for auditable device reads and command acknowledgements.
- `@openpeach/toy-story-bunny` now exists as an optional package for the AI Story Bunny bridge contract and mock toy adapter. It is not enabled in the default gateway runtime yet.
- `OPENPEACH_ENABLE_STORY_BUNNY=true` enables a composite home device adapter that includes `toy:story-bunny`.
- `createHomeAssistantDeviceAdapter()` provides a tested Home Assistant boundary for explicitly configured entities. It does not auto-discover devices and blocks dangerous service domains such as `shell_command` and `rest_command`.

## Safety Rules

- Owner `read` and `low_risk_control` actions are allowed in this MVP.
- Non-owner device control is denied by policy.
- `high_risk_control` actions do not execute immediately. They move the task to `awaiting_confirmation` and queue a reply explaining that confirmation is required.
- A high-risk action can only be resumed by an allowlisted owner using the explicit confirmation command included in the queued reply.
- Camera support remains mock-only and confirmation-gated. No raw camera stream ingestion is implemented.

## Mock Devices

```text
mock:living-room-lamp
  read_state -> read
  turn_on    -> low_risk_control
  turn_off   -> low_risk_control

mock:front-camera
  read_state       -> read
  start_recording  -> high_risk_control

toy:story-bunny (optional package only)
  read_state             -> read
  trigger_play_scene     -> low_risk_control
  trigger_bedtime_scene  -> low_risk_control
```

## Verification

Targeted checks for this slice:

```bash
npm test -- \
  packages/device-adapter/src/device-adapter.test.ts \
  packages/device-adapter/src/composite-adapter.test.ts \
  packages/device-adapter/src/home-assistant-adapter.test.ts \
  packages/toy-story-bunny/src/story-bunny-contract.test.ts \
  packages/toy-story-bunny/src/story-bunny-adapter.test.ts \
  packages/task-engine/src/task-engine.test.ts \
  packages/runtime/src/home-agent.test.ts \
  apps/gateway/src/pipeline.test.ts

npm run check
```

Full readiness still uses:

```bash
npm run release:check
```

## Remaining Work

- Add multi-user device permissions beyond owner-only control.
- Add idempotent device command outbox/retry handling for real adapters.
- Add real Home Assistant deployment configuration and manual probes against a private HA instance.
- Add real Story Bunny bridge validation after the toy hardware bridge is stable.
- Replace the current small intent aliases with a richer parser before adding many devices.
