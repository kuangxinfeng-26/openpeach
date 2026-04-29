import type { HumanEnvelope } from "../../../packages/envelope/src/index.js";
import {
  resolveIdentity,
  type ResolvedIdentity,
} from "../../../packages/identity/src/index.js";
import type {
  HomeAgentConfirmationInput,
  HomeAgentTurnInput,
  LabAgentTurnInput,
  MainAgentTurnInput,
} from "../../../packages/runtime/src/index.js";
import { getOrCreateSession } from "../../../packages/session-kernel/src/index.js";
import { admitTask, resolveTaskRoute } from "../../../packages/task-engine/src/index.js";

export type HandleHumanEnvelopeResult =
  | { ok: true; replyText: string; outboxId: string }
  | { ok: false; reason: string };

export type HandleHumanEnvelopeDeps = {
  config: {
    familyId: string;
    ownerTelegramUserIds: string[];
    coreAgentId?: "main";
    enabledDeviceIds?: string[];
  };
  repositories: {
    upsertSession(input: {
      sessionId: string;
      sessionKey: string;
      familyId: string;
      coreAgentId: string;
    }): void;
    insertOutboxOnce(input: {
      outboxId: string;
      idempotencyKey: string;
      channel: string;
      targetRef: string;
      payloadJson: string;
    }): void;
  };
  runtime: {
    handleTurn(input: MainAgentTurnInput): Promise<{ replyText: string; outboxId: string }>;
  };
  homeRuntime?: {
    handleTurn(input: HomeAgentTurnInput): Promise<{
      replyText: string;
      outboxId: string;
    }>;
    confirmAwaitingDeviceAction?(input: HomeAgentConfirmationInput): Promise<{
      replyText: string;
      outboxId: string;
    }>;
  };
  labRuntime?: {
    handleTurn(input: LabAgentTurnInput): Promise<{
      replyText: string;
      outboxId: string;
    }>;
  };
  skillReview?: {
    reviewCandidate(candidateId: string): string | undefined;
    approveCandidate?(
      candidateId: string,
      input: { reviewerIdentity: string; reason: string },
    ): string | undefined;
    rejectCandidate?(
      candidateId: string,
      input: { reviewerIdentity: string; reason: string },
    ): string | undefined;
  };
  identityResolver?: (
    envelope: HumanEnvelope,
    config: { familyId: string; ownerTelegramUserIds: string[] },
  ) => ResolvedIdentity;
};

export async function handleHumanEnvelope(input: {
  envelope: HumanEnvelope;
  deps: HandleHumanEnvelopeDeps;
}): Promise<HandleHumanEnvelopeResult> {
  const { envelope, deps } = input;
  const resolveEnvelopeIdentity = deps.identityResolver ?? resolveIdentity;
  const identity = resolveEnvelopeIdentity(envelope, {
    familyId: deps.config.familyId,
    ownerTelegramUserIds: deps.config.ownerTelegramUserIds,
  });

  if (!identity.allowed) {
    return {
      ok: false,
      reason: identity.reason,
    };
  }

  const skillReviewCommand = parseSkillReviewCommand(envelope.text);
  const skillOwnerDecisionCommand = parseSkillOwnerDecisionCommand(envelope.text);
  if ((skillReviewCommand || skillOwnerDecisionCommand) && identity.role !== "owner") {
    return {
      ok: false,
      reason: "Owner role is required for skill management commands",
    };
  }

  if (skillReviewCommand) {
    if (skillReviewCommand.kind === "usage") {
      return queueAdminReply({
        envelope,
        repositories: deps.repositories,
        replyText: "Usage: /skill_review <candidate_id>",
      });
    }

    if (!deps.skillReview) {
      return {
        ok: false,
        reason: "Skill review runtime is not configured",
      };
    }

    const replyText =
      deps.skillReview.reviewCandidate(skillReviewCommand.candidateId) ??
      `Skill candidate not found: ${skillReviewCommand.candidateId}`;

    return queueAdminReply({
      envelope,
      repositories: deps.repositories,
      replyText,
    });
  }

  if (skillOwnerDecisionCommand) {
    if (skillOwnerDecisionCommand.kind === "usage") {
      return queueAdminReply({
        envelope,
        repositories: deps.repositories,
        replyText: skillOwnerDecisionCommand.usage,
      });
    }

    const handler =
      skillOwnerDecisionCommand.decision === "approved"
        ? deps.skillReview?.approveCandidate
        : deps.skillReview?.rejectCandidate;
    if (!handler) {
      return {
        ok: false,
        reason: "Skill owner approval runtime is not configured",
      };
    }

    const replyText =
      handler(skillOwnerDecisionCommand.candidateId, {
        reviewerIdentity: `${envelope.channel}:${envelope.peerId}`,
        reason: skillOwnerDecisionCommand.reason,
      }) ?? `Skill candidate not found: ${skillOwnerDecisionCommand.candidateId}`;

    return queueAdminReply({
      envelope,
      repositories: deps.repositories,
      replyText,
    });
  }

  const confirmationTaskId = parseConfirmationTaskId(envelope.text);
  if (confirmationTaskId) {
    if (!deps.homeRuntime?.confirmAwaitingDeviceAction) {
      return {
        ok: false,
        reason: "Home agent confirmation runtime is not configured",
      };
    }

    const session = getOrCreateSession(deps.repositories, {
      familyId: identity.familyId,
      coreAgentId: "home",
      channel: envelope.channel,
      accountId: envelope.accountId,
      peerId: envelope.peerId,
      threadId: envelope.threadId,
      scene: "default",
    });
    const result = await deps.homeRuntime.confirmAwaitingDeviceAction({
      confirmationTaskId,
      envelope,
      session,
      requester: { role: identity.role },
    });

    return {
      ok: true,
      replyText: result.replyText,
      outboxId: result.outboxId,
    };
  }

  const route = resolveTaskRoute(envelope.text, {
    enabledDeviceIds: deps.config.enabledDeviceIds,
  });
  const coreAgentId =
    route.targetAgent === "home"
      ? "home"
      : route.targetAgent === "lab"
        ? "lab"
        : deps.config.coreAgentId ?? "main";
  const session = getOrCreateSession(deps.repositories, {
    familyId: identity.familyId,
    coreAgentId,
    channel: envelope.channel,
    accountId: envelope.accountId,
    peerId: envelope.peerId,
    threadId: envelope.threadId,
    scene: "default",
  });

  const decision = admitTask({
    text: envelope.text,
    sessionId: session.sessionId,
    messageId: envelope.messageId,
    requesterIdentity: identity,
    enabledDeviceIds: deps.config.enabledDeviceIds,
  });

  if (!decision.admitted || !decision.task) {
    return {
      ok: false,
      reason: decision.reason ?? "Task was not admitted",
    };
  }

  if (decision.task.targetAgent === "home") {
    if (!deps.homeRuntime) {
      return {
        ok: false,
        reason: "Home agent runtime is not configured",
      };
    }

    const result = await deps.homeRuntime.handleTurn({
      envelope,
      session,
      task: decision.task,
      requester: { role: identity.role },
    });

    return {
      ok: true,
      replyText: result.replyText,
      outboxId: result.outboxId,
    };
  }

  if (decision.task.targetAgent === "lab") {
    if (!deps.labRuntime) {
      return {
        ok: false,
        reason: "Lab agent runtime is not configured",
      };
    }

    const result = await deps.labRuntime.handleTurn({
      envelope,
      session,
      task: decision.task,
    });

    return {
      ok: true,
      replyText: result.replyText,
      outboxId: result.outboxId,
    };
  }

  const result = await deps.runtime.handleTurn({
    envelope,
    session,
    task: decision.task,
  });

  return {
    ok: true,
    replyText: result.replyText,
    outboxId: result.outboxId,
  };
}

