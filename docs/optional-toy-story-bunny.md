# Optional AI Story Bunny Package

OpenPeach includes a small optional package for AI Story Bunny, the first planned AI toy integration. This package is intentionally an adapter contract, not the toy firmware project itself.

## Why This Is Optional

AI Story Bunny is a child-facing educational toy. It should remain safer and narrower than the main OpenPeach agent hub:

- The toy is a screen-free, camera-free, audio-first companion.
- Offline playback and scene-guided routines must work without OpenPeach.
- OpenPeach may enhance the toy, but it must not bypass the toy safety runtime.
- Child-facing output must stay short, scene-bound, and safety-filtered.

For that reason, OpenPeach ships only a bridge package in this repository. Firmware, private hardware notes, flash backups, serial logs, and local Wi-Fi configuration stay outside the public OpenPeach repo.

## Current Hardware Status

The latest hardware bring-up in the separate AI toy workspace has verified the bare-board path:

- Board class: ESP32-S3 N16R8.
- Flash and PSRAM: 16 MB flash and 8 MB PSRAM.
- Serial bridge: CH343.
- PlatformIO builds firmware and LittleFS successfully with a custom N16R8 board profile.
- Firmware upload and LittleFS upload have been verified.
- Boot diagnostics print the Story Bunny bring-up banner, resource checks, offline Wi-Fi mode, and a bridge URL.

The following work is not yet verified in OpenPeach and must stay outside the default runtime:

- WS2812B LED ring.
- Physical buttons.
- Audio amplifier and speaker.
- Microphone path.
- Live OpenPeach-to-hardware bridge validation.

## Package Contents

`@openpeach/toy-story-bunny` currently provides:

- `StoryBunnyBridgeRequestSchema` and `StoryBunnyBridgeResponseSchema` for the firmware bridge contract.
- `createMockStoryBunnyBridge()` for tests and development without hardware.
- `createStoryBunnyToyAdapter()` as an optional `DeviceAdapter` for the `home` agent.

The package exposes one logical device by default:

```text
toy:story-bunny
  read_state             -> read
  trigger_play_scene     -> low_risk_control
  trigger_bedtime_scene  -> low_risk_control
```

## Bridge Contract

The current bridge request shape follows the AI toy firmware contract:

```json
{
  "scene_id": "play",
  "trigger_type": "touch_head",
  "language_preference": "balanced",
  "candidate_text": null
}
```

The response shape is:

```json
{
  "child_text": "Let's sing together.",
  "language": "en",
  "redirect_target": "song"
}
```

`candidate_text` is treated as untrusted child-facing material. The mock bridge applies a simple safety fallback so OpenPeach tests preserve the intended safety boundary before a real bridge is connected.

## Enabling Later

This package is not wired into `apps/gateway` by default. A later runtime switch should choose between:

- The default mock home adapter.
- A composite home adapter that includes Story Bunny.
- A real HTTP bridge adapter once the toy bridge is stable on Linux.

Before enabling the real toy path, verify:

```bash
npm test -- packages/toy-story-bunny/src/story-bunny-contract.test.ts packages/toy-story-bunny/src/story-bunny-adapter.test.ts
```

Then run the normal OpenPeach checks:

```bash
npm test
npm run check
```

## Safety Rules

- Do not send unrestricted model output directly to the toy.
- Do not store raw child audio by default.
- Do not add camera behavior to this toy package.
- Do not put private firmware backups or local hardware identifiers in the public repo.
- Keep all real hardware credentials in untracked runtime-local files.
