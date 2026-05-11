import { describe, expect, it, vi } from "vitest";
import { createEventBus, type EventRepository, type PublishEventInput } from "./index.js";
import type { OpenPeachEvent } from "./events.js";

function createMockRepository(): EventRepository & {
  calls: Array<Parameters<EventRepository["insertEvent"]>[0]>;
} {
  const calls: Array<Parameters<EventRepository["insertEvent"]>[0]> = [];
  return {
    calls,
    insertEvent(input) {
      calls.push(input);
    },
  };
}

describe("createEventBus", () => {
  it("publishes a message.received event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "message.received",
      sessionId: "session-1",
      payload: { envelopeId: "env-1" },
    };

    bus.publish({
      eventId: "evt-1",
      event,
      createdAtMs: 1700000000000,
    });

    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]).toEqual({
      eventId: "evt-1",
      eventType: "message.received",
      taskId: undefined,
      sessionId: "session-1",
      payloadJson: JSON.stringify({ envelopeId: "env-1" }),
      createdAtMs: 1700000000000,
    });
  });

  it("publishes a task.created event with taskId", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "task.created",
      sessionId: "session-2",
      taskId: "task-42",
      payload: { objective: "turn on lamp" },
    };

    bus.publish({
      eventId: "evt-2",
      event,
      createdAtMs: 1700000001000,
    });

    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0]!.taskId).toBe("task-42");
    expect(repo.calls[0]!.eventType).toBe("task.created");
    expect(repo.calls[0]!.sessionId).toBe("session-2");
  });

  it("publishes a task.completed event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "task.completed",
      sessionId: "session-3",
      taskId: "task-99",
      payload: { status: "succeeded" },
    };

    bus.publish({
      eventId: "evt-3",
      event,
      createdAtMs: 1700000002000,
    });

    expect(repo.calls[0]!.eventType).toBe("task.completed");
    expect(repo.calls[0]!.taskId).toBe("task-99");
  });

  it("publishes a task.failed event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "task.failed",
      sessionId: "session-4",
      taskId: "task-100",
      payload: { reason: "model timeout" },
    };

    bus.publish({
      eventId: "evt-4",
      event,
      createdAtMs: 1700000003000,
    });

    expect(repo.calls[0]!.eventType).toBe("task.failed");
    expect(repo.calls[0]!.payloadJson).toBe(
      JSON.stringify({ reason: "model timeout" }),
    );
  });

  it("publishes a reply.queued event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "reply.queued",
      sessionId: "session-5",
      taskId: "task-200",
      payload: { outboxId: "outbox-1" },
    };

    bus.publish({
      eventId: "evt-5",
      event,
      createdAtMs: 1700000004000,
    });

    expect(repo.calls[0]!.eventType).toBe("reply.queued");
    expect(repo.calls[0]!.taskId).toBe("task-200");
  });

  it("publishes a device.state_read event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "device.state_read",
      sessionId: "session-6",
      taskId: "task-300",
      payload: { deviceId: "mock:lamp", state: { on: true } },
    };

    bus.publish({
      eventId: "evt-6",
      event,
      createdAtMs: 1700000005000,
    });

    expect(repo.calls[0]!.eventType).toBe("device.state_read");
    expect(JSON.parse(repo.calls[0]!.payloadJson)).toEqual({
      deviceId: "mock:lamp",
      state: { on: true },
    });
  });

  it("publishes a device.command_acknowledged event", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "device.command_acknowledged",
      sessionId: "session-7",
      taskId: "task-400",
      payload: {
        deviceId: "mock:lamp",
        action: "turn_on",
        commandId: "cmd-1",
        state: { on: true },
      },
    };

    bus.publish({
      eventId: "evt-7",
      event,
      createdAtMs: 1700000006000,
    });

    expect(repo.calls[0]!.eventType).toBe("device.command_acknowledged");
    expect(repo.calls[0]!.taskId).toBe("task-400");
  });

  it("serializes payload as JSON", () => {
    const repo = createMockRepository();
    const bus = createEventBus(repo);

    const event: OpenPeachEvent = {
      type: "message.received",
      sessionId: "s1",
      payload: { envelopeId: "e-special-chars-<>&" },
    };

    bus.publish({ eventId: "evt-8", event, createdAtMs: 1 });

    const parsed = JSON.parse(repo.calls[0]!.payloadJson);
    expect(parsed.envelopeId).toBe("e-special-chars-<>&");
  });
});
