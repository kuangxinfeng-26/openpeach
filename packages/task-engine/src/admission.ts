import { randomUUID } from "node:crypto";
import { parseDeviceIntent } from "./device-intent.js";
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
  enabledDeviceIds?: string[];
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
  const route = resolveTaskRoute(objective, {
    enabledDeviceIds: input.enabledDeviceIds,
  });
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
    priority: route.targetAgent === "home" ? "P1" : route.targetAgent === "lab" ? "P3" : "P0",
    executionMode: route.targetAgent === "home"
      ? "microtask"
      : route.targetAgent === "lab"
        ? "job"
        : "turn",
    acceptanceContract: route.targetAgent === "home"
      ? "Read or safely control the requested household device."
      : route.targetAgent === "lab"
        ? "Analyze the project or self-improvement request and extract reusable procedure candidates."
        : "Respond to the current private conversation turn.",
    reportingContract: "Return the answer in the source session.",
    escalationPolicy: route.targetAgent === "home"
      ? "Require confirmation for high-risk home actions."
      : route.targetAgent === "lab"
        ? "Keep generated skills in shadow status until replay and owner review pass."
        : "Deny unsupported fan-out in Phase 0.",
    resourceLocks: route.scopeRef
      ? [route.targetAgent === "home" ? `device:${route.scopeRef}` : `project:${route.scopeRef}`]
      : [],
    budget: {
      runtimeMs: route.targetAgent === "home" ? 10_000 : route.targetAgent === "lab" ? 60_000 : 30_000,
      toolCalls: route.targetAgent === "home" ? 2 : route.targetAgent === "lab" ? 6 : 8,
      childTasks: 0,
    },
    memoryPolicy: route.targetAgent === "lab" ? "candidate_memory" : "session_only",
  });

  return {
    admitted: true,
    executionMode: task.executionMode,
    task,
  };
}

export type TaskRoute = {
  targetAgent: "main" | "home" | "lab";
  scopeKind: "conversation" | "device" | "project";
  scopeRef?: string;
};

export function resolveTaskRoute(
  text: string,
  options: { enabledDeviceIds?: string[] } = {},
): TaskRoute {
  if (detectLabIntent(text)) {
    return {
      targetAgent: "lab",
      scopeKind: "project",
      scopeRef: "openpeach-self-improvement",
    };
  }

  const deviceIntent = detectDeviceIntent(text);
  if (deviceIntent && isDeviceEnabled(deviceIntent.deviceId, options.enabledDeviceIds)) {
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

function detectLabIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.startsWith("lab:") ||
    normalized.includes("reusable skill") ||
    normalized.includes("self-improvement") ||
    normalized.includes("skill candidate") ||
    normalized.includes("github idea") ||
    normalized.includes("ai toy project")
  );
}

function scopedTaskId(sessionId: string, rawId: string | undefined): string {
  if (!rawId) {
    return randomUUID();
  }

  return `task:${sessionId}:${rawId}`;
}

function detectDeviceIntent(text: string): { deviceId: string } | undefined {
  return parseDeviceIntent(text);
}

function isDeviceEnabled(
  deviceId: string,
  enabledDeviceIds: string[] | undefined,
): boolean {
  const defaultDeviceIds = new Set(["mock:living-room-lamp", "mock:front-camera"]);
  return defaultDeviceIds.has(deviceId) || (enabledDeviceIds ?? []).includes(deviceId);
}
