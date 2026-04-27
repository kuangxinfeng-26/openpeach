import { describe, expect, it } from "vitest";
import {
  createMockDeviceAdapter,
  evaluateDeviceActionPolicy,
} from "./index.js";

describe("mock device adapter", () => {
  it("describes a mock living-room lamp and reads its state", async () => {
    const adapter = createMockDeviceAdapter();

    await expect(adapter.describe("mock:living-room-lamp")).resolves.toMatchObject({
      deviceId: "mock:living-room-lamp",
      displayName: "Living Room Lamp",
      capabilities: [
        { action: "read_state", risk: "read" },
        { action: "turn_on", risk: "low_risk_control" },
        { action: "turn_off", risk: "low_risk_control" },
      ],
    });

    await expect(adapter.readState("mock:living-room-lamp")).resolves.toEqual({
      deviceId: "mock:living-room-lamp",
      online: true,
      state: { power: "off" },
    });
  });

  it("executes low-risk lamp commands idempotently against in-memory state", async () => {
    const adapter = createMockDeviceAdapter();

    await expect(
      adapter.executeCommand({
        commandId: "command-1",
        deviceId: "mock:living-room-lamp",
        action: "turn_on",
      }),
    ).resolves.toMatchObject({
      commandId: "command-1",
      deviceId: "mock:living-room-lamp",
      action: "turn_on",
      acknowledged: true,
      state: { power: "on" },
    });

    await expect(adapter.readState("mock:living-room-lamp")).resolves.toMatchObject({
      state: { power: "on" },
    });

    await expect(
      adapter.executeCommand({
        commandId: "command-1",
        deviceId: "mock:living-room-lamp",
        action: "turn_on",
      }),
    ).resolves.toMatchObject({
      commandId: "command-1",
      acknowledged: true,
      state: { power: "on" },
    });
  });
});

describe("device action policy", () => {
  it("allows the owner to read state and run low-risk controls", () => {
    expect(
      evaluateDeviceActionPolicy({
        requesterRole: "owner",
        risk: "read",
      }),
    ).toEqual({ decision: "allow" });

    expect(
      evaluateDeviceActionPolicy({
        requesterRole: "owner",
        risk: "low_risk_control",
      }),
    ).toEqual({ decision: "allow" });
  });

  it("requires confirmation for owner high-risk controls", () => {
    expect(
      evaluateDeviceActionPolicy({
        requesterRole: "owner",
        risk: "high_risk_control",
      }),
    ).toEqual({
      decision: "requires_confirmation",
      reason: "High-risk device action requires explicit confirmation",
    });
  });

  it("denies non-owner device control", () => {
    expect(
      evaluateDeviceActionPolicy({
        requesterRole: "guest",
        risk: "low_risk_control",
      }),
    ).toEqual({
      decision: "deny",
      reason: "Requester is not allowed to control family devices",
    });
  });
});
