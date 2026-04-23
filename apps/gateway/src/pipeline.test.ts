import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HumanEnvelope } from "../../../packages/envelope/src/index.js";
import { createEventBus } from "../../../packages/event-bus/src/index.js";
import { MainAgentRuntime } from "../../../packages/runtime/src/index.js";
import {
  createRepositories,
  migrate,
  openTaoqibaoDb,
} from "../../../packages/store-sqlite/src/index.js";
import { loadConfig } from "./config.js";
import { handleHumanEnvelope } from "./pipeline.js";

describe("loadConfig", () => {
  it("rejects malformed timeout env values", () => {
    expect(() =>
      loadConfig({
        TAOQIBAO_FAMILY_ID: "family-main",
        TAOQIBAO_CORE_AGENT_ID: "main",
        TAOQIBAO_OWNER_TELEGRAM_USER_IDS: "456",
        TELEGRAM_BOT_TOKEN: "token",
        TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
        TAOQIBAO_MODEL_API_KEY: "key",
        TAOQIBAO_MODEL_NAME: "model",
        TAOQIBAO_MODEL_TIMEOUT_MS: "30000ms",
        TAOQIBAO_LOG_LEVEL: "info",
      }),
    ).toThrow("Invalid positive integer env var: TAOQIBAO_MODEL_TIMEOUT_MS");
  });
});

describe("handleHumanEnvelope", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("lets an allowed private telegram envelope run through the full pipeline", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      const runtime = createRuntime(repositories, {
        async complete(messages) {
          modelCalls += 1;
          expect(messages[1]?.content).toBe("今天想聊聊天");
          return "当然可以，我们慢慢聊。";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-msg-1",
          text: "今天想聊聊天",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime,
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "当然可以，我们慢慢聊。",
      });
      expect(modelCalls).toBe(1);

      const outboxRow = db
        .prepare(
          `
            SELECT outbox_id, target_ref, payload_json, status
            FROM outbox
            WHERE outbox_id = ?
          `,
        )
        .get("outbox:telegram:tg-msg-1") as
        | {
            outbox_id: string;
            target_ref: string;
            payload_json: string;
            status: string;
          }
        | undefined;

      expect(outboxRow).toEqual({
        outbox_id: "outbox:telegram:tg-msg-1",
        target_ref: "456",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "当然可以，我们慢慢聊。",
          replyToMessageId: "tg-msg-1",
        }),
        status: "pending",
      });
    } finally {
      db.close();
    }
  });

  it("returns a denial reason and never calls the model for a denied identity", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      const runtime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "should never happen";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-msg-denied",
          text: "你是谁",
          peerId: "999",
          chatId: "999",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime,
        },
      });

      expect(result).toEqual({
        ok: false,
        reason: "Telegram user is not allowlisted",
      });
      expect(modelCalls).toBe(0);

      const tasksCount = db
        .prepare(`SELECT COUNT(*) AS count FROM tasks`)
        .get() as { count: number };
      const outboxCount = db
        .prepare(`SELECT COUNT(*) AS count FROM outbox`)
        .get() as { count: number };

      expect(tasksCount.count).toBe(0);
      expect(outboxCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("wires session and task context so the main runtime replies in the current conversation", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const runtime = createRuntime(repositories, {
        async complete(messages) {
          expect(messages[1]?.content).toBe("继续刚才的话题");
          return "我接着当前会话继续。";
        },
      });

      const envelope = createEnvelope({
        messageId: "tg-msg-session",
        text: "继续刚才的话题",
        threadId: "topic-7",
      });

      const result = await handleHumanEnvelope({
        envelope,
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime,
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "我接着当前会话继续。",
      });

      const sessionRow = db
        .prepare(
          `
            SELECT session_id, session_key, family_id, core_agent_id
            FROM sessions
            WHERE family_id = ?
          `,
        )
        .get("family-main") as
        | {
            session_id: string;
            session_key: string;
            family_id: string;
            core_agent_id: string;
          }
        | undefined;

      expect(sessionRow?.session_key).toBe(
        "family:family-main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:topic-7",
      );

      const taskRow = db
        .prepare(
          `
            SELECT task_id, source_session_id, status, packet_json
            FROM tasks
            WHERE source_session_id = ?
          `,
        )
        .get(sessionRow?.session_id ?? "") as
        | {
            task_id: string;
            source_session_id: string;
            status: string;
            packet_json: string;
          }
        | undefined;

      expect(taskRow?.status).toBe("succeeded");
      expect(JSON.parse(taskRow?.packet_json ?? "null")).toMatchObject({
        taskId: envelope.messageId,
        sourceSessionId: sessionRow?.session_id,
        scopeRef: sessionRow?.session_id,
        executionMode: "turn",
        objective: envelope.text,
      });
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-gateway-"));
    return openTaoqibaoDb(join(dir, "state.db"));
  }
});

function createRuntime(
  repositories: ReturnType<typeof createRepositories>,
  model: {
    complete(
      messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
    ): Promise<string>;
  },
) {
  const eventBus = createEventBus(repositories);

  return new MainAgentRuntime({
    repositories,
    model,
    emit(event) {
      eventBus.publish({
        eventId: randomUUID(),
        event,
        createdAtMs: Date.now(),
      });
    },
  });
}

function createEnvelope(
  overrides: Partial<HumanEnvelope> & Pick<HumanEnvelope, "messageId" | "text">,
): HumanEnvelope {
  return {
    id: `envelope:${overrides.messageId}`,
    channel: "telegram",
    accountId: "bot-main",
    chatType: "private",
    peerId: overrides.peerId ?? "456",
    chatId: overrides.chatId ?? "456",
    threadId: overrides.threadId ?? "dm",
    messageId: overrides.messageId,
    text: overrides.text,
    timestampMs: 1_710_000_000_000,
    raw: {},
  };
}
