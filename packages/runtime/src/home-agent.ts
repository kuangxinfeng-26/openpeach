import type {
  DeviceAdapter,
  DeviceActionRisk,
  DeviceCommandResult,
  DeviceState,
} from "../../device-adapter/src/index.js";
import { evaluateDeviceActionPolicy } from "../../device-adapter/src/index.js";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import type { SessionContext } from "../../session-kernel/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";

export type HomeAgentRuntimeDeps = {
  repositories: HomeAgentRepositories;
  deviceAdapter: DeviceAdapter;
  emit: (event: OpenPeachEvent) => void;
};

export type HomeAgentRequester = {
  role: string;
};

export class HomeAgentRuntime {
  constructor(private readonly deps: HomeAgentRuntimeDeps) {}

  async handleTurn(input: HomeAgentTurnInput): Promise<{
    replyText: string;
    outboxId: string;
  }> {
    const { envelope, session, task, requester } = input;
    const userMessageKey = userMessageId(session.sessionId, envelope.messageId);
    const assistantMessageKey = assistantMessageId(
      session.sessionId,
      envelope.messageId,
    );
    let taskCreated = false;

    try {
      this.appendMessageIfMissing({
        messageId: userMessageKey,
        sessionId: session.sessionId,
        role: "user",
        text: envelope.text,
        timestampMs: envelope.timestampMs,
      });
      this.ensureTaskPrepared(task);
      taskCreated = true;

      const existingAssistantMessage =
        this.deps.repositories.getMessageById(assistantMessageKey);
      const existingTask = this.deps.repositories.getTask(task.taskId);
      if (
        existingAssistantMessage?.sessionId === session.sessionId &&
        isReplayableStatus(existingTask?.status)
      ) {
        return this.queueExistingReply({
          envelope,
          session,
          task,
          replyText: existingAssistantMessage.text,
        });
      }

      this.ensureTaskRunning(task.taskId);
      this.deps.emit({
        type: "task.created",
        sessionId: session.sessionId,
        taskId: task.taskId,
        payload: { objective: task.objective },
      });

      const plan = await this.planDeviceAction(task, envelope.text);
      const policy = evaluateDeviceActionPolicy({
        requesterRole: requester.role,
        risk: plan.risk,
      });

      let replyText: string;
      let finalTaskStatus:
        | "awaiting_confirmation"
        | "succeeded"
        | "failed"
        | undefined;
      if (policy.decision === "requires_confirmation") {
        this.recordConfirmationRequired({
          session,
          task,
          deviceId: task.scopeRef,
          action: plan.action,
          reason: policy.reason,
        });
        replyText = `${plan.displayName} ${plan.action} needs confirmation before OpenPeach executes it. Reply "confirm task:${task.taskId}" to continue.`;
        finalTaskStatus = "awaiting_confirmation";
      } else if (policy.decision === "deny") {
        replyText = policy.reason;
        finalTaskStatus = "failed";
      } else if (plan.action === "read_state") {
        const state = await this.deps.deviceAdapter.readState(task.scopeRef);
        this.recordStateRead({ session, task, state });
        replyText = formatStateReply(plan.displayName, state);
        finalTaskStatus = "succeeded";
      } else {
        const result = await this.deps.deviceAdapter.executeCommand({
          commandId: `device-command:${task.taskId}:${plan.action}`,
          deviceId: task.scopeRef,
          action: plan.action,
        });
        this.recordCommandAcknowledged({ session, task, result });
        replyText = formatCommandReply(plan.displayName, result);
        finalTaskStatus = "succeeded";
      }

      this.appendMessageIfMissing({
        messageId: assistantMessageKey,
        sessionId: session.sessionId,
        role: "assistant",
        text: replyText,
        timestampMs: envelope.timestampMs,
      });

      const outboxId = outboxMessageId(session.sessionId, envelope.messageId);
      this.deps.repositories.insertOutboxOnce({
        outboxId,
        idempotencyKey: `telegram:reply:${session.sessionId}:${envelope.messageId}`,
        channel: "telegram",
        targetRef: envelope.chatId,
        payloadJson: JSON.stringify({
          chatId: envelope.chatId,
          text: replyText,
          replyToMessageId: envelope.messageId,
        }),
      });

      this.markFinalTaskStatus(task.taskId, finalTaskStatus);
      const currentTask = this.deps.repositories.getTask(task.taskId);
      if (currentTask?.status === "succeeded") {
        this.deps.emit({
          type: "task.completed",
          sessionId: session.sessionId,
          taskId: task.taskId,
          payload: { status: "succeeded" },
        });
      }
      this.deps.emit({
        type: "reply.queued",
        sessionId: session.sessionId,
        taskId: task.taskId,
        payload: { outboxId },
      });

      return {
        replyText,
        outboxId,
      };
    } catch (error) {
      if (taskCreated) {
        this.markTaskFailed(task.taskId);
        this.deps.emit({
          type: "task.failed",
          sessionId: session.sessionId,
          taskId: task.taskId,
          payload: { reason: toErrorMessage(error) },
        });
      }

      throw error;
    }
  }

