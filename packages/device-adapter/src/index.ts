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

export type HomeAssistantFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type HomeAssistantActionConfig = {
  action: string;
  service: string;
  risk: DeviceActionRisk;
};

export type HomeAssistantDeviceConfig = {
  deviceId: string;
  entityId: string;
  displayName: string;
  domain: string;
  actions?: HomeAssistantActionConfig[];
};

export type HomeAssistantDeviceAdapterOptions = {
  baseUrl: string;
  token: string;
  devices: HomeAssistantDeviceConfig[];
  fetch?: HomeAssistantFetch;
};

export function createCompositeDeviceAdapter(adapters: DeviceAdapter[]): DeviceAdapter {
  return {
    async describe(deviceId) {
      return findAdapterForDevice(adapters, deviceId).then((adapter) =>
        adapter.describe(deviceId),
      );
    },

    async readState(deviceId) {
      const adapter = await findAdapterForDevice(adapters, deviceId);
      return adapter.readState(deviceId);
    },

    async executeCommand(command) {
      const adapter = await findAdapterForDevice(adapters, command.deviceId);
      return adapter.executeCommand(command);
    },
  };
}

export function createHomeAssistantDeviceAdapter(
  options: HomeAssistantDeviceAdapterOptions,
): DeviceAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const devices = new Map(
    options.devices.map((device) => {
      const actions = device.actions ?? [
        { action: "turn_on", service: "turn_on", risk: "low_risk_control" },
        { action: "turn_off", service: "turn_off", risk: "low_risk_control" },
      ];
      assertAllowedHomeAssistantPathSegment(device.domain);
      assertAllowedHomeAssistantPathSegment(device.entityId);
      assertAllowedHomeAssistantDomain(device.domain);
      for (const action of actions) {
        assertAllowedHomeAssistantPathSegment(action.service);
      }
      return [
        device.deviceId,
        {
          ...device,
          actions,
        },
      ];
    }),
  );

  return {
    async describe(deviceId) {
      const device = getHomeAssistantDevice(devices, deviceId);
      return {
        deviceId: device.deviceId,
        displayName: device.displayName,
        capabilities: [
          { action: "read_state", risk: "read" },
          ...device.actions.map((action) => ({
            action: action.action,
            risk: action.risk,
          })),
        ],
      };
    },

    async readState(deviceId) {
      const device = getHomeAssistantDevice(devices, deviceId);
      return {
        deviceId,
        online: true,
        state: toDeviceStateRecord(
          await requestHomeAssistantJson(fetchImpl, {
            baseUrl,
            token: options.token,
            path: `/api/states/${device.entityId}`,
            method: "GET",
          }),
        ),
      };
    },

    async executeCommand(command) {
      const device = getHomeAssistantDevice(devices, command.deviceId);
      const action = device.actions.find((item) => item.action === command.action);
      if (!action) {
        throw new Error(`unsupported device action: ${command.action}`);
      }
      assertAllowedHomeAssistantDomain(device.domain);

      const payload = await requestHomeAssistantJson(fetchImpl, {
        baseUrl,
        token: options.token,
        path: `/api/services/${device.domain}/${action.service}`,
        method: "POST",
        body: JSON.stringify({ entity_id: device.entityId }),
      });

      return {
        ...command,
        acknowledged: true,
        state: toDeviceStateRecord(selectHomeAssistantState(payload, device.entityId)),
      };
    },
  };
}

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

async function findAdapterForDevice(
  adapters: DeviceAdapter[],
  deviceId: string,
): Promise<DeviceAdapter> {
  for (const adapter of adapters) {
    try {
      await adapter.describe(deviceId);
      return adapter;
    } catch (error) {
      if (!isDeviceNotFound(error)) {
        throw error;
      }
    }
  }

  throw new Error(`device not found: ${deviceId}`);
}

function isDeviceNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("device not found:");
}

function getHomeAssistantDevice(
  devices: Map<string, HomeAssistantDeviceConfig & { actions: HomeAssistantActionConfig[] }>,
  deviceId: string,
): HomeAssistantDeviceConfig & { actions: HomeAssistantActionConfig[] } {
  const device = devices.get(deviceId);
  if (!device) {
    throw new Error(`device not found: ${deviceId}`);
  }

  return device;
}

function assertAllowedHomeAssistantDomain(domain: string): void {
  if (domain === "shell_command" || domain === "rest_command") {
    throw new Error("Home Assistant service domain is not allowed");
  }
}

function assertAllowedHomeAssistantPathSegment(value: string): void {
  if (!/^[A-Za-z0-9_.]+$/.test(value)) {
    throw new Error("Home Assistant path segment is not allowed");
  }
}

async function requestHomeAssistantJson(
  fetchImpl: HomeAssistantFetch,
  input: {
    baseUrl: string;
    token: string;
    path: string;
    method: "GET" | "POST";
    body?: string;
  },
): Promise<unknown> {
  const response = await fetchImpl(`${input.baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: input.body,
  });

  if (!response.ok) {
    throw new Error(`Home Assistant request failed with ${response.status}`);
  }

  return response.json();
}

function selectHomeAssistantState(payload: unknown, entityId: string): unknown {
  if (Array.isArray(payload)) {
    return (
      payload.find((item) => isRecord(item) && item.entity_id === entityId) ??
      payload[0] ??
      {}
    );
  }

  return payload;
}

function toDeviceStateRecord(payload: unknown): Record<string, string | number | boolean> {
  if (!isRecord(payload)) {
    return {};
  }

  const state: Record<string, string | number | boolean> = {};
  const haState = payload.state;
  if (isPrimitiveStateValue(haState)) {
    state.haState = haState;
  }
  if (isRecord(payload.attributes)) {
    for (const [key, value] of Object.entries(payload.attributes)) {
      if (isPrimitiveStateValue(value)) {
        state[key] = value;
      }
    }
  }

  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitiveStateValue(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
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
