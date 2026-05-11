import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import { getOrCreateSession } from "../../session-kernel/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../store-sqlite/src/index.js";
import { admitTask } from "../../task-engine/src/index.js";
import { MainAgentRuntime } from "./main-agent.js";

describe("MainAgentRuntime", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("handles one main-agent turn end-to-end and queues a telegram reply", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        text: "chat with me today",
        messageId: "tg-msg-1",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      const modelCalls: Array<
        Array<{ role: "system" | "user" | "assistant"; content: string }>
      > = [];
      const events: OpenPeachEvent[] = [];
      const runtime = new MainAgentRuntime({
        repositories,
        model: {
          async complete(messages) {
            modelCalls.push(messages);
            return "Sure, we can take it slowly.";
          },
        },
        emit(event) {
          events.push(event);
        },
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
      });

      expect(result).toEqual({
        replyText: "Sure, we can take it slowly.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-msg-1`,
      });

      const messages = db
        .prepare(
          `
            SELECT message_id, role, text
            FROM session_messages
            WHERE session_id = ?
            ORDER BY rowid ASC
          `,
        )
        .all(session.sessionId) as Array<{
        message_id: string;
        role: string;
        text: string;
      }>;

      expect(messages).toEqual([
        {
          message_id: `user:${session.sessionId}:tg-msg-1`,
          role: "user",
          text: "chat with me today",
        },
        {
          message_id: `assistant:${session.sessionId}:tg-msg-1`,
          role: "assistant",
          text: "Sure, we can take it slowly.",
        },
      ]);

      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]).toEqual([
        {
          role: "system",
          content:
            "You are OpenPeach main agent. Be warm, reliable, and honest. Handle companionship, conversation, explicit history lookup, and user-facing orchestration. Route supported home-device and lab-style work through the gateway instead of pretending to execute it yourself. Do not claim unsupported channels, real Home Assistant devices, WeChat, raw cameras, or AI toy hardware are connected.",
        },
        {
          role: "user",
          content: "chat with me today",
        },
      ]);

      const outboxRow = db
        .prepare(
          `
            SELECT outbox_id, idempotency_key, channel, target_ref, payload_json, status
            FROM outbox
            WHERE outbox_id = ?
          `,
        )
        .get(result.outboxId) as
        | {
            outbox_id: string;
            idempotency_key: string;
            channel: string;
            target_ref: string;
            payload_json: string;
            status: string;
          }
        | undefined;

      expect(outboxRow).toEqual({
        outbox_id: `outbox:telegram:${session.sessionId}:tg-msg-1`,
        idempotency_key: `telegram:reply:${session.sessionId}:tg-msg-1`,
        channel: "telegram",
        target_ref: "456",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "Sure, we can take it slowly.",
          replyToMessageId: "tg-msg-1",
        }),
        status: "pending",
      });

      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "succeeded",
      });

      expect(events).toEqual([
        {
          type: "task.created",
          sessionId: session.sessionId,
          taskId: decision.task!.taskId,
          payload: { objective: "chat with me today" },
        },
        {
          type: "task.completed",
          sessionId: session.sessionId,
          taskId: decision.task!.taskId,
          payload: { status: "succeeded" },
        },
        {
          type: "reply.queued",
          sessionId: session.sessionId,
          taskId: decision.task!.taskId,
          payload: { outboxId: `outbox:telegram:${session.sessionId}:tg-msg-1` },
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("injects up to five historical snippets when the user explicitly asks about history", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });

      const envelope = createEnvelope({
        text: "last time before, what history did we discuss?",
        messageId: "tg-msg-history",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      const modelCalls: Array<
        Array<{ role: "system" | "user" | "assistant"; content: string }>
      > = [];
      const runtime = new MainAgentRuntime({
        repositories,
        model: {
          async complete(messages) {
            modelCalls.push(messages);
            return "We talked about going to the park before.";
          },
        },
        emit() {},
        sessionSearch(query) {
          expect(query).toBe("last time");

          return [
            {
              messageId: "history-1",
              sessionId: session.sessionId,
              snippet: "Previous chat 1 mentioned going to the park",
            },
            {
              messageId: "history-2-other-session",
              sessionId: "different-session",
              snippet: "This should not enter current session context",
            },
            {
              messageId: "history-3",
              sessionId: session.sessionId,
              snippet: "Previous chat 3 mentioned going to the park",
            },
            {
              messageId: "history-4",
              sessionId: session.sessionId,
              snippet: "Previous chat 4 mentioned going to the park",
            },
            {
              messageId: "history-5",
              sessionId: session.sessionId,
              snippet: "Previous chat 5 mentioned going to the park",
            },
            {
              messageId: "history-6",
              sessionId: session.sessionId,
              snippet: "Previous chat 6 mentioned going to the park",
            },
            {
              messageId: "history-7",
              sessionId: session.sessionId,
              snippet: "Previous chat 7 mentioned going to the park",
            },
          ];
        },
      });

      await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
      });

      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]?.[1]).toEqual({
        role: "user",
        content: [
          "Current user message: last time before, what history did we discuss?",
          "Relevant history snippets:",
          "[1] history-1: Previous chat 1 mentioned going to the park",
          "[2] history-3: Previous chat 3 mentioned going to the park",
          "[3] history-4: Previous chat 4 mentioned going to the park",
          "[4] history-5: Previous chat 5 mentioned going to the park",
          "[5] history-6: Previous chat 6 mentioned going to the park",
        ].join("\n"),
      });
    } finally {
      db.close();
    }
  });

  it("reuses an existing assistant message so retry can continue queueing the outbox", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        text: "try again",
        messageId: "tg-msg-replay",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      repositories.appendMessage({
        messageId: `user:${session.sessionId}:tg-msg-replay`,
        sessionId: session.sessionId,
        role: "user",
        text: "try again",
        timestampMs: envelope.timestampMs,
      });
      repositories.createTask(decision.task!, "created");
      repositories.createTask(decision.task!, "admitted");
      repositories.updateTaskStatus(decision.task!.taskId, "running");
      repositories.appendMessage({
        messageId: `assistant:${session.sessionId}:tg-msg-replay`,
        sessionId: session.sessionId,
        role: "assistant",
        text: "This reply was already generated last time.",
        timestampMs: envelope.timestampMs,
      });

      const runtime = new MainAgentRuntime({
        repositories,
        model: {
          async complete() {
            throw new Error("model should not be called on replay");
          },
        },
        emit() {},
      });

      const result = await runtime.handleTurn({
        envelope,
        session,
        task: decision.task!,
      });

      expect(result).toEqual({
        replyText: "This reply was already generated last time.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-msg-replay`,
      });

      const countRow = db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM session_messages
            WHERE session_id = ?
          `,
        )
        .get(session.sessionId) as { count: number };

      expect(countRow.count).toBe(2);
      expect(repositories.getTask(decision.task!.taskId)?.status).toBe("succeeded");

      const outboxRow = db
        .prepare(
          `
            SELECT outbox_id, payload_json, status
            FROM outbox
            WHERE outbox_id = ?
          `,
        )
        .get(`outbox:telegram:${session.sessionId}:tg-msg-replay`) as
        | { outbox_id: string; payload_json: string; status: string }
        | undefined;

      expect(outboxRow).toEqual({
        outbox_id: `outbox:telegram:${session.sessionId}:tg-msg-replay`,
        payload_json: JSON.stringify({
          chatId: "456",
          text: "This reply was already generated last time.",
          replyToMessageId: "tg-msg-replay",
        }),
        status: "pending",
      });
    } finally {
      db.close();
    }
  });

  it("marks the task failed and emits task.failed when the model call throws", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        text: "are you still there",
        messageId: "tg-msg-fail",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      const events: OpenPeachEvent[] = [];
      const runtime = new MainAgentRuntime({
        repositories,
        model: {
          async complete() {
            throw new Error("model unavailable");
          },
        },
        emit(event) {
          events.push(event);
        },
      });

      await expect(
        runtime.handleTurn({
          envelope,
          session,
          task: decision.task!,
        }),
      ).rejects.toThrow("model unavailable");

      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "failed",
      });

      expect(events).toEqual([
        {
          type: "task.created",
          sessionId: session.sessionId,
          taskId: decision.task!.taskId,
          payload: { objective: "are you still there" },
        },
        {
          type: "task.failed",
          sessionId: session.sessionId,
          taskId: decision.task!.taskId,
          payload: { reason: "model unavailable" },
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("revives a failed turn on retry and finishes it successfully", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        text: "please continue that previous item",
        messageId: "tg-msg-revive",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      let failOutboxInsert = true;
      const flakyRepositories = {
        ...repositories,
        insertOutboxOnce(input: {
          outboxId: string;
          idempotencyKey: string;
          channel: string;
          targetRef: string;
          payloadJson: string;
        }) {
          if (failOutboxInsert) {
            failOutboxInsert = false;
            throw new Error("outbox unavailable");
          }

          repositories.insertOutboxOnce(input);
        },
      };

      const firstRuntime = new MainAgentRuntime({
        repositories: flakyRepositories,
        model: {
          async complete() {
            return "This reply was generated the first time.";
          },
        },
        emit() {},
      });

      await expect(
        firstRuntime.handleTurn({
          envelope,
          session,
          task: decision.task!,
        }),
      ).rejects.toThrow("outbox unavailable");

      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "failed",
      });
      expect(
        repositories.getMessageById(
          `assistant:${session.sessionId}:tg-msg-revive`,
        )?.text,
      ).toBe(
        "This reply was generated the first time.",
      );

      const secondRuntime = new MainAgentRuntime({
        repositories,
        model: {
          async complete() {
            throw new Error("model should not be called on revived retry");
          },
        },
        emit() {},
      });

      const result = await secondRuntime.handleTurn({
        envelope,
        session,
        task: decision.task!,
      });

      expect(result).toEqual({
        replyText: "This reply was generated the first time.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-msg-revive`,
      });
      expect(repositories.getTask(decision.task!.taskId)).toEqual({
        taskId: decision.task!.taskId,
        status: "succeeded",
      });
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-runtime-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

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