  async confirmAwaitingDeviceAction(
    input: HomeAgentConfirmationInput,
  ): Promise<{ replyText: string; outboxId: string }> {
    const taskRecord = this.deps.repositories.getTaskPacket(input.confirmationTaskId);
    if (!taskRecord) {
      throw new Error(`task not found: ${input.confirmationTaskId}`);
    }
    if (taskRecord.status !== "awaiting_confirmation") {
      throw new Error(
        `task is not awaiting confirmation: ${input.confirmationTaskId}`,
      );
    }
    if (input.requester.role !== "owner") {
      throw new Error("Requester is not allowed to confirm family device actions");
    }

    const task = JSON.parse(taskRecord.packetJson) as TaskPacket;
    if (task.sourceSessionId !== input.session.sessionId) {
      throw new Error("Confirmation session does not match the task session");
    }
    const plan = await this.planDeviceAction(task, task.objective);
    const userMessageKey = userMessageId(
      input.session.sessionId,
      input.envelope.messageId,
    );
    const assistantMessageKey = assistantMessageId(
      input.session.sessionId,
      input.envelope.messageId,
    );

    this.appendMessageIfMissing({
      messageId: userMessageKey,
      sessionId: input.session.sessionId,
      role: "user",
      text: input.envelope.text,
      timestampMs: input.envelope.timestampMs,
    });
    this.deps.repositories.updateTaskStatus(task.taskId, "running");

    const result = await this.deps.deviceAdapter.executeCommand({
      commandId: `device-command:${task.taskId}:${plan.action}`,
      deviceId: task.scopeRef,
      action: plan.action,
    });
    this.recordCommandAcknowledged({
      session: input.session,
      task,
      result,
    });
    const replyText = formatCommandReply(plan.displayName, result);
    this.appendMessageIfMissing({
      messageId: assistantMessageKey,
      sessionId: input.session.sessionId,
      role: "assistant",
      text: replyText,
      timestampMs: input.envelope.timestampMs,
    });

    const outboxId = outboxMessageId(
      input.session.sessionId,
      input.envelope.messageId,
    );
    this.deps.repositories.insertOutboxOnce({
      outboxId,
      idempotencyKey: `telegram:reply:${input.session.sessionId}:${input.envelope.messageId}`,
      channel: "telegram",
      targetRef: input.envelope.chatId,
      payloadJson: JSON.stringify({
        chatId: input.envelope.chatId,
        text: replyText,
        replyToMessageId: input.envelope.messageId,
      }),
    });
    this.markTaskSucceeded(task.taskId);
    this.deps.emit({
      type: "task.completed",
      sessionId: input.session.sessionId,
      taskId: task.taskId,
      payload: { status: "succeeded", confirmedBy: input.envelope.messageId },
    });
    this.deps.emit({
      type: "reply.queued",
      sessionId: input.session.sessionId,
      taskId: task.taskId,
      payload: { outboxId },
    });

    return { replyText, outboxId };
  }

  private async planDeviceAction(
    task: TaskPacket,
    text: string,
  ): Promise<{ action: string; risk: DeviceActionRisk; displayName: string }> {
    const description = await this.deps.deviceAdapter.describe(task.scopeRef);
    const action = inferAction(text);
    const capability = description.capabilities.find((item) => item.action === action);
    if (!capability) {
      throw new Error(`Device does not support action: ${action}`);
    }

    return {
      action,
      risk: capability.risk,
      displayName: description.displayName,
    };
  }

  private recordStateRead(input: {
    session: SessionContext;
    task: TaskPacket;
    state: DeviceState;
  }): void {
    this.deps.repositories.insertDeviceEvent({
      deviceEventId: `device-event:${input.task.taskId}:state-read`,
      deviceId: input.state.deviceId,
      eventType: "state.read",
      taskId: input.task.taskId,
      sessionId: input.session.sessionId,
      payloadJson: JSON.stringify({
        online: input.state.online,
        state: input.state.state,
      }),
      createdAtMs: Date.now(),
    });
    this.deps.emit({
      type: "device.state_read",
      sessionId: input.session.sessionId,
      taskId: input.task.taskId,
      payload: {
        deviceId: input.state.deviceId,
        state: input.state.state,
      },
    });
  }

