import { describe, expect, it } from "vitest";
import { normalizeTelegramMessage } from "./telegram-normalizer.js";

describe("normalizeTelegramMessage", () => {
  it("normalizes a Telegram private text message into HumanEnvelope", () => {
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message: {
        message_id: 10,
        date: 1710000000,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "浣犲ソ锛屾窐姘斿寘",
      },
    });

    expect(envelope).toMatchObject({
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "456",
      text: "浣犲ソ锛屾窐姘斿寘",
      messageId: "10",
    });
  });

  it("rejects non-text messages in Phase 0", () => {
    expect(() =>
      normalizeTelegramMessage({
        botAccountId: "bot-main",
        message: {
          message_id: 11,
          date: 1710000001,
          chat: { id: 123, type: "private" },
          from: { id: 456, is_bot: false, first_name: "Owner" },
        },
      }),
    ).toThrow(/text/i);
  });
});
