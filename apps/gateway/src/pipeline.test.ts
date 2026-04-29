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

  it("routes lab intents to a lab session and lab runtime", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let mainCalls = 0;
      let labCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          mainCalls += 1;
          return "main should not handle lab work";
        },
      });
      const labRuntime = {
        async handleTurn(input: Parameters<typeof mainRuntime.handleTurn>[0]) {
          labCalls += 1;
          expect(input.session.coreAgentId).toBe("lab");
          expect(input.task).toMatchObject({
            targetAgent: "lab",
            scopeKind: "project",
            priority: "P3",
            memoryPolicy: "candidate_memory",
          });
          return {
            replyText: "Lab captured a reviewable workflow candidate.",
            outboxId: "outbox:telegram:tg-lab-route",
          };
        },
      };

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-lab-route",
          text: "lab: turn this task trace into a reusable skill",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          labRuntime,
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Lab captured a reviewable workflow candidate.",
        outboxId: "outbox:telegram:tg-lab-route",
      });
      expect(mainCalls).toBe(0);
      expect(labCalls).toBe(1);

      const sessionRow = db
        .prepare(
          `
            SELECT core_agent_id, session_key
            FROM sessions
            WHERE core_agent_id = 'lab'
          `,
        )
        .get() as { core_agent_id: string; session_key: string } | undefined;

      expect(sessionRow?.session_key).toBe(
        "family:family-main/agent:lab/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
      );
    } finally {
      db.close();
    }
  });

  it("routes explicit confirmation messages to the home runtime", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let mainCalls = 0;
      let confirmCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          mainCalls += 1;
          return "main should not confirm device work";
        },
      });
      const homeRuntime = {
        async handleTurn() {
          throw new Error("home handleTurn should not run for confirmations");
        },
        async confirmAwaitingDeviceAction(input: {
          confirmationTaskId: string;
        }) {
          confirmCalls += 1;
          expect(input.confirmationTaskId).toBe("task:home-risk-1");
          return {
            replyText: "Front Camera acknowledged start_recording.",
            outboxId: "outbox:telegram:tg-home-confirm",
          };
        },
      };

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-home-confirm",
          text: "confirm task:home-risk-1",
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
        replyText: "Front Camera acknowledged start_recording.",
        outboxId: "outbox:telegram:tg-home-confirm",
      });
      expect(mainCalls).toBe(0);
      expect(confirmCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("routes Chinese confirmation messages to the home runtime", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let confirmCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          return "main should not confirm device work";
        },
      });
      const homeRuntime = {
        async handleTurn() {
          throw new Error("home handleTurn should not run for confirmations");
        },
        async confirmAwaitingDeviceAction(input: {
          confirmationTaskId: string;
        }) {
          confirmCalls += 1;
          expect(input.confirmationTaskId).toBe("task:home-risk-zh");
          return {
            replyText: "Front Camera acknowledged start_recording.",
            outboxId: "outbox:telegram:tg-home-confirm-zh",
          };
        },
      };

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-home-confirm-zh",
          text: "\u786e\u8ba4 task:home-risk-zh",
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
        replyText: "Front Camera acknowledged start_recording.",
        outboxId: "outbox:telegram:tg-home-confirm-zh",
      });
      expect(confirmCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("routes owner-only skill review commands without calling the model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle skill review commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review",
          text: "/skill_review skill-candidate-1",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate(candidateId) {
              reviewCalls += 1;
              expect(candidateId).toBe("skill-candidate-1");
              return "Skill candidate skill-candidate-1 can be promoted.";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Skill candidate skill-candidate-1 can be promoted.",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-review",
      });
      expect(modelCalls).toBe(0);
      expect(reviewCalls).toBe(1);

      const tasksCount = db
        .prepare(`SELECT COUNT(*) AS count FROM tasks`)
        .get() as { count: number };
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

      expect(tasksCount.count).toBe(0);
      expect(outboxRow).toEqual({
        outbox_id: "outbox:telegram:admin:bot-main:456:tg-skill-review",
        target_ref: "456",
        payload_json: JSON.stringify({
          chatId: "456",
          text: "Skill candidate skill-candidate-1 can be promoted.",
          replyToMessageId: "tg-skill-review",
        }),
        status: "pending",
      });
    } finally {
      db.close();
    }
  });

  it("does not let a denied identity run skill review commands", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle denied admin commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review-denied",
          text: "/skill_review skill-candidate-1",
          peerId: "999",
          chatId: "999",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate() {
              reviewCalls += 1;
              return "should never happen";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: false,
        reason: "Telegram user is not allowlisted",
      });
      expect(modelCalls).toBe(0);
      expect(reviewCalls).toBe(0);

      const outboxCount = db
        .prepare(`SELECT COUNT(*) AS count FROM outbox`)
        .get() as { count: number };

      expect(outboxCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("requires owner role for skill review commands even when identity is allowed", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle non-owner admin commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review-non-owner",
          text: "/skill_review skill-candidate-1",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          identityResolver() {
            return {
              allowed: true,
              channelIdentityId: "telegram:bot-main:456",
              personId: "person:telegram:456",
              familyId: "family-main",
              role: "adult_member",
            };
          },
          skillReview: {
            reviewCandidate() {
              reviewCalls += 1;
              return "should never happen";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: false,
        reason: "Owner role is required for skill management commands",
      });
      expect(modelCalls).toBe(0);
      expect(reviewCalls).toBe(0);

      const outboxCount = db
        .prepare(`SELECT COUNT(*) AS count FROM outbox`)
        .get() as { count: number };
      expect(outboxCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("accepts Telegram bot username suffixes on skill review commands", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          return "main should not handle skill review commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review-botname",
          text: "/skill_review@kxf_openpeach_bot skill-candidate-2",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate(candidateId) {
              reviewCalls += 1;
              expect(candidateId).toBe("skill-candidate-2");
              return "Skill candidate skill-candidate-2 is blocked.";
            },
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        replyText: "Skill candidate skill-candidate-2 is blocked.",
      });
      expect(reviewCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("queues a not-found reply for unknown skill candidates", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          return "main should not handle skill review commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review-missing",
          text: "/skill_review missing-candidate",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate(candidateId) {
              reviewCalls += 1;
              expect(candidateId).toBe("missing-candidate");
              return undefined;
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Skill candidate not found: missing-candidate",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-review-missing",
      });
      expect(reviewCalls).toBe(1);

      const outboxRow = db
        .prepare(
          `
            SELECT payload_json
            FROM outbox
            WHERE outbox_id = ?
          `,
        )
        .get(result.ok ? result.outboxId : "") as
        | { payload_json: string }
        | undefined;

      expect(JSON.parse(outboxRow?.payload_json ?? "null")).toMatchObject({
        text: "Skill candidate not found: missing-candidate",
        replyToMessageId: "tg-skill-review-missing",
      });
    } finally {
      db.close();
    }
  });

  it("returns skill review usage for incomplete commands without calling the model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      let reviewCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle incomplete admin commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-review-usage",
          text: "/skill_review",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate() {
              reviewCalls += 1;
              return "should never happen";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Usage: /skill_review <candidate_id>",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-review-usage",
      });
      expect(modelCalls).toBe(0);
      expect(reviewCalls).toBe(0);
    } finally {
      db.close();
    }
  });

  it("routes owner-only skill approval commands without calling the model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      let approveCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle skill approval commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-approve",
          text: "/skill_approve skill-candidate-risky reviewed by owner",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate() {
              return "review should not run";
            },
            approveCandidate(candidateId, input) {
              approveCalls += 1;
              expect(candidateId).toBe("skill-candidate-risky");
              expect(input).toEqual({
                reviewerIdentity: "telegram:456",
                reason: "reviewed by owner",
              });
              return "Skill candidate skill-candidate-risky approved.";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Skill candidate skill-candidate-risky approved.",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-approve",
      });
      expect(modelCalls).toBe(0);
      expect(approveCalls).toBe(1);

      const tasksCount = db
        .prepare(`SELECT COUNT(*) AS count FROM tasks`)
        .get() as { count: number };
      expect(tasksCount.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("routes owner-only skill rejection commands without calling the model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let rejectCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          return "main should not handle skill rejection commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-reject",
          text: "/skill_reject skill-candidate-risky too risky for home",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate() {
              return "review should not run";
            },
            rejectCandidate(candidateId, input) {
              rejectCalls += 1;
              expect(candidateId).toBe("skill-candidate-risky");
              expect(input).toEqual({
                reviewerIdentity: "telegram:456",
                reason: "too risky for home",
              });
              return "Skill candidate skill-candidate-risky rejected.";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Skill candidate skill-candidate-risky rejected.",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-reject",
      });
      expect(rejectCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  it("returns skill approval usage for incomplete commands without calling the model", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      let modelCalls = 0;
      const mainRuntime = createRuntime(repositories, {
        async complete() {
          modelCalls += 1;
          return "main should not handle incomplete approval commands";
        },
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-skill-approve-usage",
          text: "/skill_approve",
        }),
        deps: {
          config: {
            familyId: "family-main",
            ownerTelegramUserIds: ["456"],
          },
          repositories,
          runtime: mainRuntime,
          skillReview: {
            reviewCandidate() {
              return "review should not run";
            },
          },
        },
      });

      expect(result).toEqual({
        ok: true,
        replyText: "Usage: /skill_approve <candidate_id> [reason]",
        outboxId: "outbox:telegram:admin:bot-main:456:tg-skill-approve-usage",
      });
      expect(modelCalls).toBe(0);
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
