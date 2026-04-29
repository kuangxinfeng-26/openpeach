import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LabAgentRuntime, MainAgentRuntime } from "../../../packages/runtime/src/index.js";
import { createSkillEvolutionEngine } from "../../../packages/skill-evolution/src/index.js";
import { createSkillRegistry } from "../../../packages/skill-registry/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../../packages/store-sqlite/src/index.js";
import { handleHumanEnvelope } from "./pipeline.js";
import { createGatewayEventPublisher } from "./evolution-publisher.js";
import type { HumanEnvelope } from "../../../packages/envelope/src/index.js";

describe("gateway skill evolution publisher", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("creates a shadow skill candidate from a real lab pipeline turn", async () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const skillRegistry = createSkillRegistry(db);
      const publishEvent = createGatewayEventPublisher({
        repositories,
        skillEvolution: createSkillEvolutionEngine({ skillRegistry }),
        createEventId: () => randomUUID(),
        nowMs: () => 1_710_000_000_100,
      });
      const mainRuntime = new MainAgentRuntime({
        repositories,
        model: {
          async complete() {
            return "main should not handle lab work";
          },
        },
        emit: publishEvent,
      });
      const labRuntime = new LabAgentRuntime({
        repositories,
        model: {
          async complete() {
            return "Lab captured this as a reviewable skill candidate.";
          },
        },
        emit: publishEvent,
      });

      const result = await handleHumanEnvelope({
        envelope: createEnvelope({
          messageId: "tg-lab-evolution",
          text: "lab: convert this repeatable workflow into a skill candidate",
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

      expect(result).toMatchObject({
        ok: true,
        replyText: "Lab captured this as a reviewable skill candidate.",
      });

      const taskRow = db
        .prepare(
          `
            SELECT task_id
            FROM tasks
            WHERE target_agent = 'lab'
          `,
        )
        .get() as { task_id: string } | undefined;
      expect(taskRow?.task_id).toBeDefined();

      const candidate = skillRegistry.getCandidate(
        `skill-candidate:${taskRow?.task_id}`,
      );
      expect(candidate).toMatchObject({
        candidateId: `skill-candidate:${taskRow?.task_id}`,
        targetAgent: "lab",
        status: "shadow",
        sourceTaskId: taskRow?.task_id,
        qualityScore: 0.82,
        riskScore: 0.45,
      });
      expect(candidate?.draftMarkdown).toContain("## Proposed Procedure");
      expect(candidate?.draftMarkdown).toContain("## Evidence");
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-gateway-evolution-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

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
