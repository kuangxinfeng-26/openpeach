import { describe, expect, it } from "vitest";
import { createHomeDeviceAdapter } from "./home-devices.js";

describe("createHomeDeviceAdapter", () => {
  it("does not expose Story Bunny unless the optional toy flag is enabled", async () => {
    const adapter = createHomeDeviceAdapter({
      enableStoryBunnyToy: false,
    });

    await expect(adapter.readState("toy:story-bunny")).rejects.toThrow(
      "device not found",
    );
  });

  it("exposes Story Bunny through the home device adapter when enabled", async () => {
    const adapter = createHomeDeviceAdapter({
      enableStoryBunnyToy: true,
    });

    await expect(adapter.readState("toy:story-bunny")).resolves.toMatchObject({
      deviceId: "toy:story-bunny",
      state: {
        childSafeRuntime: true,
      },
    });
  });
});
