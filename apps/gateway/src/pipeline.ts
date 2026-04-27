import type { HumanEnvelope } from "../../../packages/envelope/src/index.js";
import { resolveIdentity } from "../../../packages/identity/src/index.js";
import type { MainAgentTurnInput } from "../../../packages/runtime/src/index.js";
import { getOrCreateSession } from "../../../packages/session-kernel/src/index.js";
import { admitTask } from "../../../packages/task-engine/src/index.js";

export type HandleHumanEnvelopeResult =
  | { ok: true; replyText: string; outboxId: string }
  | { ok: false; reason: string };

export type HandleHumanEnvelopeDeps = {
  config: {
    familyId: string;
    ownerTelegramUserIds: string[];
    coreAgentId?: "main";
  };
  repositories: {
    upsertSession(input: {
      sessionId: string;
      sessionKey: string;
      familyId: string;
      coreAgentId: string;
    }): void;
  };
  runtime: {
    handleTurn(input: MainAgentTurnInput): Promise<{ replyText: string; outboxId: string }>;
  };
};

export async function handleHumanEnvelope(input: {
  envelope: HumanEnvelope;
  deps: HandleHumanEnvelopeDeps;
}): Promise<HandleHumanEnvelopeResult> {
  const { envelope, deps } = input;
  const identity = resolveIdentity(envelope, {
    familyId: deps.config.familyId,
    ownerTelegramUserIds: deps.config.ownerTelegramUserIds,
  });

  if (!identity.allowed) {
    return {
      ok: false,
      reason: identity.reason,
    };
  }

  const session = getOrCreateSession(deps.repositories, {
    familyId: identity.familyId,
    coreAgentId: deps.config.coreAgentId ?? "main",
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
  });

  if (!decision.admitted || !decision.task) {
    return {
      ok: false,
      reason: decision.reason ?? "Task was not admitted",
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
