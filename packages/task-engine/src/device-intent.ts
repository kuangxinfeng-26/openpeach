export type DeviceIntent = {
  deviceId: string;
  matchedAlias: string;
  action?: string;
};

export type DeviceAliasEntry = {
  deviceId: string;
  aliases: string[];
};

const DEVICE_ALIASES: DeviceAliasEntry[] = [
  {
    deviceId: "mock:living-room-lamp",
    aliases: [
      "living room lamp",
      "living room light",
      "客厅灯",
      "客厅的灯",
      "大厅灯",
    ],
  },
  {
    deviceId: "mock:front-camera",
    aliases: [
      "front camera",
      "camera",
      "recording",
      "摄像头",
      "前门摄像头",
      "监控",
    ],
  },
  {
    deviceId: "toy:story-bunny",
    aliases: [
      "story bunny",
      "ai story bunny",
      "淘气兔",
      "故事兔",
      "玩具",
      "故事机",
    ],
  },
];

const ACTION_PATTERNS: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /\b(turn on|switch on|enable)\b/i, action: "turn_on" },
  { pattern: /\b(turn off|switch off|disable)\b/i, action: "turn_off" },
  { pattern: /\b(close)\b/i, action: "turn_off" },
  { pattern: /(打开|开启|启动|开一下)/, action: "turn_on" },
  { pattern: /(关闭|关掉|关上|关一下|熄灭)/, action: "turn_off" },
  { pattern: /\b(status|state|check)\b/i, action: "read_state" },
  { pattern: /(状态|什么情况|开着|关着|亮着)/, action: "read_state" },
  { pattern: /(录像|录制|拍摄)/, action: "start_recording" },
  { pattern: /\b(record(ing)?)\b/i, action: "start_recording" },
  { pattern: /(播放|讲故事|睡前)/, action: "trigger_play_scene" },
  { pattern: /\b(play|bedtime)\b/i, action: "trigger_play_scene" },
  { pattern: /\b(start)\b/i, action: "turn_on" },
  { pattern: /\b(stop)\b/i, action: "turn_off" },
  { pattern: /\b(open)\b/i, action: "turn_on" },
];

export function parseDeviceIntent(text: string): DeviceIntent | undefined {
  const normalized = text.toLowerCase();

  for (const device of DEVICE_ALIASES) {
    const matchedAlias = device.aliases.find((alias) =>
      normalized.includes(alias.toLowerCase()),
    );
    if (matchedAlias) {
      const action = detectAction(text);
      return {
        deviceId: device.deviceId,
        matchedAlias,
        ...(action ? { action } : {}),
      };
    }
  }

  return undefined;
}

function detectAction(text: string): string | undefined {
  for (const { pattern, action } of ACTION_PATTERNS) {
    if (pattern.test(text)) {
      return action;
    }
  }
  return undefined;
}

export { DEVICE_ALIASES, ACTION_PATTERNS };