function parseConfirmationTaskId(text: string): string | undefined {
  const match = text.trim().match(/^(?:confirm|\u786e\u8ba4)\s+(task:[\w:.-]+)$/i);
  return match?.[1];
}

type SkillReviewCommand =
  | { kind: "review"; candidateId: string }
  | { kind: "usage" };

function parseSkillReviewCommand(text: string): SkillReviewCommand | undefined {
  const trimmed = text.trim();
  if (!/^\/skill_review(?:@\w+)?(?:\s|$)/i.test(trimmed)) {
    return undefined;
  }

  const match = trimmed.match(/^\/skill_review(?:@\w+)?\s+([\w:.-]+)$/i);
  if (match) {
    return { kind: "review", candidateId: match[1] };
  }

  return { kind: "usage" };
}

type SkillOwnerDecisionCommand =
  | {
      kind: "decision";
      candidateId: string;
      decision: "approved" | "rejected";
      reason: string;
    }
  | { kind: "usage"; usage: string };

function parseSkillOwnerDecisionCommand(
  text: string,
): SkillOwnerDecisionCommand | undefined {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(/^\/(skill_approve|skill_reject)(?:@\w+)?(?:\s|$)/i);
  if (!commandMatch) {
    return undefined;
  }

  const command = commandMatch[1].toLowerCase();
  const usage = `Usage: /${command} <candidate_id> [reason]`;
  const decision = command === "skill_approve" ? "approved" : "rejected";
  const match = trimmed.match(
    /^\/(?:skill_approve|skill_reject)(?:@\w+)?\s+([\w:.-]+)(?:\s+(.+))?$/i,
  );
  if (!match) {
    return { kind: "usage", usage };
  }

  return {
    kind: "decision",
    candidateId: match[1],
    decision,
    reason:
      match[2]?.trim() ||
      (decision === "approved"
        ? "Approved from owner command."
        : "Rejected from owner command."),
  };
}

function queueAdminReply(input: {
  envelope: HumanEnvelope;
  repositories: {
    insertOutboxOnce(input: {
      outboxId: string;
      idempotencyKey: string;
      channel: string;
      targetRef: string;
      payloadJson: string;
    }): void;
  };
  replyText: string;
}): HandleHumanEnvelopeResult {
  const outboxId = [
    "outbox",
    input.envelope.channel,
    "admin",
    input.envelope.accountId,
    input.envelope.peerId,
    input.envelope.messageId,
  ].join(":");
  input.repositories.insertOutboxOnce({
    outboxId,
    idempotencyKey: `${input.envelope.channel}:admin-reply:${input.envelope.accountId}:${input.envelope.peerId}:${input.envelope.messageId}`,
    channel: input.envelope.channel,
    targetRef: input.envelope.chatId,
    payloadJson: JSON.stringify({
      chatId: input.envelope.chatId,
      text: input.replyText,
      replyToMessageId: input.envelope.messageId,
    }),
  });

  return {
    ok: true,
    replyText: input.replyText,
    outboxId,
  };
}
