import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import { createSkillRegistry } from "../../skill-registry/src/index.js";
import { migrate, openPeachDb } from "../../store-sqlite/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";
import { createSkillEvolutionEngine } from "./index.js";

describe("skill evolution engine", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("creates a shadow skill candidate from a completed lab task trace", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const engine = createSkillEvolutionEngine({ skillRegistry: registry });
      const task = createLabTask({
        taskId: "task:lab:skill-proposal",
        objective: "Extract a reusable bedtime story toy workflow",
      });

      const result = engine.proposeFromCompletedTask({
        task,
        events: [
          {
            type: "task.completed",
            sessionId: "session-lab",
            taskId: task.taskId,
            payload: { status: "succeeded" },
          },
        ],
      });

      expect(result).toEqual({
        created: true,
        candidateId: "skill-candidate:task:lab:skill-proposal",
      });
      expect(registry.getCandidate(result.candidateId)).toEqual({
        candidateId: "skill-candidate:task:lab:skill-proposal",
        name: "extract-a-reusable-bedtime-story-toy-workflow",
        targetAgent: "lab",
        sourceTaskId: "task:lab:skill-proposal",
        status: "shadow",
        draftMarkdown: [
          "# Extract a reusable bedtime story toy workflow",
          "",
          "## Source Task",
          "- Task: task:lab:skill-proposal",
          "- Scope: project / D:/AI-toy",
          "- Acceptance: Identify reusable procedure from the completed lab task.",
          "- Reporting: Store as a shadow skill candidate for owner review.",
          "- Escalation: Never auto-promote generated skills.",
          "",
          "## Proposed Procedure",
          "1. Re-read the source task objective and artifacts.",
          "2. Extract only repeatable, family-safe steps.",
          "3. Keep assumptions explicit and preserve links to evidence.",
          "4. Run replay checks before promotion.",
          "",
          "## Evidence",
          "- task.completed from task:lab:skill-proposal",
        ].join("\n"),
        evidence: [
          {
            taskId: "task:lab:skill-proposal",
            eventType: "task.completed",
          },
        ],
        qualityScore: 0.82,
        riskScore: 0.45,
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent for repeated completed lab task traces", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const engine = createSkillEvolutionEngine({ skillRegistry: registry });
      const task = createLabTask({
        taskId: "task:lab:repeat",
        objective: "Summarize a repeatable skill workflow",
      });
      const events: OpenPeachEvent[] = [
        {
          type: "task.completed",
          sessionId: "session-lab",
          taskId: task.taskId,
          payload: { status: "succeeded" },
        },
      ];

      expect(engine.proposeFromCompletedTask({ task, events })).toEqual({
        created: true,
        candidateId: "skill-candidate:task:lab:repeat",
      });
      expect(engine.proposeFromCompletedTask({ task, events })).toEqual({
        created: false,
        candidateId: "skill-candidate:task:lab:repeat",
        reason: "candidate_already_exists",
      });
    } finally {
      db.close();
    }
  });

  it("skips non-lab tasks and lab tasks that are not candidate-memory eligible", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const engine = createSkillEvolutionEngine({ skillRegistry: registry });

      expect(
        engine.proposeFromCompletedTask({
          task: {
            ...createLabTask({
              taskId: "task:main:chat",
              objective: "Chat normally",
            }),
            targetAgent: "main",
          },
          events: [],
        }),
      ).toEqual({
        created: false,
        reason: "not_lab_task",
      });

      expect(
        engine.proposeFromCompletedTask({
          task: {
            ...createLabTask({
              taskId: "task:lab:session-only",
              objective: "Do one-off lab work",
            }),
            memoryPolicy: "session_only",
          },
          events: [
            {
              type: "task.completed",
              sessionId: "session-lab",
              taskId: "task:lab:session-only",
              payload: { status: "succeeded" },
            },
          ],
        }),
      ).toEqual({
        created: false,
        reason: "not_candidate_memory",
      });
    } finally {
      db.close();
    }
  });

  it("skips lab tasks without completion evidence", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const engine = createSkillEvolutionEngine({ skillRegistry: registry });
      const task = createLabTask({
        taskId: "task:lab:unfinished",
        objective: "Draft but do not finish",
      });

      expect(
        engine.proposeFromCompletedTask({
          task,
          events: [
            {
              type: "task.failed",
              sessionId: "session-lab",
              taskId: task.taskId,
              payload: { reason: "not enough evidence" },
            },
          ],
        }),
      ).toEqual({
        created: false,
        reason: "missing_completion_evidence",
      });
      expect(registry.getCandidate("skill-candidate:task:lab:unfinished")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-skill-evolution-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

function createLabTask(input: {
  taskId: string;
  objective: string;
}): TaskPacket {
  return {
    taskId: input.taskId,
    objective: input.objective,
    scopeKind: "project",
    scopeRef: "D:/AI-toy",
    sourceSessionId: "session-lab",
    requesterIdentityId: "person:telegram:456",
    targetAgent: "lab",
    priority: "P3",
    executionMode: "job",
    acceptanceContract: "Identify reusable procedure from the completed lab task.",
    reportingContract: "Store as a shadow skill candidate for owner review.",
    escalationPolicy: "Never auto-promote generated skills.",
    resourceLocks: ["project:D:/AI-toy"],
    budget: {
      runtimeMs: 60_000,
      toolCalls: 4,
      childTasks: 0,
    },
    memoryPolicy: "candidate_memory",
  };
}
