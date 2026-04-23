import { randomUUID } from "node:crypto";
import { TaskPacketSchema, type TaskPacket } from "./task-packet.js";

export type RequesterIdentity = {
  role: "owner" | "unknown" | string;
  allowed?: boolean;
  channelIdentityId?: string;
  personId?: string;
};

export type AdmitTaskInput = {
  text: string;
  sessionId: string;
  taskId?: string;
  idempotencyKey?: string;
  messageId?: string;
  requesterIdentity: RequesterIdentity;
};

export type AdmissionDecision = {
  admitted: boolean;
  reason?: string;
  executionMode?: TaskPacket["executionMode"];
  task?: TaskPacket;
};

export function admitTask(input: AdmitTaskInput): AdmissionDecision {
  const objective = input.text.trim();
  if (objective.length === 0) {
    return {
      admitted: false,
      reason: "Task denied because text is empty or whitespace",
    };
  }

  if (
    input.requesterIdentity.allowed === false ||
    input.requesterIdentity.role !== "owner"
  ) {
    return {
      admitted: false,
      reason: "Task denied for unknown or unauthorized requester",
    };
  }

  const requesterIdentityId =
    input.requesterIdentity.personId ??
    input.requesterIdentity.channelIdentityId ??
    "owner";
  const task = TaskPacketSchema.parse({
    taskId: input.taskId ?? input.messageId ?? input.idempotencyKey ?? randomUUID(),
    objective,
    scopeKind: "conversation",
    scopeRef: input.sessionId,
    sourceSessionId: input.sessionId,
    requesterIdentityId,
    targetAgent: "main",
    priority: "P0",
    executionMode: "turn",
    acceptanceContract: "Respond to the current private conversation turn.",
    reportingContract: "Return the answer in the source session.",
    escalationPolicy: "Deny unsupported fan-out in Phase 0.",
    resourceLocks: [],
    budget: {
      runtimeMs: 30_000,
      toolCalls: 8,
      childTasks: 0,
    },
    memoryPolicy: "session_only",
  });

  return {
    admitted: true,
    executionMode: task.executionMode,
    task,
  };
}
