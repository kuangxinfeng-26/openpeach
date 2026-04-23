export interface SessionKeyInput {
  familyId: string;
  coreAgentId: string;
  channel: string;
  accountId: string;
  peerId: string;
  scene?: string;
  threadId?: string;
}

const RESERVED_DELIMITERS = /[/:]/;

export function buildSessionKey(input: SessionKeyInput): string {
  const scene = input.scene ?? "default";
  const threadId = input.threadId ?? "dm";
  const fields = {
    familyId: input.familyId,
    coreAgentId: input.coreAgentId,
    channel: input.channel,
    accountId: input.accountId,
    peerId: input.peerId,
    scene,
    threadId,
  };

  for (const [fieldName, value] of Object.entries(fields)) {
    if (RESERVED_DELIMITERS.test(value)) {
      throw new Error(
        `${fieldName} contains reserved delimiter "/" or ":" and cannot be used in a session key`,
      );
    }
  }

  return [
    `family:${input.familyId}`,
    `agent:${input.coreAgentId}`,
    `channel:${input.channel}`,
    `account:${input.accountId}`,
    `peer:${input.peerId}`,
    `scene:${scene}`,
    `thread:${threadId}`,
  ].join("/");
}