  private recordCommandAcknowledged(input: {
    session: SessionContext;
    task: TaskPacket;
    result: DeviceCommandResult;
  }): void {
    this.deps.repositories.insertDeviceEvent({
      deviceEventId: `device-event:${input.task.taskId}:command-acknowledged`,
      deviceId: input.result.deviceId,
      eventType: "command.acknowledged",
      taskId: input.task.taskId,
      sessionId: input.session.sessionId,
      payloadJson: JSON.stringify({
        action: input.result.action,
        commandId: input.result.commandId,
        state: input.result.state,
      }),
      createdAtMs: Date.now(),
    });
    this.deps.emit({
      type: "device.command_acknowledged",
      sessionId: input.session.sessionId,
      taskId: input.task.taskId,
      payload: {
        deviceId: input.result.deviceId,
        action: input.result.action,
        commandId: input.result.commandId,
        state: input.result.state,
      },
    });
  }

  private recordConfirmationRequired(input: {
    session: SessionContext;
    task: TaskPacket;
    deviceId: string;
    action: string;
    reason: string;
  }): void {
    this.deps.repositories.insertDeviceEvent({
      deviceEventId: `device-event:${input.task.taskId}:confirmation-required`,
      deviceId: input.deviceId,
      eventType: "command.requires_confirmation",
      taskId: input.task.taskId,
      sessionId: input.session.sessionId,
      payloadJson: JSON.stringify({
        action: input.action,
        reason: input.reason,
      }),
      createdAtMs: Date.now(),
    });
  }

  private queueExistingReply(input: {
    envelope: HumanEnvelope;
    session: SessionContext;
    task: TaskPacket;
    replyText: string;
  }): { replyText: string; outboxId: string } {
    const outboxId = outboxMessageId(
      input.session.sessionId,
      input.envelope.messageId,
    );
    this.deps.repositories.insertOutboxOnce({
      outboxId,
      idempotencyKey: `telegram:reply:${input.session.sessionId}:${input.envelope.messageId}`,
      channel: "telegram",
      targetRef: input.envelope.chatId,
      payloadJson: JSON.stringify({
        chatId: input.envelope.chatId,
        text: input.replyText,
        replyToMessageId: input.envelope.messageId,
      }),
    });
    this.deps.emit({
      type: "reply.queued",
      sessionId: input.session.sessionId,
      taskId: input.task.taskId,
      payload: { outboxId },
    });

    return {
      replyText: input.replyText,
      outboxId,
    };
  }

  private appendMessageIfMissing(input: {
    messageId: string;
    sessionId: string;
    role: string;
    text: string;
    timestampMs: number;
  }): void {
    const existing = this.deps.repositories.getMessageById(input.messageId);
    if (!existing) {
      this.deps.repositories.appendMessage(input);
    }
  }

  private ensureTaskPrepared(task: TaskPacket): void {
    const existingTask = this.deps.repositories.getTask(task.taskId);

    if (!existingTask) {
      this.deps.repositories.createTask(task, "created");
      this.deps.repositories.createTask(task, "admitted");
      return;
    }

    if (existingTask.status === "created") {
      this.deps.repositories.createTask(task, "admitted");
    }
  }

  private ensureTaskRunning(taskId: string): void {
    const existingTask = this.deps.repositories.getTask(taskId);
    if (!existingTask || existingTask.status === "admitted") {
      this.deps.repositories.updateTaskStatus(taskId, "running");
    }
  }

  private markTaskAwaitingConfirmation(taskId: string): void {
    const existingTask = this.deps.repositories.getTask(taskId);
    if (existingTask?.status === "running") {
      this.deps.repositories.updateTaskStatus(taskId, "awaiting_confirmation");
    }
  }

  private markTaskSucceeded(taskId: string): void {
    const existingTask = this.deps.repositories.getTask(taskId);
    if (existingTask?.status === "running") {
      this.deps.repositories.updateTaskStatus(taskId, "succeeded");
    }
  }

  private markTaskFailed(taskId: string): void {
    const existingTask = this.deps.repositories.getTask(taskId);
    if (existingTask?.status === "running") {
      this.deps.repositories.updateTaskStatus(taskId, "failed");
    }
  }

