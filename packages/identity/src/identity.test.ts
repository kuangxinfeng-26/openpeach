import { describe, expect, it } from "vitest";
import type { ResolvedIdentity } from "./identity.js";
import { resolveIdentity } from "./identity.js";

const envelope = {
  channel: "telegram" as const,
  accountId: "bot-main",
  chatType: "private" as const,
  peerId: "456",
  chatId: "456",
};

const groupEnvelope = {
  channel: "telegram" as const,
  accountId: "bot-main",
  chatType: "group" as const,
  peerId: "-456",
  chatId: "-456",
};

describe("resolveIdentity", () => {
  it("resolves owner Telegram user", () => {
    const identity = resolveIdentity(envelope, {
      ownerTelegramUserIds: ["456"],
      familyId: "main",
    });

    type AllowedIdentity = Extract<ResolvedIdentity, { allowed: true }>;
    const personId: AllowedIdentity["personId"] = identity.personId;
    expect(personId).toBe("person:telegram:456");

    expect(identity).toMatchObject({
      allowed: true,
      role: "owner",
      personId: "person:telegram:456",
      familyId: "main",
    });
  });

  it("denies unknown Telegram users in Phase 0", () => {
    const identity = resolveIdentity(envelope, {
      ownerTelegramUserIds: ["999"],
      familyId: "main",
    });

    expect(identity).toMatchObject({
      allowed: false,
      role: "unknown",
      reason: "Telegram user is not allowlisted",
      familyId: "main",
    });
    expect(identity.personId).toBeUndefined();
  });

  it("denies non-private Telegram chats in Phase 0", () => {
    const identity = resolveIdentity(groupEnvelope, {
      ownerTelegramUserIds: ["456"],
      familyId: "main",
    });

    expect(identity).toMatchObject({
      allowed: false,
      role: "unknown",
      reason: "Phase 0 only supports Telegram private chats",
      familyId: "main",
    });
    expect(identity.personId).toBeUndefined();
  });
});
