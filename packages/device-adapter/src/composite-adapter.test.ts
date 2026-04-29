import { describe, expect, it } from "vitest";
import { createMockStoryBunnyBridge, createStoryBunnyToyAdapter } from "../../toy-story-bunny/src/index.js";
import { createCompositeDeviceAdapter, createMockDeviceAdapter } from "./index.js";

describe("composite device adapter", () => {
  it("delegates built-in home devices and optional toy devices through one adapter", async () => {
    const adapter = createCompositeDeviceAdapter([
      createMockDeviceAdapter(),
      createStoryBunnyToyAdapter({
        bridge: createMockStoryBunnyBridge(),
      }),
    ]);

    await expect(adapter.readState("mock:living-room-lamp")).resolves.toMatchObject({
      deviceId: "mock:living-room-lamp",
      state: { power: "off" },
    });
    await expect(adapter.readState("toy:story-bunny")).resolves.toMatchObject({
      deviceId: "toy:story-bunny",
      state: {
        childSafeRuntime: true,
      },
    });
  });

  it("keeps unsupported actions on a known device visible instead of falling through", async () => {
    const adapter = createCompositeDeviceAdapter([
      createMockDeviceAdapter(),
      createStoryBunnyToyAdapter(),
    ]);

    await expect(
      adapter.executeCommand({
        commandId: "bad-lamp-command",
        deviceId: "mock:living-room-lamp",
        action: "trigger_play_scene",
      }),
    ).rejects.toThrow("unsupported device action");
  });
});
