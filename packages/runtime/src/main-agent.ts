import type { HumanEnvelope } from "../../envelope/src/index.js";
import type { TaoqibaoEvent } from "../../event-bus/src/index.js";
import type { SessionContext } from "../../session-kernel/src/index.js";
import type { TaskPacket } from "../../task-engine/src/index.js";

const SYSTEM_PROMPT =
  "你是淘气包的 main agent，负责温和、可靠地陪伴用户，并在 Phase 0 中只处理普通对话和显式历史检索。不要假装已经接入家庭设备、微信、摄像头或 AI 玩具。";

const HISTORY_HINT_PATTERNS = ["上次", "之前", "以前", "历史"] as const;

export type MainAgentRuntimeDeps = {
  repositories: MainAgentRepositories;
  model: {
    complete(
      messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
    ): Promise<string>;
  };
  emit: (event: TaoqibaoEvent) => void;
  sessionSearch?: (
    query: string,
  ) => Array<{ messageId: string; sessionId: string; snippet: string }>;
};

export class MainAgentRuntime {
  constructor(private readonly deps: MainAgentRuntimeDeps) {}

  async handleTurn(input: MainAgentTurnInput): Promise<{
    replyText: string;
    outboxId: string;
  }> {
    const { envelope, session, task } = input;
    const userMessageKey = userMessageId(envelope.messageId);
    const assistantMessageKey = assistantMessageId(envelope.messageId);
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
          : await this.generateReply(envelope.text, session.sessionId);

      if (!existingAssistantMessage) {
        this.deps.repositories.appendMessage({
          messageId: assistantMessageKey,
          sessionId: session.sessionId,
          role: "assistant",
          text: replyText,
          timestampMs: envelope.timestampMs,
        });
      }

      const outboxId = outboxMessageId(envelope.messageId);
      this.deps.repositories.insertOutboxOnce({
        outboxId,
        idempotencyKey: `telegram:reply:${envelope.messageId}`,
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

  private lookupHistory(
    text: string,
    sessionId: string,
  ): Array<{ messageId: string; snippet: string }> {
    if (!this.deps.sessionSearch) {
      return [];
    }

    const query = HISTORY_HINT_PATTERNS.find((pattern) => text.includes(pattern));
    if (!query) {
      return [];
    }

    return this.deps.sessionSearch(query)
      .filter((result) => result.sessionId === sessionId)
      .slice(0, 5)
      .map((result) => ({
        messageId: result.messageId,
        snippet: result.snippet,
      }));
  }

  private async generateReply(text: string, sessionId: string): Promise<string> {
    return this.deps.model.complete([
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(text, this.lookupHistory(text, sessionId)),
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
    if (existing) {
      return;
    }

    this.deps.repositories.appendMessage(input);
  }

  private ensureTaskRunning(taskId: string): void {
    const existingTask = this.deps.repositories.getTask(taskId);
    if (!existingTask || existingTask.status === "admitted") {
      this.deps.repositories.updateTaskStatus(taskId, "running");
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

export type MainAgentRepositories = {
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
  ): { taskId: string; status: "created" | "admitted" | "running" | "succeeded" | "failed" } | undefined;
  updateTaskStatus(
    taskId: string,
    status: "running" | "succeeded" | "failed",
  ): void;
  insertOutboxOnce(input: {
    outboxId: string;
    idempotencyKey: string;
    channel: string;
    targetRef: string;
    payloadJson: string;
  }): void;
};

export type MainAgentTurnInput = {
  envelope: HumanEnvelope;
  session: SessionContext;
  task: TaskPacket;
};

function buildUserPrompt(
  text: string,
  history: Array<{ messageId: string; snippet: string }>,
): string {
  if (history.length === 0) {
    return text;
  }

  return [
    `用户当前消息：${text}`,
    "检索到的当前会话历史：",
    ...history.map(
      (item, index) => `[${index + 1}] ${item.messageId}: ${item.snippet}`,
    ),
  ].join("\n");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown runtime error";
}

function userMessageId(messageId: string): string {
  return `user:${messageId}`;
}

function assistantMessageId(messageId: string): string {
  return `assistant:${messageId}`;
}

function outboxMessageId(messageId: string): string {
  return `outbox:telegram:${messageId}`;
}
