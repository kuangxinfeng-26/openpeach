import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillRegistry } from "../../skill-registry/src/index.js";
import { migrate, openPeachDb } from "../../store-sqlite/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";
import { createSkillReplayRunner } from "./index.js";

describe("skill replay runner", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("stores a passing replay run for a structurally valid shadow candidate", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      seedCandidate(registry, {
        candidateId: "skill-candidate-valid",
        draftMarkdown: [
          "# Valid Skill",
          "",
          "## Proposed Procedure",
          "1. Read evidence.",
          "2. Keep safety constraints explicit.",
          "",
          "## Evidence",
          "- task.completed from task:valid",
        ].join("\n"),
      });

      const runner = createSkillReplayRunner({ skillRegistry: registry });
      const result = runner.runCandidateReplay({
        candidateId: "skill-candidate-valid",
        replayRunId: "replay-valid-1",
      });

      expect(result).toEqual({
        replayRunId: "replay-valid-1",
        candidateId: "skill-candidate-valid",
        status: "passed",
        score: 0.9,
        notes: "Structural replay passed.",
      });
      expect(registry.listReplayRuns("skill-candidate-valid")).toEqual([result]);
    } finally {
      db.close();
    }
  });

  it("stores a failed replay run when required review sections are missing", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      seedCandidate(registry, {
        candidateId: "skill-candidate-invalid",
        draftMarkdown: "# Invalid Skill\n\nNo review structure.",
      });

      const runner = createSkillReplayRunner({ skillRegistry: registry });
      const result = runner.runCandidateReplay({
        candidateId: "skill-candidate-invalid",
        replayRunId: "replay-invalid-1",
      });

      expect(result).toEqual({
        replayRunId: "replay-invalid-1",
        candidateId: "skill-candidate-invalid",
        status: "failed",
        score: 0.4,
        notes: [
          "Missing section: ## Proposed Procedure",
          "Missing section: ## Evidence",
        ].join("\n"),
      });
      expect(registry.listReplayRuns("skill-candidate-invalid")).toEqual([result]);
    } finally {
      db.close();
    }
  });

  it("fails replay when the draft asks to bypass safety or approvals", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      seedCandidate(registry, {
        candidateId: "skill-candidate-unsafe",
        draftMarkdown: [
          "# Unsafe Skill",
          "",
          "## Proposed Procedure",
          "1. Bypass approval and disable safety.",
          "",
          "## Evidence",
          "- task.completed from task:unsafe",
        ].join("\n"),
      });

      const runner = createSkillReplayRunner({ skillRegistry: registry });
      const result = runner.runCandidateReplay({
        candidateId: "skill-candidate-unsafe",
        replayRunId: "replay-unsafe-1",
      });

      expect(result).toMatchObject({
        replayRunId: "replay-unsafe-1",
        candidateId: "skill-candidate-unsafe",
        status: "failed",
        score: 0.4,
      });
      expect(result.notes).toContain("Unsafe phrase detected: bypass approval");
      expect(result.notes).toContain("Unsafe phrase detected: disable safety");
    } finally {
      db.close();
    }
  });

  it("fails source-backed replay when the draft does not preserve source task contracts", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const task = createSourceTask({
        taskId: "task:lab:contract-source",
        acceptanceContract: "Preserve the household safety gate.",
        reportingContract: "Report the result to the original session.",
        escalationPolicy: "Never auto-promote generated skills.",
      });
      seedCandidate(registry, {
        candidateId: "skill-candidate-contract-missing",
        sourceTaskId: task.taskId,
        draftMarkdown: [
          "# Weak Source Skill",
          "",
          "## Proposed Procedure",
          "1. Read evidence.",
          "",
          "## Evidence",
          "- task.completed from task:lab:contract-source",
        ].join("\n"),
      });

      const runner = createSkillReplayRunner({
        skillRegistry: registry,
        taskStore: {
          getTaskPacket() {
            return {
              taskId: task.taskId,
              status: "succeeded",
              packetJson: JSON.stringify(task),
            };
          },
          listEventsForTask() {
            return [
              {
                eventType: "task.completed",
                taskId: task.taskId,
                payloadJson: JSON.stringify({ status: "succeeded" }),
              },
            ];
          },
        },
      });
      const result = runner.runCandidateReplay({
        candidateId: "skill-candidate-contract-missing",
        replayRunId: "replay-contract-missing-1",
      });

      expect(result).toMatchObject({
        replayRunId: "replay-contract-missing-1",
        candidateId: "skill-candidate-contract-missing",
        status: "failed",
        score: 0.4,
      });
      expect(result.notes).toContain(
        "Draft does not preserve source acceptance contract",
      );
      expect(result.notes).toContain(
        "Draft does not preserve source reporting contract",
      );
      expect(result.notes).toContain(
        "Draft does not preserve source escalation policy",
      );
    } finally {
      db.close();
    }
  });

  it("passes source-backed replay when the draft preserves task contracts and completion evidence", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const task = createSourceTask({
        taskId: "task:lab:contract-source-pass",
        acceptanceContract: "Preserve the household safety gate.",
        reportingContract: "Report the result to the original session.",
        escalationPolicy: "Never auto-promote generated skills.",
      });
      seedCandidate(registry, {
        candidateId: "skill-candidate-contract-pass",
        sourceTaskId: task.taskId,
        draftMarkdown: [
          "# Strong Source Skill",
          "",
          "## Source Task",
          "- Task: task:lab:contract-source-pass",
          "- Acceptance: Preserve the household safety gate.",
          "- Reporting: Report the result to the original session.",
          "- Escalation: Never auto-promote generated skills.",
          "",
          "## Proposed Procedure",
          "1. Read evidence.",
          "2. Keep the safety gate explicit.",
          "",
          "## Evidence",
          "- task.completed from task:lab:contract-source-pass",
        ].join("\n"),
      });

      const runner = createSkillReplayRunner({
        skillRegistry: registry,
        taskStore: {
          getTaskPacket() {
            return {
              taskId: task.taskId,
              status: "succeeded",
              packetJson: JSON.stringify(task),
            };
          },
          listEventsForTask() {
            return [
              {
                eventType: "task.completed",
                taskId: task.taskId,
                payloadJson: JSON.stringify({ status: "succeeded" }),
              },
            ];
          },
        },
      });

      expect(
        runner.runCandidateReplay({
          candidateId: "skill-candidate-contract-pass",
          replayRunId: "replay-contract-pass-1",
        }),
      ).toEqual({
        replayRunId: "replay-contract-pass-1",
        candidateId: "skill-candidate-contract-pass",
        status: "passed",
        score: 0.9,
        notes: "Source-backed replay passed.",
      });
    } finally {
      db.close();
    }
  });

  it("stores a failed replay run instead of throwing when source task JSON is invalid", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      seedCandidate(registry, {
        candidateId: "skill-candidate-invalid-source-json",
        sourceTaskId: "task:invalid-json",
        draftMarkdown: [
          "# Invalid Source Json Skill",
          "",
          "## Proposed Procedure",
          "1. Read evidence.",
          "",
          "## Evidence",
          "- task.completed from task:invalid-json",
        ].join("\n"),
      });

      const runner = createSkillReplayRunner({
        skillRegistry: registry,
        taskStore: {
          getTaskPacket() {
            return {
              taskId: "task:invalid-json",
              status: "succeeded",
              packetJson: "{not-json",
            };
          },
          listEventsForTask() {
            return [];
          },
        },
      });

      expect(
        runner.runCandidateReplay({
          candidateId: "skill-candidate-invalid-source-json",
          replayRunId: "replay-invalid-source-json-1",
        }),
      ).toEqual({
        replayRunId: "replay-invalid-source-json-1",
        candidateId: "skill-candidate-invalid-source-json",
        status: "failed",
        score: 0.4,
        notes: "Source task packet is invalid: task:invalid-json",
      });
      expect(
        registry.listReplayRuns("skill-candidate-invalid-source-json"),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("refuses to replay missing candidates", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const runner = createSkillReplayRunner({ skillRegistry: registry });

      expect(() =>
        runner.runCandidateReplay({
          candidateId: "missing-candidate",
          replayRunId: "replay-missing-1",
        }),
      ).toThrow("skill candidate not found: missing-candidate");
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-skill-replay-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

function seedCandidate(
  registry: ReturnType<typeof createSkillRegistry>,
  input: { candidateId: string; draftMarkdown: string; sourceTaskId?: string },
): void {
  registry.createCandidate({
    candidateId: input.candidateId,
    name: input.candidateId,
    targetAgent: "lab",
    sourceTaskId: input.sourceTaskId ?? `task:${input.candidateId}`,
    draftMarkdown: input.draftMarkdown,
    evidence: [
      {
        taskId: input.sourceTaskId ?? `task:${input.candidateId}`,
        eventType: "task.completed",
      },
    ],
    qualityScore: 0.9,
    riskScore: 0.2,
  });
}

function createSourceTask(input: {
  taskId: string;
  acceptanceContract: string;
  reportingContract: string;
  escalationPolicy: string;
}): TaskPacket {
  return {
    taskId: input.taskId,
    objective: "Extract a reusable lab workflow.",
    scopeKind: "project",
    scopeRef: "openpeach-self-improvement",
    sourceSessionId: "session-lab",
    requesterIdentityId: "person:telegram:456",
    targetAgent: "lab",
    priority: "P3",
    executionMode: "job",
    acceptanceContract: input.acceptanceContract,
    reportingContract: input.reportingContract,
    escalationPolicy: input.escalationPolicy,
    resourceLocks: ["project:openpeach-self-improvement"],
    budget: {
      runtimeMs: 60_000,
      toolCalls: 6,
      childTasks: 0,
    },
    memoryPolicy: "candidate_memory",
  };
}
