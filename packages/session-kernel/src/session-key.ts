export interface SessionKeyInput {
  familyId: string;
  coreAgentId: string;
  channel: string;
  accountId: string;
  peerId: string;
  scene?: string;
  threadId?: string;
}

export function buildSessionKey(input: SessionKeyInput): string {
  const scene = input.scene ?? "default";
  const threadId = input.threadId ?? "dm";

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
