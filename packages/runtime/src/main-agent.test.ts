import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { TaoqibaoEvent } from "../../event-bus/src/index.js";
import { getOrCreateSession } from "../../session-kernel/src/index.js";
import {
  createRepositories,
  migrate,
  openTaoqibaoDb,
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

  it("handles one phase 0 turn end-to-end and queues a telegram reply", async () => {
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
        text: "今天想聊聊天",
        messageId: "tg-msg-1",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      const modelCalls: Array<
        Array<{ role: "system" | "user" | "assistant"; content: string }>
      > = [];
      const events: TaoqibaoEvent[] = [];
      const runtime = new MainAgentRuntime({
        repositories,
        model: {
          async complete(messages) {
            modelCalls.push(messages);
            return "当然可以，我们慢慢聊。";
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
        replyText: "当然可以，我们慢慢聊。",
        outboxId: "outbox:telegram:tg-msg-1",
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
          message_id: "user:tg-msg-1",
          role: "user",
          text: "今天想聊聊天",
        },
        {
          message_id: "assistant:tg-msg-1",
          role: "assistant",
          text: "当然可以，我们慢慢聊。",
        },
      ]);

      expect(modelCalls).toHaveLength(1);
      expect(modelCalls[0]).toEqual([
        {
          role: "system",
          content:
            "你是淘气包的 main agent，负责温和、可靠地陪伴用户，并在 Phase 0 中只处理普通对话和显式历史检索。不要假装已经接入家庭设备、微信、摄像头或 AI 玩具。",
        },
        {
          role: "user",
          content: "今天想聊聊天",
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
        outbox_id: "outbox:telegram:tg-msg-1",
        idempotency_key: "telegram:reply:tg-msg-1",
        channel: "telegram",
        target_ref: "456",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "当然可以，我们慢慢聊。",
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
          payload: { objective: "今天想聊聊天" },
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
          payload: { outboxId: "outbox:telegram:tg-msg-1" },
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
        text: "上次我们之前聊到什么历史内容？",
        messageId: "tg-msg-history",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", personId: "owner-1" },
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
            return "我们之前聊过想去公园。";
          },
        },
        emit() {},
        sessionSearch(query) {
          expect(query).toBe("上次");

          return [
            {
              messageId: "history-1",
              sessionId: session.sessionId,
              snippet: "之前第1次聊天提到想去公园",
            },
            {
              messageId: "history-2-other-session",
              sessionId: "different-session",
              snippet: "这条不该进入当前会话上下文",
            },
            {
              messageId: "history-3",
              sessionId: session.sessionId,
              snippet: "之前第3次聊天提到想去公园",
            },
            {
              messageId: "history-4",
              sessionId: session.sessionId,
              snippet: "之前第4次聊天提到想去公园",
            },
            {
              messageId: "history-5",
              sessionId: session.sessionId,
              snippet: "之前第5次聊天提到想去公园",
            },
            {
              messageId: "history-6",
              sessionId: session.sessionId,
              snippet: "之前第6次聊天提到想去公园",
            },
            {
              messageId: "history-7",
              sessionId: session.sessionId,
              snippet: "之前第7次聊天提到想去公园",
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
          "用户当前消息：上次我们之前聊到什么历史内容？",
          "检索到的当前会话历史：",
          "[1] history-1: 之前第1次聊天提到想去公园",
          "[2] history-3: 之前第3次聊天提到想去公园",
          "[3] history-4: 之前第4次聊天提到想去公园",
          "[4] history-5: 之前第5次聊天提到想去公园",
          "[5] history-6: 之前第6次聊天提到想去公园",
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
        text: "再试一次",
        messageId: "tg-msg-replay",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      repositories.appendMessage({
        messageId: "user:tg-msg-replay",
        sessionId: session.sessionId,
        role: "user",
        text: "再试一次",
        timestampMs: envelope.timestampMs,
      });
      repositories.createTask(decision.task!, "created");
      repositories.createTask(decision.task!, "admitted");
      repositories.updateTaskStatus(decision.task!.taskId, "running");
      repositories.appendMessage({
        messageId: "assistant:tg-msg-replay",
        sessionId: session.sessionId,
        role: "assistant",
        text: "这是上次已经生成的回复。",
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
        replyText: "这是上次已经生成的回复。",
        outboxId: "outbox:telegram:tg-msg-replay",
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
        .get("outbox:telegram:tg-msg-replay") as
        | { outbox_id: string; payload_json: string; status: string }
        | undefined;

      expect(outboxRow).toEqual({
        outbox_id: "outbox:telegram:tg-msg-replay",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "这是上次已经生成的回复。",
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
        text: "你还在吗",
        messageId: "tg-msg-fail",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();

      const events: TaoqibaoEvent[] = [];
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
          payload: { objective: "你还在吗" },
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

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-runtime-"));
    return openTaoqibaoDb(join(dir, "state.db"));
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
