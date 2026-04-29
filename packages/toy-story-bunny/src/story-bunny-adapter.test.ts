import { describe, expect, it } from "vitest";
import {
  createMockStoryBunnyBridge,
  createStoryBunnyToyAdapter,
} from "./index.js";

describe("Story Bunny toy adapter", () => {
  it("describes the toy as an optional child-safe device", async () => {
    const adapter = createStoryBunnyToyAdapter({
      bridge: createMockStoryBunnyBridge(),
    });

    await expect(adapter.describe("toy:story-bunny")).resolves.toEqual({
      deviceId: "toy:story-bunny",
      displayName: "AI Story Bunny",
      capabilities: [
        { action: "read_state", risk: "read" },
        { action: "trigger_play_scene", risk: "low_risk_control" },
        { action: "trigger_bedtime_scene", risk: "low_risk_control" },
      ],
    });
  });

  it("reads bridge-backed toy state without requiring hardware", async () => {
    const adapter = createStoryBunnyToyAdapter({
      bridge: createMockStoryBunnyBridge(),
    });

    await expect(adapter.readState("toy:story-bunny")).resolves.toEqual({
      deviceId: "toy:story-bunny",
      online: true,
      state: {
        bridge: "mock",
        childSafeRuntime: true,
        lastScene: "none",
      },
    });
  });

  it("triggers a bedtime scene through the bridge and stores the child-safe reply", async () => {
    const adapter = createStoryBunnyToyAdapter({
      bridge: createMockStoryBunnyBridge(),
    });

    await expect(
      adapter.executeCommand({
        commandId: "toy-command-1",
        deviceId: "toy:story-bunny",
        action: "trigger_bedtime_scene",
      }),
    ).resolves.toMatchObject({
      commandId: "toy-command-1",
      deviceId: "toy:story-bunny",
      action: "trigger_bedtime_scene",
      acknowledged: true,
      state: {
        bridge: "mock",
        childSafeRuntime: true,
        lastScene: "bedtime",
        lastTriggerType: "openpeach_parent_trigger",
        lastChildText: "Time for a gentle bedtime rhyme.",
        lastLanguage: "en",
        lastRedirectTarget: "rhyme",
      },
    });
  });

  it("replays commands idempotently without calling the bridge twice", async () => {
    let bridgeCalls = 0;
    const bridge = createMockStoryBunnyBridge({
      async beforeRespond() {
        bridgeCalls += 1;
      },
    });
    const adapter = createStoryBunnyToyAdapter({ bridge });
    const command = {
      commandId: "toy-command-replay",
      deviceId: "toy:story-bunny",
      action: "trigger_play_scene",
    };

    const first = await adapter.executeCommand(command);
    const replay = await adapter.executeCommand(command);

    expect(replay).toEqual(first);
    expect(bridgeCalls).toBe(1);
  });
});
