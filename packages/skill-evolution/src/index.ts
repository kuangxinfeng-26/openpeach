import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import type {
  SkillCandidate,
  SkillCandidateInput,
} from "../../skill-registry/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";

export type SkillEvolutionResult =
  | { created: true; candidateId: string }
  | {
      created: false;
      candidateId?: string;
      reason:
        | "not_lab_task"
        | "not_candidate_memory"
        | "missing_completion_evidence"
        | "candidate_already_exists";
    };

export type SkillEvolutionDeps = {
  skillRegistry: {
    createCandidate(input: SkillCandidateInput): void;
    getCandidate(candidateId: string): SkillCandidate | undefined;
  };
};

export function createSkillEvolutionEngine(deps: SkillEvolutionDeps) {
  return {
    proposeFromCompletedTask(input: {
      task: TaskPacket;
      events: OpenPeachEvent[];
    }): SkillEvolutionResult {
      if (input.task.targetAgent !== "lab") {
        return { created: false, reason: "not_lab_task" };
      }
      if (input.task.memoryPolicy === "session_only") {
        return { created: false, reason: "not_candidate_memory" };
      }

      const evidence = collectEvidence(input.task, input.events);
      if (!evidence.some((item) => item.eventType === "task.completed")) {
        return { created: false, reason: "missing_completion_evidence" };
      }

      const candidateId = `skill-candidate:${input.task.taskId}`;
      if (deps.skillRegistry.getCandidate(candidateId)) {
        return {
          created: false,
          candidateId,
          reason: "candidate_already_exists",
        };
      }

      deps.skillRegistry.createCandidate({
        candidateId,
        name: slugify(input.task.objective),
        targetAgent: "lab",
        sourceTaskId: input.task.taskId,
        draftMarkdown: renderDraftMarkdown(input.task, evidence),
        evidence,
        qualityScore: 0.82,
        riskScore: 0.45,
      });

      return { created: true, candidateId };
    },
  };
}

function collectEvidence(
  task: TaskPacket,
  events: OpenPeachEvent[],
): Array<{ taskId: string; eventType: string }> {
  return events
    .filter((event) => "taskId" in event && event.taskId === task.taskId)
    .filter((event) => event.type === "task.completed")
    .map((event) => ({
      taskId: event.taskId,
      eventType: event.type,
    }));
}

function renderDraftMarkdown(
  task: TaskPacket,
  evidence: Array<{ taskId: string; eventType: string }>,
): string {
  return [
    `# ${task.objective}`,
    "",
    "## Source Task",
    `- Task: ${task.taskId}`,
    `- Scope: ${task.scopeKind} / ${task.scopeRef}`,
    `- Acceptance: ${task.acceptanceContract}`,
    `- Reporting: ${task.reportingContract}`,
    `- Escalation: ${task.escalationPolicy}`,
    "",
    "## Proposed Procedure",
    "1. Re-read the source task objective and artifacts.",
    "2. Extract only repeatable, family-safe steps.",
    "3. Keep assumptions explicit and preserve links to evidence.",
    "4. Run replay checks before promotion.",
    "",
    "## Evidence",
    ...evidence.map((item) => `- ${item.eventType} from ${item.taskId}`),
  ].join("\n");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "lab-skill-candidate";
}