  private markFinalTaskStatus(
    taskId: string,
    status: "awaiting_confirmation" | "succeeded" | "failed" | undefined,
  ): void {
    if (status === "awaiting_confirmation") {
      this.markTaskAwaitingConfirmation(taskId);
      return;
    }
    if (status === "succeeded") {
      this.markTaskSucceeded(taskId);
      return;
    }
    if (status === "failed") {
      this.markTaskFailed(taskId);
    }
  }
}

export type HomeAgentRepositories = {
  appendMessage(input: {
    messageId: string;
    sessionId: string;
    role: string;
    text: string;
    timestampMs: number;
  }): void;
  getMessageById(messageId: string): {
    messageId: string;
    sessionId: string;
    role: string;
    text: string;
    timestampMs: number;
  } | undefined;
  createTask(packet: TaskPacket, status: "created" | "admitted"): void;
  getTask(
    taskId: string,
  ):
    | {
        taskId: string;
        status:
          | "created"
          | "admitted"
          | "running"
          | "awaiting_confirmation"
          | "succeeded"
          | "failed";
      }
    | undefined;
  getTaskPacket(taskId: string):
    | {
        taskId: string;
        status:
          | "created"
          | "admitted"
          | "running"
          | "awaiting_confirmation"
          | "succeeded"
          | "failed";
        packetJson: string;
      }
    | undefined;
  updateTaskStatus(
    taskId: string,
    status: "running" | "awaiting_confirmation" | "succeeded" | "failed",
  ): void;
  insertOutboxOnce(input: {
    outboxId: string;
    idempotencyKey: string;
    channel: string;
    targetRef: string;
    payloadJson: string;
  }): void;
  insertDeviceEvent(input: {
    deviceEventId: string;
    deviceId: string;
    eventType: string;
    taskId?: string;
    sessionId?: string;
    payloadJson: string;
    createdAtMs: number;
  }): void;
};

export type HomeAgentTurnInput = {
  envelope: HumanEnvelope;
  session: SessionContext;
  task: TaskPacket;
  requester: HomeAgentRequester;
};

export type HomeAgentConfirmationInput = {
  confirmationTaskId: string;
  envelope: HumanEnvelope;
  session: SessionContext;
  requester: HomeAgentRequester;
};

function inferAction(text: string): string {
  const normalized = text.toLowerCase();
  if (
    (normalized.includes("story bunny") ||
      normalized.includes("\u6545\u4e8b\u5154") ||
      normalized.includes("\u6dd8\u6c14\u5154") ||
      normalized.includes("\u73a9\u5177")) &&
    (normalized.includes("bedtime") || normalized.includes("\u7761\u524d"))
  ) {
    return "trigger_bedtime_scene";
  }
  if (
    (normalized.includes("story bunny") ||
      normalized.includes("\u6545\u4e8b\u5154") ||
      normalized.includes("\u6dd8\u6c14\u5154") ||
      normalized.includes("\u73a9\u5177")) &&
    (normalized.includes("play") || normalized.includes("\u73a9"))
  ) {
    return "trigger_play_scene";
  }
  if (
    normalized.includes("start camera recording") ||
    normalized.includes("start recording") ||
    normalized.includes("\u5f55\u5236")
  ) {
    return "start_recording";
  }

  if (
    normalized.includes("turn on") ||
    normalized.includes("switch on") ||
    normalized.includes("\u6253\u5f00")
  ) {
    return "turn_on";
  }
  if (
    normalized.includes("turn off") ||
    normalized.includes("switch off") ||
    normalized.includes("\u5173\u95ed")
  ) {
    return "turn_off";
  }
  return "read_state";
}

function isReplayableStatus(status: string | undefined): boolean {
  return (
    status === "succeeded" ||
    status === "awaiting_confirmation" ||
    status === "failed"
  );
}

function userMessageId(sessionId: string, messageId: string): string {
  return `user:${sessionId}:${messageId}`;
}

function assistantMessageId(sessionId: string, messageId: string): string {
  return `assistant:${sessionId}:${messageId}`;
}

function outboxMessageId(sessionId: string, messageId: string): string {
  return `outbox:telegram:${sessionId}:${messageId}`;
}

function formatStateReply(displayName: string, state: DeviceState): string {
  const power = state.state.power;
  if (typeof power === "string") {
    return `${displayName} is ${state.online ? "online" : "offline"} and power is ${power}.`;
  }

  return `${displayName} is ${state.online ? "online" : "offline"}.`;
}

function formatCommandReply(
  displayName: string,
  result: DeviceCommandResult,
): string {
  const power = result.state.power;
  if (typeof power === "string") {
    return `${displayName} is now ${power}.`;
  }

  return `${displayName} acknowledged ${result.action}.`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown home runtime error";
}
