export type DeviceIntent = {
  deviceId: string;
  matchedAlias: string;
};

const DEVICE_ALIASES: Array<{ deviceId: string; aliases: string[] }> = [
  {
    deviceId: "mock:living-room-lamp",
    aliases: ["living room lamp", "living room light", "\u5ba2\u5385\u706f"],
  },
  {
    deviceId: "mock:front-camera",
    aliases: ["front camera", "camera", "recording", "\u6444\u50cf\u5934"],
  },
  {
    deviceId: "toy:story-bunny",
    aliases: [
      "story bunny",
      "ai story bunny",
      "\u6dd8\u6c14\u5154",
      "\u6545\u4e8b\u5154",
      "\u73a9\u5177",
    ],
  },
];

export function parseDeviceIntent(text: string): DeviceIntent | undefined {
  const normalized = text.toLowerCase();

  for (const device of DEVICE_ALIASES) {
    const matchedAlias = device.aliases.find((alias) =>
      normalized.includes(alias.toLowerCase()),
    );
    if (matchedAlias) {
      return {
        deviceId: device.deviceId,
        matchedAlias,
      };
    }
  }

  return undefined;
}
