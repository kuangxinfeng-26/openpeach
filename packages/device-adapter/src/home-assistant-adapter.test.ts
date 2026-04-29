import { describe, expect, it } from "vitest";
import { createHomeAssistantDeviceAdapter } from "./index.js";

describe("Home Assistant device adapter", () => {
  it("describes configured Home Assistant entities without probing the network", async () => {
    const adapter = createHomeAssistantDeviceAdapter({
      baseUrl: "http://homeassistant.local:8123",
      token: "test-token",
      devices: [
        {
          deviceId: "ha:living-room-light",
          entityId: "light.living_room",
          displayName: "Living Room Light",
          domain: "light",
        },
      ],
      fetch: createFakeFetch(),
    });

    await expect(adapter.describe("ha:living-room-light")).resolves.toEqual({
      deviceId: "ha:living-room-light",
      displayName: "Living Room Light",
      capabilities: [
        { action: "read_state", risk: "read" },
        { action: "turn_on", risk: "low_risk_control" },
        { action: "turn_off", risk: "low_risk_control" },
      ],
    });
  });

  it("reads Home Assistant entity state with bearer auth", async () => {
    const calls: FakeFetchCall[] = [];
    const adapter = createHomeAssistantDeviceAdapter({
      baseUrl: "http://homeassistant.local:8123/",
      token: "test-token",
      devices: [
        {
          deviceId: "ha:living-room-light",
          entityId: "light.living_room",
          displayName: "Living Room Light",
          domain: "light",
        },
      ],
      fetch: createFakeFetch(calls, {
        state: "on",
        attributes: {
          brightness: 128,
          friendly_name: "Living Room Light",
        },
      }),
    });

    await expect(adapter.readState("ha:living-room-light")).resolves.toEqual({
      deviceId: "ha:living-room-light",
      online: true,
      state: {
        haState: "on",
        brightness: 128,
        friendly_name: "Living Room Light",
      },
    });
    expect(calls).toMatchObject([
      {
        url: "http://homeassistant.local:8123/api/states/light.living_room",
        init: {
          method: "GET",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
      },
    ]);
  });

  it("executes safe configured services and returns the acknowledged state", async () => {
    const calls: FakeFetchCall[] = [];
    const adapter = createHomeAssistantDeviceAdapter({
      baseUrl: "http://homeassistant.local:8123",
      token: "test-token",
      devices: [
        {
          deviceId: "ha:living-room-light",
          entityId: "light.living_room",
          displayName: "Living Room Light",
          domain: "light",
        },
      ],
      fetch: createFakeFetch(calls, [
        {
          entity_id: "light.living_room",
          state: "on",
          attributes: { brightness: 255 },
        },
      ]),
    });

    await expect(
      adapter.executeCommand({
        commandId: "ha-command-1",
        deviceId: "ha:living-room-light",
        action: "turn_on",
      }),
    ).resolves.toEqual({
      commandId: "ha-command-1",
      deviceId: "ha:living-room-light",
      action: "turn_on",
      acknowledged: true,
      state: {
        haState: "on",
        brightness: 255,
      },
    });
    expect(calls[0]).toMatchObject({
      url: "http://homeassistant.local:8123/api/services/light/turn_on",
      init: {
        method: "POST",
        body: JSON.stringify({ entity_id: "light.living_room" }),
      },
    });
  });

  it("rejects dangerous Home Assistant service domains at adapter creation", () => {
    expect(() =>
      createHomeAssistantDeviceAdapter({
        baseUrl: "http://homeassistant.local:8123",
        token: "test-token",
        devices: [
          {
            deviceId: "ha:danger",
            entityId: "shell_command.reboot",
            displayName: "Danger",
            domain: "shell_command",
            actions: [
              {
                action: "run",
                service: "reboot",
                risk: "high_risk_control",
              },
            ],
          },
        ],
        fetch: createFakeFetch(),
      }),
    ).toThrow("Home Assistant service domain is not allowed");
  });

  it("rejects unsafe Home Assistant path segments at adapter creation", () => {
    expect(() =>
      createHomeAssistantDeviceAdapter({
        baseUrl: "http://homeassistant.local:8123",
        token: "test-token",
        devices: [
          {
            deviceId: "ha:unsafe",
            entityId: "light.living_room/../../secrets",
            displayName: "Unsafe",
            domain: "light",
            actions: [
              {
                action: "turn_on",
                service: "turn_on/../../shell_command/reboot",
                risk: "low_risk_control",
              },
            ],
          },
        ],
        fetch: createFakeFetch(),
      }),
    ).toThrow("Home Assistant path segment is not allowed");
  });
});

type FakeFetchCall = {
  url: string;
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

function createFakeFetch(calls: FakeFetchCall[] = [], payload: unknown = {}) {
  return async (url: string, init: FakeFetchCall["init"] = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    };
  };
}
