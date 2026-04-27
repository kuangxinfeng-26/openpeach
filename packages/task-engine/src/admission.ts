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

  if (input.requesterIdentity.allowed !== true) {
    return {
      admitted: false,
      reason: "Task denied because requester was not allowlisted",
    };
  }

  if (input.requesterIdentity.role !== "owner") {
    return {
      admitted: false,
      reason: "Task denied for unknown or unauthorized requester",
    };
  }

  const requesterIdentityId =
    input.requesterIdentity.personId ??
    input.requesterIdentity.channelIdentityId ??
    "owner";
  const route = resolveTaskRoute(objective);
  const task = TaskPacketSchema.parse({
    taskId:
      input.taskId ??
      scopedTaskId(input.sessionId, input.messageId ?? input.idempotencyKey),
    objective,
    scopeKind: route.scopeKind,
    scopeRef: route.scopeRef ?? input.sessionId,
    sourceSessionId: input.sessionId,
    requesterIdentityId,
    targetAgent: route.targetAgent,
    priority: route.targetAgent === "home" ? "P1" : "P0",
    executionMode: route.targetAgent === "home" ? "microtask" : "turn",
    acceptanceContract: route.targetAgent === "home"
      ? "Read or safely control the requested household device."
      : "Respond to the current private conversation turn.",
    reportingContract: "Return the answer in the source session.",
    escalationPolicy: route.targetAgent === "home"
      ? "Require confirmation for high-risk home actions."
      : "Deny unsupported fan-out in Phase 0.",
    resourceLocks: route.scopeRef ? [`device:${route.scopeRef}`] : [],
    budget: {
      runtimeMs: route.targetAgent === "home" ? 10_000 : 30_000,
      toolCalls: route.targetAgent === "home" ? 2 : 8,
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

export type TaskRoute = {
  targetAgent: "main" | "home";
  scopeKind: "conversation" | "device";
  scopeRef?: string;
};

export function resolveTaskRoute(text: string): TaskRoute {
  const deviceIntent = detectDeviceIntent(text);
  if (deviceIntent) {
    return {
      targetAgent: "home",
      scopeKind: "device",
      scopeRef: deviceIntent.deviceId,
    };
  }

  return {
    targetAgent: "main",
    scopeKind: "conversation",
  };
}

function scopedTaskId(sessionId: string, rawId: string | undefined): string {
  if (!rawId) {
    return randomUUID();
  }

  return `task:${sessionId}:${rawId}`;
}

function detectDeviceIntent(text: string): { deviceId: string } | undefined {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("living room lamp") ||
    normalized.includes("living room light") ||
    normalized.includes("\u5ba2\u5385\u706f")
  ) {
    return { deviceId: "mock:living-room-lamp" };
  }

  if (
    normalized.includes("camera") ||
    normalized.includes("recording") ||
    normalized.includes("\u6444\u50cf\u5934")
  ) {
    return { deviceId: "mock:front-camera" };
  }

  return undefined;
}
