import { describe, expect, it } from "vitest";
import { HumanEnvelopeSchema } from "./human-envelope.js";
import { normalizeTelegramMessage } from "./telegram-normalizer.js";

describe("HumanEnvelopeSchema", () => {
  it("validates a well-formed envelope", () => {
    const envelope = {
      id: "telegram:bot-main:123:456",
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "123",
      chatId: "123",
      messageId: "456",
      text: "hello",
      timestampMs: 1700000000000,
      raw: {},
    };
    const result = HumanEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const envelope = {
      id: "telegram:bot-main:123:456",
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "123",
      chatId: "123",
      messageId: "456",
      text: "",
      timestampMs: 1700000000000,
      raw: {},
    };
    const result = HumanEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  it("rejects invalid chatType", () => {
    const envelope = {
      id: "telegram:bot-main:123:456",
      channel: "telegram",
      accountId: "bot-main",
      chatType: "unknown_type",
      peerId: "123",
      chatId: "123",
      messageId: "456",
      text: "hello",
      timestampMs: 1700000000000,
      raw: {},
    };
    const result = HumanEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });

  it("accepts optional threadId", () => {
    const envelope = {
      id: "telegram:bot-main:123:456",
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "123",
      chatId: "123",
      threadId: "789",
      messageId: "456",
      text: "hello",
      timestampMs: 1700000000000,
      raw: {},
    };
    const result = HumanEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threadId).toBe("789");
    }
  });

  it("rejects negative timestampMs", () => {
    const envelope = {
      id: "telegram:bot-main:123:456",
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "123",
      chatId: "123",
      messageId: "456",
      text: "hello",
      timestampMs: -1,
      raw: {},
    };
    const result = HumanEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(false);
  });
});

describe("normalizeTelegramMessage", () => {
  const baseTelegramMessage = {
    message_id: 456,
    date: 1700000000,
    chat: { id: 123, type: "private" as const },
    from: { id: 999, is_bot: false, first_name: "Alice" },
    text: "Hello world",
  };

  it("normalizes a private text message", () => {
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message: baseTelegramMessage,
    });

    expect(envelope.id).toBe("telegram:bot-main:123:456");
    expect(envelope.channel).toBe("telegram");
    expect(envelope.accountId).toBe("bot-main");
    expect(envelope.chatType).toBe("private");
    expect(envelope.peerId).toBe("999");
    expect(envelope.chatId).toBe("123");
    expect(envelope.messageId).toBe("456");
    expect(envelope.text).toBe("Hello world");
    expect(envelope.timestampMs).toBe(1700000000000);
    expect(envelope.raw).toEqual(baseTelegramMessage);
  });

  it("trims whitespace from text", () => {
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message: { ...baseTelegramMessage, text: "  hi  " },
    });
    expect(envelope.text).toBe("hi");
  });

  it("throws on empty text", () => {
    expect(() =>
      normalizeTelegramMessage({
        botAccountId: "bot-main",
        message: { ...baseTelegramMessage, text: "" },
      }),
    ).toThrow("Phase 0 only supports Telegram text messages");
  });

  it("throws on undefined text", () => {
    expect(() =>
      normalizeTelegramMessage({
        botAccountId: "bot-main",
        message: { ...baseTelegramMessage, text: undefined },
      }),
    ).toThrow("Phase 0 only supports Telegram text messages");
  });

  it("throws on whitespace-only text", () => {
    expect(() =>
      normalizeTelegramMessage({
        botAccountId: "bot-main",
        message: { ...baseTelegramMessage, text: "   " },
      }),
    ).toThrow("Phase 0 only supports Telegram text messages");
  });

  it("uses chat.id as peerId when from is missing", () => {
    const message = { ...baseTelegramMessage, from: undefined };
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message,
    });
    expect(envelope.peerId).toBe("123");
  });

  it("includes threadId when message_thread_id is present", () => {
    const message = { ...baseTelegramMessage, message_thread_id: 42 };
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message,
    });
    expect(envelope.threadId).toBe("42");
  });

  it("omits threadId when message_thread_id is absent", () => {
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message: baseTelegramMessage,
    });
    expect(envelope.threadId).toBeUndefined();
  });

  it("handles group chat type", () => {
    const message = {
      ...baseTelegramMessage,
      chat: { id: 555, type: "group" as const },
    };
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message,
    });
    expect(envelope.chatType).toBe("group");
    expect(envelope.chatId).toBe("555");
  });
});
