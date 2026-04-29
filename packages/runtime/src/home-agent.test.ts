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
import {
  createMockStoryBunnyBridge,
  createStoryBunnyToyAdapter,
} from "../../toy-story-bunny/src/index.js";
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
      expect(result.replyText).toContain(`confirm task:${decision.task!.taskId}`);
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

  it("confirms and resumes an owner high-risk device action", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-risk-confirm-source",
        text: "start camera recording",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });
      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createMockDeviceAdapter(),
        emit() {},
      });

      expect(decision.task).toBeDefined();
      await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      const result = await runtime.confirmAwaitingDeviceAction({
        confirmationTaskId: decision.task!.taskId,
        envelope: createEnvelope({
          messageId: "tg-home-risk-confirm",
          text: `confirm task:${decision.task!.taskId}`,
        }),
        session,
        requester: { role: "owner" },
      });

      expect(result).toEqual({
        replyText: "Front Camera acknowledged start_recording.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-home-risk-confirm`,
      });
      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "succeeded",
      });

      const events = db
        .prepare(
          `
            SELECT event_type
            FROM device_events
            WHERE task_id = ?
            ORDER BY created_at_ms, device_event_id
          `,
        )
        .all(decision.task!.taskId) as Array<{ event_type: string }>;

      expect(events.map((event) => event.event_type).sort()).toEqual([
        "command.acknowledged",
        "command.requires_confirmation",
      ]);
    } finally {
      db.close();
    }
  });

  it("refuses to confirm high-risk actions from a different home session", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const originalSession = createHomeSession(repositories);
      const otherSession = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "home",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "789",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        messageId: "tg-home-risk-cross-session-source",
        text: "start camera recording",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: originalSession.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });
      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createMockDeviceAdapter(),
        emit() {},
      });

      expect(decision.task).toBeDefined();
      await runtime.handleTurn({
        envelope,
        session: originalSession,
        task: decision.task!,
        requester: { role: "owner" },
      });

      await expect(
        runtime.confirmAwaitingDeviceAction({
          confirmationTaskId: decision.task!.taskId,
          envelope: createEnvelope({
            messageId: "tg-home-risk-cross-session-confirm",
            text: `confirm task:${decision.task!.taskId}`,
            peerId: "789",
            chatId: "789",
          }),
          session: otherSession,
          requester: { role: "owner" },
        }),
      ).rejects.toThrow("Confirmation session does not match the task session");
      expect(repositories.getTask(decision.task!.taskId)?.status).toBe(
        "awaiting_confirmation",
      );
    } finally {
      db.close();
    }
  });

  it("triggers an optional Story Bunny bedtime scene through the home runtime", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = createHomeSession(repositories);
      const envelope = createEnvelope({
        messageId: "tg-home-toy-bedtime",
        text: "trigger story bunny bedtime",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
        enabledDeviceIds: ["toy:story-bunny"],
      });
      const runtime = new HomeAgentRuntime({
        repositories,
        deviceAdapter: createStoryBunnyToyAdapter({
          bridge: createMockStoryBunnyBridge(),
        }),
        emit() {},
      });

      expect(decision.task).toMatchObject({
        targetAgent: "home",
        scopeRef: "toy:story-bunny",
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
        requester: { role: "owner" },
      });

      expect(result.replyText).toBe(
        "AI Story Bunny acknowledged trigger_bedtime_scene.",
      );
      const row = db
        .prepare(
          `
            SELECT device_id, event_type, payload_json
            FROM device_events
            WHERE task_id = ?
          `,
        )
        .get(decision.task!.taskId) as
        | {
            device_id: string;
            event_type: string;
            payload_json: string;
          }
        | undefined;

      expect(row).toMatchObject({
        device_id: "toy:story-bunny",
        event_type: "command.acknowledged",
      });
      expect(JSON.parse(row?.payload_json ?? "null")).toMatchObject({
        action: "trigger_bedtime_scene",
        state: {
          lastScene: "bedtime",
          lastChildText: "Time for a gentle bedtime rhyme.",
        },
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
