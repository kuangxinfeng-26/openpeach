export type DeviceActionRisk =
  | "read"
  | "low_risk_control"
  | "high_risk_control";

export type DeviceCapability = {
  action: string;
  risk: DeviceActionRisk;
};

export type DeviceDescription = {
  deviceId: string;
  displayName: string;
  capabilities: DeviceCapability[];
};

export type DeviceState = {
  deviceId: string;
  online: boolean;
  state: Record<string, string | number | boolean>;
};

export type DeviceCommand = {
  commandId: string;
  deviceId: string;
  action: string;
};

export type DeviceCommandResult = DeviceCommand & {
  acknowledged: true;
  state: Record<string, string | number | boolean>;
};

export type DeviceAdapter = {
  describe(deviceId: string): Promise<DeviceDescription>;
  readState(deviceId: string): Promise<DeviceState>;
  executeCommand(command: DeviceCommand): Promise<DeviceCommandResult>;
};

export type DevicePolicyDecision =
  | { decision: "allow" }
  | { decision: "requires_confirmation"; reason: string }
  | { decision: "deny"; reason: string };

export function evaluateDeviceActionPolicy(input: {
  requesterRole: string;
  risk: DeviceActionRisk;
}): DevicePolicyDecision {
  if (input.requesterRole !== "owner") {
    return {
      decision: "deny",
      reason: "Requester is not allowed to control family devices",
    };
  }

  if (input.risk === "high_risk_control") {
    return {
      decision: "requires_confirmation",
      reason: "High-risk device action requires explicit confirmation",
    };
  }

  return { decision: "allow" };
}

export function createMockDeviceAdapter(): DeviceAdapter {
  const devices = new Map<string, DeviceDescription>([
    [
      "mock:living-room-lamp",
      {
        deviceId: "mock:living-room-lamp",
        displayName: "Living Room Lamp",
        capabilities: [
          { action: "read_state", risk: "read" },
          { action: "turn_on", risk: "low_risk_control" },
          { action: "turn_off", risk: "low_risk_control" },
        ],
      },
    ],
    [
      "mock:front-camera",
      {
        deviceId: "mock:front-camera",
        displayName: "Front Camera",
        capabilities: [
          { action: "read_state", risk: "read" },
          { action: "start_recording", risk: "high_risk_control" },
        ],
      },
    ],
  ]);
  const states = new Map<string, Record<string, string | number | boolean>>([
    ["mock:living-room-lamp", { power: "off" }],
    ["mock:front-camera", { recording: false }],
  ]);
  const commandResults = new Map<string, DeviceCommandResult>();

  return {
    async describe(deviceId) {
      const device = devices.get(deviceId);
      if (!device) {
        throw new Error(`device not found: ${deviceId}`);
      }

      return device;
    },

    async readState(deviceId) {
      assertKnownDevice(devices, deviceId);

      return {
        deviceId,
        online: true,
        state: { ...states.get(deviceId) },
      };
    },

    async executeCommand(command) {
      assertKnownDevice(devices, command.deviceId);

      const existing = commandResults.get(command.commandId);
      if (existing) {
        return existing;
      }

      const device = devices.get(command.deviceId);
      const capability = device?.capabilities.find(
        (item) => item.action === command.action,
      );
      if (!capability) {
        throw new Error(`unsupported device action: ${command.action}`);
      }

      const nextState = applyMockAction({
        state: states.get(command.deviceId) ?? {},
        action: command.action,
      });
      states.set(command.deviceId, nextState);

      const result: DeviceCommandResult = {
        ...command,
        acknowledged: true,
        state: { ...nextState },
      };
      commandResults.set(command.commandId, result);
      return result;
    },
  };
}

function assertKnownDevice(
  devices: Map<string, DeviceDescription>,
  deviceId: string,
): void {
  if (!devices.has(deviceId)) {
    throw new Error(`device not found: ${deviceId}`);
  }
}

function applyMockAction(input: {
  state: Record<string, string | number | boolean>;
  action: string;
}): Record<string, string | number | boolean> {
  if (input.action === "turn_on") {
    return { ...input.state, power: "on" };
  }
  if (input.action === "turn_off") {
    return { ...input.state, power: "off" };
  }
  if (input.action === "start_recording") {
    return { ...input.state, recording: true };
  }

  return { ...input.state };
}
