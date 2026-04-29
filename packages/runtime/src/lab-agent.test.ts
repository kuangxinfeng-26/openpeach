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
import { LabAgentRuntime } from "./lab-agent.js";

describe("LabAgentRuntime", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("handles a lab task and emits completion evidence for skill evolution", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const session = getOrCreateSession(repositories, {
        familyId: "family-main",
        coreAgentId: "lab",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        threadId: "dm",
        scene: "default",
      });
      const envelope = createEnvelope({
        text: "lab: turn this task trace into a reusable skill",
        messageId: "tg-lab-1",
      });
      const decision = admitTask({
        text: envelope.text,
        sessionId: session.sessionId,
        messageId: envelope.messageId,
        requesterIdentity: { role: "owner", allowed: true, personId: "owner-1" },
      });

      expect(decision.task).toBeDefined();
      expect(decision.task?.targetAgent).toBe("lab");

      const events: OpenPeachEvent[] = [];
      const runtime = new LabAgentRuntime({
        repositories,
        model: {
          async complete(messages) {
            expect(messages[0]?.content).toContain("OpenPeach lab agent");
            expect(messages[1]?.content).toContain("lab: turn this task trace");
            return "I extracted the reusable workflow as a reviewable lab result.";
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
        replyText: "I extracted the reusable workflow as a reviewable lab result.",
        outboxId: `outbox:telegram:${session.sessionId}:tg-lab-1`,
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
          payload: { objective: "lab: turn this task trace into a reusable skill" },
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
          payload: { outboxId: `outbox:telegram:${session.sessionId}:tg-lab-1` },
        },
      ]);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-lab-runtime-"));
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
