type MinimalEnvelope = {
  channel: "telegram";
  accountId: string;
  chatType: string;
  peerId: string;
  chatId: string;
};

export type ResolvedIdentity = {
  allowed: boolean;
  channelIdentityId: string;
  personId?: string;
  familyId: string;
  role: "owner" | "unknown";
  reason?: string;
};

export function resolveIdentity(
  envelope: MinimalEnvelope,
  config: { ownerTelegramUserIds: string[]; familyId: string },
): ResolvedIdentity {
  const channelIdentityId = `${envelope.channel}:${envelope.accountId}:${envelope.peerId}`;
  if (envelope.chatType !== "private") {
    return {
      allowed: false,
      channelIdentityId,
      familyId: config.familyId,
      role: "unknown",
      reason: "Phase 0 only supports Telegram private chats",
    };
  }
  if (!config.ownerTelegramUserIds.includes(envelope.peerId)) {
    return {
      allowed: false,
      channelIdentityId,
      familyId: config.familyId,
      role: "unknown",
      reason: "Telegram user is not allowlisted",
    };
  }
  return {
    allowed: true,
    channelIdentityId,
    personId: `person:telegram:${envelope.peerId}`,
    familyId: config.familyId,
    role: "owner",
  };
}
