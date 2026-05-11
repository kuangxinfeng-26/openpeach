import { describe, expect, it, vi } from "vitest";
import {
  createTelegramProxyFetch,
  handleTelegramTextMessage,
  type HandleTelegramTextMessageInput,
} from "./telegram-adapter.js";
import type { HumanEnvelope } from "../../envelope/src/index.js";

function createMockCtx(overrides: Partial<{
  message: {
    message_id: number;
    date: number;
    chat: { id: number; type: "private" | "group" };
    from: { id: number; is_bot: boolean; first_name?: string };
    text: string;
  };
  replyWithChatAction: (action: "typing") => Promise<unknown>;
  reply: (text: string) => Promise<unknown>;
}> = {}) {
  return {
    message: overrides.message ?? {
      message_id: 1,
      date: 1700000000,
      chat: { id: 100, type: "private" as const },
      from: { id: 200, is_bot: false, first_name: "Alice" },
      text: "Hello",
    },
    replyWithChatAction: overrides.replyWithChatAction ?? vi.fn(async () => {}),
    reply: overrides.reply ?? vi.fn(async () => {}),
  };
}

describe("handleTelegramTextMessage", () => {
  it("normalizes message and calls onEnvelope", async () => {
    const onEnvelope = vi.fn(async (_env: HumanEnvelope) => ({
      replyText: "Hi there",
      outboxId: "outbox-1",
    }));
    const ctx = createMockCtx();

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope,
      ctx,
    });

    expect(onEnvelope).toHaveBeenCalledTimes(1);
    const envelope = onEnvelope.mock.calls[0]![0];
    expect(envelope.channel).toBe("telegram");
    expect(envelope.peerId).toBe("200");
    expect(envelope.text).toBe("Hello");
  });

  it("sends reply text back through ctx.reply", async () => {
    const reply = vi.fn(async () => {});
    const ctx = createMockCtx({ reply });

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "Response", outboxId: "o1" }),
      ctx,
    });

    expect(reply).toHaveBeenCalledWith("Response");
  });

  it("calls onReplySent after successful reply", async () => {
    const onReplySent = vi.fn(async () => {});
    const ctx = createMockCtx();

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "ok", outboxId: "outbox-42" }),
      onReplySent,
      ctx,
    });

    expect(onReplySent).toHaveBeenCalledWith({ outboxId: "outbox-42" });
  });

  it("does not call ctx.reply when replyText is undefined", async () => {
    const reply = vi.fn(async () => {});
    const ctx = createMockCtx({ reply });

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({}),
      ctx,
    });

    expect(reply).not.toHaveBeenCalled();
  });

  it("ignores non-private chats", async () => {
    const onEnvelope = vi.fn(async () => ({ replyText: "hi" }));
    const ctx = createMockCtx({
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 100, type: "group" as const },
        from: { id: 200, is_bot: false },
        text: "Hello",
      },
    });

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope,
      ctx,
    });

    expect(onEnvelope).not.toHaveBeenCalled();
  });

  it("ignores messages without ctx.message", async () => {
    const onEnvelope = vi.fn(async () => ({ replyText: "hi" }));
    const ctx = {
      message: undefined,
      replyWithChatAction: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
    };

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope,
      ctx,
    });

    expect(onEnvelope).not.toHaveBeenCalled();
  });

  it("sends typing action before processing", async () => {
    const replyWithChatAction = vi.fn(async () => {});
    const ctx = createMockCtx({ replyWithChatAction });

    await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "done" }),
      ctx,
    });

    expect(replyWithChatAction).toHaveBeenCalledWith("typing");
  });

  it("returns an error when onEnvelope throws", async () => {
    const ctx = createMockCtx();

    const result = await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => {
        throw new Error("pipeline broke");
      },
      ctx,
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Telegram adapter failed");
  });

  it("does not leak token in error messages", async () => {
    const token = "dummy-telegram-token-for-redaction-test";
    const ctx = createMockCtx();

    const result = await handleTelegramTextMessage({
      token,
      botAccountId: "bot-main",
      onEnvelope: async () => {
        throw new Error(`Error with token ${token}`);
      },
      ctx,
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).not.toContain(token);
  });

  it("returns an error when ctx.reply throws", async () => {
    const ctx = createMockCtx({
      reply: vi.fn(async () => {
        throw new Error("send failed");
      }),
    });

    const result = await handleTelegramTextMessage({
      token: "fake-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "hi" }),
      ctx,
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Telegram send failed");
  });
});

describe("createTelegramProxyFetch", () => {
  it("creates a fetch function that uses a proxy dispatcher", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const proxiedFetch = createTelegramProxyFetch(
      "http://127.0.0.1:7890",
      mockFetch,
    );

    expect(typeof proxiedFetch).toBe("function");
    await proxiedFetch("https://api.telegram.org/test", {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/test");
    expect((init as Record<string, unknown>).dispatcher).toBeDefined();
  });

  it("bridges abort signal to the proxy request", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const proxiedFetch = createTelegramProxyFetch(
      "http://127.0.0.1:7890",
      mockFetch,
    );

    const controller = new AbortController();
    await proxiedFetch("https://api.telegram.org/test", {
      signal: controller.signal,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0]!;
    expect((init as Record<string, unknown>).signal).toBeDefined();
  });
});
