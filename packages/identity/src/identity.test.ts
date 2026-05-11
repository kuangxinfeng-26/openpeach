import { describe, expect, it } from "vitest";
import { resolveIdentity, type ResolvedIdentity } from "./identity.js";

const defaultConfig = {
  ownerTelegramUserIds: ["111", "222"],
  familyId: "family-main",
};

function makeEnvelope(overrides: Partial<{
  channel: "telegram";
  accountId: string;
  chatType: string;
  peerId: string;
  chatId: string;
}> = {}) {
  return {
    channel: "telegram" as const,
    accountId: "bot-main",
    chatType: "private",
    peerId: "111",
    chatId: "111",
    ...overrides,
  };
}

describe("resolveIdentity", () => {
  it("resolves an allowlisted owner in a private chat", () => {
    const result = resolveIdentity(makeEnvelope(), defaultConfig);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.role).toBe("owner");
      expect(result.personId).toBe("person:telegram:111");
      expect(result.familyId).toBe("family-main");
      expect(result.channelIdentityId).toBe("telegram:bot-main:111");
    }
  });

  it("resolves a second allowlisted owner", () => {
    const result = resolveIdentity(
      makeEnvelope({ peerId: "222" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.personId).toBe("person:telegram:222");
    }
  });

  it("denies a non-allowlisted user in a private chat", () => {
    const result = resolveIdentity(
      makeEnvelope({ peerId: "999" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("Telegram user is not allowlisted");
      expect(result.role).toBe("unknown");
      expect(result.channelIdentityId).toBe("telegram:bot-main:999");
      expect(result.familyId).toBe("family-main");
    }
  });

  it("denies a group chat even for an allowlisted user", () => {
    const result = resolveIdentity(
      makeEnvelope({ chatType: "group" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe(
        "Phase 0 only supports Telegram private chats",
      );
    }
  });

  it("denies a supergroup chat", () => {
    const result = resolveIdentity(
      makeEnvelope({ chatType: "supergroup" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(false);
  });

  it("denies a channel chat", () => {
    const result = resolveIdentity(
      makeEnvelope({ chatType: "channel" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(false);
  });

  it("builds channelIdentityId from channel, accountId, and peerId", () => {
    const result = resolveIdentity(
      makeEnvelope({ accountId: "bot-secondary", peerId: "111" }),
      defaultConfig,
    );

    expect(result.channelIdentityId).toBe("telegram:bot-secondary:111");
  });

  it("denies when ownerTelegramUserIds is empty", () => {
    const result = resolveIdentity(makeEnvelope(), {
      ...defaultConfig,
      ownerTelegramUserIds: [],
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("Telegram user is not allowlisted");
    }
  });

  it("does not have personId on denied identity", () => {
    const result = resolveIdentity(
      makeEnvelope({ peerId: "999" }),
      defaultConfig,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.personId).toBeUndefined();
    }
  });
});
