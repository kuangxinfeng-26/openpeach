import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockDeviceAdapter } from "../../device-adapter/src/index.js";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import { getOrCreateSession } from "../../session-kernel/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../store-sqlite/src/index.js";
import { admitTask } from "../../task-engine/src/index.js";
import { HomeAgentRuntime } from "./home-agent.js";

describe("HomeAgentRuntime", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("answers a mock lamp state query without calling the language model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-state",
        text: "is the living room lamp on?",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });
      const events: OpenPeachEvent[] = [];

      expect(decision.task).toBeDefined();

      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createMockDeviceAdapter(),
        emit(event) {
          events.push(event);
        },
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      expect(result).toEqual({
        replyText: "Living Room Lamp is online and power is off.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-home-state`,
      });
      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "succeeded",
      });
      expect(events.map((event) => event.type)).toEqual([
        "task.created",
        "device.state_read",
        "task.completed",
        "reply.queued",
      ]);
    } finally {
      db.close();
    }
  });

  it("executes an owner low-risk mock lamp command and records a device event", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-on",
        text: "turn on the living room lamp",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });

      expect(decision.task).toBeDefined();

      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createMockDeviceAdapter(),
        emit() {},
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      expect(result.replyText).toBe("Living Room Lamp is now on.");
      expect(repositories.getTask(decision.task!.taskId)?.status).toBe("succeeded");

      const row = db
        .prepare(
          `
            SELECT device_id, event_type, task_id, payload_json
            FROM device_events
            WHERE task_id = ?
          `,
        )
        .get(decision.task!.taskId) as
        | {
            device_id: string;
            event_type: string;
            task_id: string;
            payload_json: string;
          }
        | undefined;

      expect(row).toMatchObject({
        device_id: "mock:living-room-lamp",
        event_type: "command.acknowledged",
        task_id: decision.task!.taskId,
      });
      expect(JSON.parse(row?.payload_json ?? "null")).toMatchObject({
        action: "turn_on",
        state: { power: "on" },
      });
    } finally {
      db.close();
    }
  });

  it("replays completed low-risk commands without duplicate execution or device events", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-replay",
        text: "turn on the living room lamp",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });
      const adapter = createCountingAdapter();

      expect(decision.task).toBeDefined();

      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: adapter,
        emit() {},
      });

      await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });
      const replay = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      expect(replay).toEqual({
        replyText: "Living Room Lamp is now on.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-home-replay`,
      });
      expect(adapter.executeCalls).toBe(1);

      const count = db
        .prepare("SELECT COUNT(*) AS count FROM device_events WHERE task_id = ?")
        .get(decision.task!.taskId) as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("parks high-risk device actions in awaiting_confirmation and records the attempt", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-risk",
        text: "start camera recording",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });

      expect(decision.task).toBeDefined();

      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createMockDeviceAdapter(),
        emit() {},
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      expect(result.replyText).toContain("needs confirmation");
      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "awaiting_confirmation",
      });

      const row = db
        .prepare(
          `
            SELECT device_id, event_type, task_id, payload_json
            FROM device_events
            WHERE task_id = ?
          `,
        )
        .get(decision.task!.taskId) as
        | {
            device_id: string;
            event_type: string;
            task_id: string;
            payload_json: string;
          }
        | undefined;

      expect(row).toMatchObject({
        device_id: "mock:front-camera",
        event_type: "command.requires_confirmation",
        task_id: decision.task!.taskId,
      });
      expect(JSON.parse(row?.payload_json ?? "null")).toMatchObject({
        action: "start_recording",
        reason: "High-risk device action requires explicit confirmation",
      });
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-home-runtime-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

function createHomeSession(repositories: ReturnType<typeof createRepositories>) {
  return getOrCreateSession(repositories, {
    familyId: "family-main",
    coreAgentId: "home",
    channel: "telegram",
    accountId: "bot-main",
    peerId: "456",
    threadId: "dm",
    scene: "default",
  });
}

function createCountingAdapter() {
  const adapter = createMockDeviceAdapter();
  let executeCalls = 0;

  return {
    get executeCalls() {
      return executeCalls;
    },
    describe: adapter.describe,
    readState: adapter.readState,
    async executeCommand(command: Parameters<typeof adapter.executeCommand>[0]) {
      executeCalls += 1;
      return adapter.executeCommand(command);
    },
  };
}

function createEnvelope(
  overrides: Partial<HumanEnvelope> & Pick<HumanEnvelope, "text" | "messageId">,
): HumanEnvelope {
  return {
    id: `envelope:${overrides.messageId}`,
    channel: "telegram",
    accountId: "bot-main",
    chatType: "private",
    peerId: "456",
    chatId: "456",
    threadId: "dm",
    messageId: overrides.messageId,
    text: overrides.text,
    timestampMs: 1_710_000_000_000,
    raw: {},
  };
}
