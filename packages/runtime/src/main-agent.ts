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

    this.deps.repositories.appendMessage({
      messageId: userMessageId(envelope.messageId),
      sessionId: session.sessionId,
      role: "user",
      text: envelope.text,
      timestampMs: envelope.timestampMs,
    });

    this.deps.repositories.createTask(task, "created");
    this.deps.repositories.createTask(task, "admitted");
    this.deps.repositories.updateTaskStatus(task.taskId, "running");

    this.deps.emit({
      type: "task.created",
      sessionId: session.sessionId,
      taskId: task.taskId,
      payload: { objective: task.objective },
    });

    const replyText = await this.deps.model.complete([
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildUserPrompt(envelope.text, this.lookupHistory(envelope.text)),
      },
    ]);

    this.deps.repositories.appendMessage({
      messageId: assistantMessageId(envelope.messageId),
      sessionId: session.sessionId,
      role: "assistant",
      text: replyText,
      timestampMs: envelope.timestampMs,
    });

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

    this.deps.repositories.updateTaskStatus(task.taskId, "succeeded");

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
  }

  private lookupHistory(text: string): Array<{ snippet: string }> {
    if (!this.deps.sessionSearch) {
      return [];
    }

    const query = HISTORY_HINT_PATTERNS.find((pattern) => text.includes(pattern));
    if (!query) {
      return [];
    }

    return this.deps.sessionSearch(query).slice(0, 5);
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
  createTask(packet: TaskPacket, status: "created" | "admitted"): void;
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
  history: Array<{ snippet: string }>,
): string {
  if (history.length === 0) {
    return text;
  }

  return [
    `用户当前消息：${text}`,
    "相关历史片段：",
    ...history.map((item, index) => `[${index + 1}] ${item.snippet}`),
  ].join("\n");
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
