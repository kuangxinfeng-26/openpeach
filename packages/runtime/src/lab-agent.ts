import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { OpenPeachEvent } from "../../event-bus/src/index.js";
import type { SessionContext } from "../../session-kernel/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";
import type { MainAgentRepositories } from "./main-agent.js";

const LAB_SYSTEM_PROMPT =
  "You are the OpenPeach lab agent. Focus on project work, reusable procedures, skill evolution, and honest evidence. Keep generated skills reviewable and never claim they are active until replay and owner approval pass.";

export type LabAgentRuntimeDeps = {
  repositories: MainAgentRepositories;
  model: {
    complete(
      messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
    ): Promise<string>;
  };
  emit: (event: OpenPeachEvent) => void;
  systemPrompt?: string;
};

export class LabAgentRuntime {
  constructor(private readonly deps: LabAgentRuntimeDeps) {}

  async handleTurn(input: LabAgentTurnInput): Promise<{
    replyText: string;
    outboxId: string;
  }> {
    const { envelope, session, task } = input;
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
      this.ensureTaskRunning(task.taskId);

      this.deps.emit({
        type: "task.created",
        sessionId: session.sessionId,
        taskId: task.taskId,
        payload: { objective: task.objective },
      });

      const existingAssistantMessage =
        this.deps.repositories.getMessageById(assistantMessageKey);
      const replyText =
        existingAssistantMessage?.sessionId === session.sessionId
          ? existingAssistantMessage.text
          : await this.generateReply(envelope.text);

      if (!existingAssistantMessage) {
        this.deps.repositories.appendMessage({
          messageId: assistantMessageKey,
          sessionId: session.sessionId,
          role: "assistant",
          text: replyText,
          timestampMs: envelope.timestampMs,
        });
      }

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

      this.markTaskSucceeded(task.taskId);
      this.deps.emit({
        type: "task.completed",
        sessionId: session.sessionId,
        taskId: task.taskId,
        payload: { status: "succeeded" },
      });
      this.deps.emit({
        type: "reply.queued",
        sessionId: session.sessionId,
        taskId: task.taskId,
        payload: { outboxId },
      });

      return { replyText, outboxId };
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

  private async generateReply(text: string): Promise<string> {
    return this.deps.model.complete([
      {
        role: "system",
        content: this.deps.systemPrompt ?? LAB_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: text,
      },
    ]);
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
      return;
    }

    if (existingTask.status === "failed") {
      this.deps.repositories.reviveTask(taskId);
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
}

export type LabAgentTurnInput = {
  envelope: HumanEnvelope;
  session: SessionContext;
  task: TaskPacket;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown lab runtime error";
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
