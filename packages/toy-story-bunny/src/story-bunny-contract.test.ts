import { describe, expect, it } from "vitest";
import {
  StoryBunnyBridgeRequestSchema,
  StoryBunnyBridgeResponseSchema,
  createMockStoryBunnyBridge,
} from "./index.js";

describe("Story Bunny bridge contract", () => {
  it("accepts the current firmware bridge request and response shape", () => {
    expect(
      StoryBunnyBridgeRequestSchema.parse({
        scene_id: "play",
        trigger_type: "touch_head",
        language_preference: "balanced",
        candidate_text: null,
      }),
    ).toEqual({
      scene_id: "play",
      trigger_type: "touch_head",
      language_preference: "balanced",
      candidate_text: null,
    });

    expect(
      StoryBunnyBridgeResponseSchema.parse({
        child_text: "Let's sing together.",
        language: "en",
        redirect_target: "song",
      }),
    ).toEqual({
      child_text: "Let's sing together.",
      language: "en",
      redirect_target: "song",
    });
  });

  it("keeps candidate text behind the child safety fallback", async () => {
    const bridge = createMockStoryBunnyBridge({
      blockedTerms: ["scary"],
    });

    await expect(
      bridge.respond({
        scene_id: "play",
        trigger_type: "parent_preview",
        language_preference: "balanced",
        candidate_text: "This is a scary story.",
      }),
    ).resolves.toEqual({
      child_text: "Let's sing together.",
      language: "en",
      redirect_target: "song",
    });
  });

  it("returns scene-guided offline replies when no candidate text is supplied", async () => {
    const bridge = createMockStoryBunnyBridge();

    await expect(
      bridge.respond({
        scene_id: "bedtime",
        trigger_type: "openpeach_parent_trigger",
        language_preference: "balanced",
        candidate_text: null,
      }),
    ).resolves.toEqual({
      child_text: "Time for a gentle bedtime rhyme.",
      language: "en",
      redirect_target: "rhyme",
    });
  });
});
