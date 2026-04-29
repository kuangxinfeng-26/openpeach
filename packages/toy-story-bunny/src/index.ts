import { z } from "zod";
import type {
  DeviceAdapter,
  DeviceCommand,
  DeviceCommandResult,
  DeviceDescription,
  DeviceState,
} from "../../device-adapter/src/index.js";

export const StoryBunnySceneIdSchema = z.enum([
  "wake_up",
  "play",
  "meal",
  "bath",
  "bedtime",
]);

export const StoryBunnyLanguagePreferenceSchema = z.enum([
  "zh",
  "en",
  "balanced",
]);

export const StoryBunnyBridgeRequestSchema = z.object({
  scene_id: StoryBunnySceneIdSchema,
  trigger_type: z.string().min(1),
  language_preference: StoryBunnyLanguagePreferenceSchema.default("balanced"),
  candidate_text: z.string().nullable().default(null),
});

export const StoryBunnyBridgeResponseSchema = z.object({
  child_text: z.string().min(1),
  language: z.string().min(1),
  redirect_target: z.string().nullable().optional(),
});

export type StoryBunnySceneId = z.infer<typeof StoryBunnySceneIdSchema>;
export type StoryBunnyLanguagePreference = z.infer<
  typeof StoryBunnyLanguagePreferenceSchema
>;
export type StoryBunnyBridgeRequest = z.infer<
  typeof StoryBunnyBridgeRequestSchema
>;
export type StoryBunnyBridgeResponse = z.infer<
  typeof StoryBunnyBridgeResponseSchema
>;

export type StoryBunnyBridge = {
  kind: string;
  respond(request: StoryBunnyBridgeRequest): Promise<StoryBunnyBridgeResponse>;
};

export type MockStoryBunnyBridgeOptions = {
  blockedTerms?: string[];
  beforeRespond?(request: StoryBunnyBridgeRequest): Promise<void> | void;
};

export function createMockStoryBunnyBridge(
  options: MockStoryBunnyBridgeOptions = {},
): StoryBunnyBridge {
  const blockedTerms = new Set(
    (options.blockedTerms ?? ["violence", "scary", "medical"]).map((term) =>
      term.toLowerCase(),
    ),
  );

  return {
    kind: "mock",
    async respond(request) {
      const parsed = StoryBunnyBridgeRequestSchema.parse(request);
      await options.beforeRespond?.(parsed);

      const candidateText = parsed.candidate_text?.trim();
      if (candidateText) {
        const lowered = candidateText.toLowerCase();
        if ([...blockedTerms].some((term) => lowered.includes(term))) {
          return safeFallback();
        }

        return {
          child_text: candidateText.split(/\s+/).slice(0, 6).join(" "),
          language: "en",
        };
      }

      return offlineSceneReply(parsed.scene_id);
    },
  };
}

export type StoryBunnyToyAdapterOptions = {
  bridge?: StoryBunnyBridge;
  deviceId?: string;
  displayName?: string;
  languagePreference?: StoryBunnyLanguagePreference;
  triggerType?: string;
};

export function createStoryBunnyToyAdapter(
  options: StoryBunnyToyAdapterOptions = {},
): DeviceAdapter {
  const bridge = options.bridge ?? createMockStoryBunnyBridge();
  const deviceId = options.deviceId ?? "toy:story-bunny";
  const displayName = options.displayName ?? "AI Story Bunny";
  const languagePreference = options.languagePreference ?? "balanced";
  const triggerType = options.triggerType ?? "openpeach_parent_trigger";
  const description: DeviceDescription = {
    deviceId,
    displayName,
    capabilities: [
      { action: "read_state", risk: "read" },
      { action: "trigger_play_scene", risk: "low_risk_control" },
      { action: "trigger_bedtime_scene", risk: "low_risk_control" },
    ],
  };
  let state: DeviceState["state"] = {
    bridge: bridge.kind,
    childSafeRuntime: true,
    lastScene: "none",
  };
  const commandResults = new Map<string, DeviceCommandResult>();

  return {
    async describe(requestedDeviceId) {
      assertStoryBunnyDevice(requestedDeviceId, deviceId);
      return description;
    },

    async readState(requestedDeviceId) {
      assertStoryBunnyDevice(requestedDeviceId, deviceId);
      return {
        deviceId,
        online: true,
        state: { ...state },
      };
    },

    async executeCommand(command) {
      assertStoryBunnyDevice(command.deviceId, deviceId);

      const existing = commandResults.get(command.commandId);
      if (existing) {
        return existing;
      }

      const sceneId = actionToSceneId(command.action);
      const response = await bridge.respond({
        scene_id: sceneId,
        trigger_type: triggerType,
        language_preference: languagePreference,
        candidate_text: null,
      });
      state = {
        bridge: bridge.kind,
        childSafeRuntime: true,
        lastScene: sceneId,
        lastTriggerType: triggerType,
        lastChildText: response.child_text,
        lastLanguage: response.language,
        lastRedirectTarget: response.redirect_target ?? "none",
      };

      const result: DeviceCommandResult = {
        ...command,
        acknowledged: true,
        state: { ...state },
      };
      commandResults.set(command.commandId, result);
      return result;
    },
  };
}

function safeFallback(): StoryBunnyBridgeResponse {
  return {
    child_text: "Let's sing together.",
    language: "en",
    redirect_target: "song",
  };
}

function offlineSceneReply(sceneId: StoryBunnySceneId): StoryBunnyBridgeResponse {
  if (sceneId === "bedtime") {
    return {
      child_text: "Time for a gentle bedtime rhyme.",
      language: "en",
      redirect_target: "rhyme",
    };
  }

  return {
    child_text: "Let's play a rhyme.",
    language: "en",
    redirect_target: "rhyme",
  };
}

function actionToSceneId(action: DeviceCommand["action"]): StoryBunnySceneId {
  if (action === "trigger_play_scene") {
    return "play";
  }
  if (action === "trigger_bedtime_scene") {
    return "bedtime";
  }

  throw new Error(`unsupported Story Bunny action: ${action}`);
}

function assertStoryBunnyDevice(requestedDeviceId: string, deviceId: string): void {
  if (requestedDeviceId !== deviceId) {
    throw new Error(`device not found: ${requestedDeviceId}`);
  }
}
