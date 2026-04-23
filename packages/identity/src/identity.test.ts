import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity.js";

const envelope = {
  channel: "telegram" as const,
  accountId: "bot-main",
  chatType: "private" as const,
  peerId: "456",
  chatId: "456",
};

describe("resolveIdentity", () => {
  it("resolves owner Telegram user", () => {
    const identity = resolveIdentity(envelope, {
      ownerTelegramUserIds: ["456"],
      familyId: "main",
    });

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

    expect(identity.allowed).toBe(false);
  });
});
