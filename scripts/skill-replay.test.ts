import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillRegistry } from "../packages/skill-registry/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../packages/store-sqlite/src/index.js";
import type { TaskPacket } from "../packages/task-engine/src/index.js";
import {
  formatSkillReplayJson,
  runSkillReplayCli,
  runSkillReplayOnCandidate,
} from "./skill-replay.js";

describe("skill replay CLI", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("runs replay and prints stable JSON", () => {
    const dbPath = seedReplayCandidate();

    expect(
      formatSkillReplayJson(
        runSkillReplayOnCandidate({
          dbPath,
          candidateId: "skill-candidate-replay-cli",
          replayRunId: "replay-cli-1",
        }),
      ),
    ).toBe(
      [
        "{",
        '  "replayRunId": "replay-cli-1",',
        '  "candidateId": "skill-candidate-replay-cli",',
        '  "status": "passed",',
        '  "score": 0.9,',
        '  "notes": "Source-backed replay passed."',
        "}",
      ].join("\n"),
    );

    const db = openPeachDb(dbPath);
    try {
      expect(createSkillRegistry(db).listReplayRuns("skill-candidate-replay-cli")).toEqual([
        {
          replayRunId: "replay-cli-1",
          candidateId: "skill-candidate-replay-cli",
          status: "passed",
          score: 0.9,
          notes: "Source-backed replay passed.",
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("returns exit code 2 when the candidate is missing", () => {
    const dbPath = seedReplayCandidate();
    const stderr: string[] = [];

    expect(
      runSkillReplayCli({
        argv: ["missing-candidate", "--run-id", "replay-missing"],
        env: { TAOQIBAO_STATE_DB: dbPath },
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(2);
    expect(stderr.join("\n")).toContain(
      "skill candidate not found: missing-candidate",
    );
  });

  it("returns exit code 1 when required arguments are missing", () => {
    const stderr: string[] = [];

    expect(
      runSkillReplayCli({
        argv: [],
        env: {},
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(1);
    expect(stderr.join("\n")).toContain(
      "Usage: npm run skill:replay -- <candidate_id>",
    );
  });

  it("returns exit code 1 for unknown options without throwing", () => {
    const stderr: string[] = [];

    expect(
      runSkillReplayCli({
        argv: ["--unknown"],
        env: {},
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(1);
    expect(stderr.join("\n")).toContain("Unknown option: --unknown");
  });

  function seedReplayCandidate(): string {
    dir = mkdtempSync(join(tmpdir(), "openpeach-skill-replay-cli-"));
    const dbPath = join(dir, "state.db");
    const db = openPeachDb(dbPath);

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const task = createReplayTask();
      repositories.createTask(task, "created");
      repositories.createTask(task, "admitted");
      repositories.updateTaskStatus(task.taskId, "running");
      repositories.updateTaskStatus(task.taskId, "succeeded");
      repositories.insertEvent({
        eventId: "event-replay-cli-task-completed",
        eventType: "task.completed",
        taskId: task.taskId,
        sessionId: task.sourceSessionId,
        payloadJson: JSON.stringify({ status: "succeeded" }),
        createdAtMs: 1_710_000_000_100,
      });
      createSkillRegistry(db).createCandidate({
        candidateId: "skill-candidate-replay-cli",
        name: "skill-candidate-replay-cli",
        targetAgent: "lab",
        sourceTaskId: task.taskId,
        draftMarkdown: [
          "# Replay CLI Skill",
          "",
          "## Source Task",
          `- Task: ${task.taskId}`,
          `- Acceptance: ${task.acceptanceContract}`,
          `- Reporting: ${task.reportingContract}`,
          `- Escalation: ${task.escalationPolicy}`,
          "",
          "## Proposed Procedure",
          "1. Inspect the source task.",
          "",
          "## Evidence",
          `- task.completed from ${task.taskId}`,
        ].join("\n"),
        evidence: [{ taskId: task.taskId, eventType: "task.completed" }],
        qualityScore: 0.9,
        riskScore: 0.2,
      });
    } finally {
      db.close();
    }

    return dbPath;
  }
});

function createReplayTask(): TaskPacket {
  return {
    taskId: "task-replay-cli",
    objective: "Replay a generated skill candidate against its task trace.",
    scopeKind: "project",
    scopeRef: "openpeach-self-improvement",
    sourceSessionId: "session-replay-cli",
    requesterIdentityId: "person:telegram:456",
    targetAgent: "lab",
    priority: "P3",
    executionMode: "job",
    acceptanceContract: "Replay must preserve source task safety requirements.",
    reportingContract: "Return replay results as stable JSON.",
    escalationPolicy: "Never auto-promote generated skills.",
    resourceLocks: ["project:openpeach-self-improvement"],
    budget: {
      runtimeMs: 60_000,
      toolCalls: 6,
      childTasks: 0,
    },
    memoryPolicy: "candidate_memory",
  };
}
