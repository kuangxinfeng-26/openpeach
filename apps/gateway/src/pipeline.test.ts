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
  openPeachDb,
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
          expect(messages[1]?.content).toBe("chat with me today");
          return "Sure, we can take it slowly.";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-msg-1",
          text: "chat with me today",
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

      expect(result).toMatchObject({
        ok: true,
        replyText: "Sure, we can take it slowly.",
      });
      expect(result.ok ? result.outboxId : "").toMatch(/^outbox:telegram:/);
      expect(modelCalls).toBe(1);

      const outboxRow = db
        .prepare(
          `
            SELECT outbox_id, target_ref, payload_json, status
            FROM outbox
            WHERE outbox_id = ?
          `,
        )
        .get(result.ok ? result.outboxId : "") as
        | {
            outbox_id: string;
            target_ref: string;
            payload_json: string;
            status: string;
          }
        | undefined;

      expect(outboxRow).toEqual({
        outbox_id: result.ok ? result.outboxId : "",
        target_ref: "456",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "Sure, we can take it slowly.",
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
          text: "who are you",
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
          expect(messages[1]?.content).toBe("continue the current topic");
          return "I will continue in this session.";
        },
      });

      const envelope = createEnvelope({
        messageId: "tg-msg-session",
        text: "continue the current topic",
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

      expect(result).toMatchObject({
        ok: true,
        replyText: "I will continue in this session.",
      });
      expect(result.ok ? result.outboxId : "").toMatch(/^outbox:telegram:/);

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
        taskId: `task:${sessionRow?.session_id}:tg-msg-session`,
        sourceSessionId: sessionRow?.session_id,
        scopeRef: sessionRow?.session_id,
        executionMode: "turn",
        objective: envelope.text,
      });
    } finally {
      db.close();
    }
  });

  it("routes device intents to a home session and home runtime", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let mainCalls = 0;
      let homeCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          mainCalls += 1;
          return "main should not handle device work";
        },
      });
      const homeRuntime = {
        async handleTurn(input: Parameters<typeof mainRuntime.handleTurn>[0]) {
          homeCalls += 1;
          expect(input.session.coreAgentId).toBe("home");
          expect(input.task).toMatchObject({
            targetAgent: "home",
            scopeKind: "device",
            priority: "P1",
          });
          return {
            replyText: "Living Room Lamp is online and power is off.",
            outboxId: "outbox:telegram:tg-home-route",
          };
        },
      };

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-home-route",
          text: "is the living room lamp on?",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          homeRuntime,
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Living Room Lamp is online and power is off.",
        outboxId: "outbox:telegram:tg-home-route",
      });
      expect(mainCalls).toBe(0);
      expect(homeCalls).toBe(1);

      const sessionRow = db
        .prepare(
          `
            SELECT core_agent_id, session_key
            FROM sessions
            WHERE core_agent_id = 'home'
          `,
        )
        .get() as { core_agent_id: string; session_key: string } | undefined;

      expect(sessionRow?.session_key).toBe(
        "family:family-main/agent:home/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
      );

      const mainSessionCount = db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM sessions
            WHERE core_agent_id = 'main'
          `,
        )
        .get() as { count: number };

      expect(mainSessionCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-gateway-"));
    return openPeachDb(join(dir, "state.db"));
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
