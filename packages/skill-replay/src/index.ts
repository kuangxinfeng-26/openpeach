import type {
  SkillCandidate,
  SkillReplayRun,
  SkillReplayRunInput,
} from "../../skill-registry/src/index.js";
import { TaskPacketSchema } from "../../task-engine/src/index.js";

export type SkillReplayRunnerDeps = {
  skillRegistry: {
    createReplayRun(input: SkillReplayRunInput): void;
    getCandidate(candidateId: string): SkillCandidate | undefined;
  };
  taskStore?: {
    getTaskPacket(taskId: string):
      | {
          taskId: string;
          status: string;
          packetJson: string;
        }
      | undefined;
    listEventsForTask(taskId: string): Array<{
      eventType: string;
      taskId?: string;
      payloadJson: string;
    }>;
  };
};

export function createSkillReplayRunner(deps: SkillReplayRunnerDeps) {
  return {
    runCandidateReplay(input: {
      candidateId: string;
      replayRunId: string;
    }): SkillReplayRun {
      const candidate = deps.skillRegistry.getCandidate(input.candidateId);
      if (!candidate) {
        throw new Error(`skill candidate not found: ${input.candidateId}`);
      }

      const replayFindings = evaluateDraft(candidate, deps.taskStore);
      const replayRun: SkillReplayRun = {
        replayRunId: input.replayRunId,
        candidateId: input.candidateId,
        status: replayFindings.findings.length === 0 ? "passed" : "failed",
        score: replayFindings.findings.length === 0 ? 0.9 : 0.4,
        notes:
          replayFindings.findings.length === 0
            ? replayFindings.passNotes
            : replayFindings.findings.join("\n"),
      };
      deps.skillRegistry.createReplayRun(replayRun);

      return replayRun;
    },
  };
}

function evaluateDraft(
  candidate: SkillCandidate,
  taskStore: SkillReplayRunnerDeps["taskStore"],
): { findings: string[]; passNotes: string } {
  const findings: string[] = [];
  const markdown = candidate.draftMarkdown;
  for (const section of ["## Proposed Procedure", "## Evidence"]) {
    if (!markdown.includes(section)) {
      findings.push(`Missing section: ${section}`);
    }
  }

  const lower = markdown.toLowerCase();
  for (const phrase of ["bypass approval", "disable safety"]) {
    if (lower.includes(phrase)) {
      findings.push(`Unsafe phrase detected: ${phrase}`);
    }
  }

  if (!taskStore || !candidate.sourceTaskId) {
    return { findings, passNotes: "Structural replay passed." };
  }

  const sourceTask = taskStore.getTaskPacket(candidate.sourceTaskId);
  if (!sourceTask) {
    findings.push(`Source task not found: ${candidate.sourceTaskId}`);
    return { findings, passNotes: "Source-backed replay passed." };
  }

  let sourceTaskPacket: unknown;
  try {
    sourceTaskPacket = JSON.parse(sourceTask.packetJson);
  } catch {
    findings.push(`Source task packet is invalid: ${candidate.sourceTaskId}`);
    return { findings, passNotes: "Source-backed replay passed." };
  }

  const taskPacketResult = TaskPacketSchema.safeParse(sourceTaskPacket);
  if (!taskPacketResult.success) {
    findings.push(`Source task packet is invalid: ${candidate.sourceTaskId}`);
    return { findings, passNotes: "Source-backed replay passed." };
  }

  const task = taskPacketResult.data;
  const normalizedMarkdown = normalize(markdown);
  if (!normalizedMarkdown.includes(normalize(task.taskId))) {
    findings.push("Draft does not cite source task id");
  }
  if (!normalizedMarkdown.includes(normalize(task.acceptanceContract))) {
    findings.push("Draft does not preserve source acceptance contract");
  }
  if (!normalizedMarkdown.includes(normalize(task.reportingContract))) {
    findings.push("Draft does not preserve source reporting contract");
  }
  if (!normalizedMarkdown.includes(normalize(task.escalationPolicy))) {
    findings.push("Draft does not preserve source escalation policy");
  }

  const sourceEvents = taskStore.listEventsForTask(candidate.sourceTaskId);
  const hasCompletedEvent = sourceEvents.some(
    (event) => event.eventType === "task.completed",
  );
  if (!hasCompletedEvent) {
    findings.push("Source task has no completed event evidence");
  }
  if (
    !candidate.evidence.some(
      (item) =>
        item.taskId === candidate.sourceTaskId &&
        item.eventType === "task.completed",
    )
  ) {
    findings.push("Candidate evidence does not cite source task completion");
  }

  return { findings, passNotes: "Source-backed replay passed." };
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
