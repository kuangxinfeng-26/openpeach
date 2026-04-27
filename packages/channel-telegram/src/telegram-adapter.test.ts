import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelegramProxyFetch,
  createTelegramAdapter,
  handleTelegramTextMessage,
} from "./telegram-adapter.js";

type MockContext = {
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    from?: { id: number; is_bot: boolean; first_name?: string };
    text?: string;
    message_thread_id?: number;
  };
  replyWithChatAction?: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
};

type MessageTextHandler = (ctx: MockContext) => Promise<Error | void>;
const createTextMessage = (message_id = 10) => ({
  message_id,
  date: 1_710_000_000,
  chat: { id: 456, type: "private" as const },
  from: { id: 456, is_bot: false, first_name: "Owner" },
  text: "hello",
});
type ErrorBoundaryHandler = (error: { error: Error }) => Promise<void> | void;

const { MockBot, botInstances } = vi.hoisted(() => {
  const hoistedBotInstances: MockBot[] = [];

  class MockBot {
    readonly handlers = new Map<string, MessageTextHandler>();
    readonly caughtErrors: Error[] = [];
    readonly start = vi.fn(async () => {});
    readonly stop = vi.fn(async () => {});
    private errorBoundary?: ErrorBoundaryHandler;

    constructor(
      readonly token: string,
      readonly config?: { client?: { apiRoot?: string; fetch?: unknown } },
    ) {
      hoistedBotInstances.push(this);
    }

    on(filter: string, handler: MessageTextHandler): this {
      this.handlers.set(filter, handler);
      return this;
    }

    catch(handler: ErrorBoundaryHandler): this {
      this.errorBoundary = handler;
      return this;
    }

    async dispatch(ctx: MockContext): Promise<Error | void> {
      const handler = this.handlers.get("message:text");
      if (!handler) {
        throw new Error("message:text handler was not registered");
      }

      try {
        return await handler(ctx);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        this.caughtErrors.push(error);
        if (this.errorBoundary) {
          await this.errorBoundary({ error });
          return;
        }
        throw error;
      }
    }
  }

  return {
    MockBot,
    botInstances: hoistedBotInstances,
  };
});

vi.mock("grammy", () => ({
  Bot: MockBot,
}));

describe("createTelegramAdapter", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    botInstances.length = 0;
    consoleError.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    consoleError.mockReset();
  });

  it("normalizes a private text update and passes it to the pipeline", async () => {
    const onEnvelope = vi.fn(async () => ({ replyText: "hello back" }));
    const adapter = createTelegramAdapter({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
    });

    const bot = expectSingleBot();
    const reply = vi.fn(async () => ({}));
    const replyWithChatAction = vi.fn(async () => true);

    await adapter.start();
    await bot.dispatch({
      message: {
        message_id: 10,
        date: 1_710_000_000,
        chat: { id: 456, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "  hello openpeach  ",
      },
      replyWithChatAction,
      reply,
    });
    await adapter.stop();

    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(onEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        accountId: "bot-main",
        chatType: "private",
        peerId: "456",
        chatId: "456",
        messageId: "10",
        text: "hello openpeach",
      }),
    );
    expect(replyWithChatAction).toHaveBeenCalledWith("typing");
    expect(replyWithChatAction.mock.invocationCallOrder[0]).toBeLessThan(
      reply.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(reply).toHaveBeenCalledWith("hello back");
  });

  it("passes onReplySent through the created bot message handler", async () => {
    const onEnvelope = vi.fn(async () => ({
      replyText: "hello back",
      outboxId: "outbox:telegram:10",
    }));
    const onReplySent = vi.fn(async () => {});
    const reply = vi.fn(async () => ({}));

    createTelegramAdapter({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
      onReplySent,
    });

    const bot = expectSingleBot();
    await bot.dispatch({
      message: createTextMessage(),
      reply,
    });

    expect(reply).toHaveBeenCalledWith("hello back");
    expect(onReplySent).toHaveBeenCalledWith({
      outboxId: "outbox:telegram:10",
    });
  });

  it("marks the generated outbox message as sent only after Telegram reply succeeds", async () => {
    const onEnvelope = vi.fn(async () => ({
      replyText: "hello back",
      outboxId: "outbox:telegram:10",
    }));
    const onReplySent = vi.fn(async () => {});
    const reply = vi.fn(async () => ({}));

    await handleTelegramTextMessage({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
      onReplySent,
      ctx: {
        message: createTextMessage(),
        reply,
      },
    });

    expect(reply).toHaveBeenCalledWith("hello back");
    expect(onReplySent).toHaveBeenCalledWith({
      outboxId: "outbox:telegram:10",
    });
  });

  it("does not mark the outbox sent when Telegram reply fails", async () => {
    const onEnvelope = vi.fn(async () => ({
      replyText: "hello back",
      outboxId: "outbox:telegram:10",
    }));
    const onReplySent = vi.fn(async () => {});
    const reply = vi.fn(async () => {
      throw new Error("telegram upstream rejected telegram-token");
    });

    const result = await handleTelegramTextMessage({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
      onReplySent,
      ctx: {
        message: createTextMessage(),
        reply,
      },
    });

    expect(result).toBeInstanceOf(Error);
    expect(onReplySent).not.toHaveBeenCalled();
  });

  it("refreshes the typing indicator while a long-running turn is still processing", async () => {
    vi.useFakeTimers();

    let resolveEnvelope:
      | ((value: { replyText?: string }) => void)
      | undefined;
    const onEnvelope = vi.fn(
      () =>
        new Promise<{ replyText?: string }>((resolve) => {
          resolveEnvelope = resolve;
        }),
    );

    createTelegramAdapter({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
    });

    const bot = expectSingleBot();
    const reply = vi.fn(async () => ({}));
    const replyWithChatAction = vi.fn(async () => true);

    const dispatchPromise = bot.dispatch({
      message: {
        message_id: 16,
        date: 1_710_000_006,
        chat: { id: 456, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "please think a little longer",
      },
      replyWithChatAction,
      reply,
    });

    await Promise.resolve();
    expect(replyWithChatAction).toHaveBeenCalledTimes(1);
    expect(replyWithChatAction).toHaveBeenNthCalledWith(1, "typing");

    await vi.advanceTimersByTimeAsync(4_000);
    expect(replyWithChatAction).toHaveBeenCalledTimes(2);
    expect(replyWithChatAction).toHaveBeenNthCalledWith(2, "typing");

    await vi.advanceTimersByTimeAsync(4_000);
    expect(replyWithChatAction).toHaveBeenCalledTimes(3);

    resolveEnvelope?.({ replyText: "finished thinking" });
    await dispatchPromise;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(replyWithChatAction).toHaveBeenCalledTimes(3);
    expect(reply).toHaveBeenCalledWith("finished thinking");
  });

  it("does not wait for Telegram typing before starting the pipeline", async () => {
    let resolveTyping: ((value: unknown) => void) | undefined;
    const typingGate = new Promise((resolve) => {
      resolveTyping = resolve;
    });
    const onEnvelope = vi.fn(async () => ({ replyText: "fast reply" }));
    const reply = vi.fn(async () => ({}));
    const replyWithChatAction = vi.fn(() => typingGate);

    const dispatchPromise = handleTelegramTextMessage({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
      ctx: {
        message: createTextMessage(17),
        replyWithChatAction,
        reply,
      },
    });

    await Promise.resolve();

    try {
      expect(replyWithChatAction).toHaveBeenCalledWith("typing");
      expect(onEnvelope).toHaveBeenCalledTimes(1);
    } finally {
      resolveTyping?.(true);
      await dispatchPromise;
    }

    expect(reply).toHaveBeenCalledWith("fast reply");
  });

  it("passes a custom Telegram API root to the grammY client", () => {
    createTelegramAdapter({
      token: "telegram-token",
      apiRoot: "http://127.0.0.1:8788",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "hello back" }),
    });

    const bot = expectSingleBot();
    expect(bot.config).toEqual({
      client: {
        apiRoot: "http://127.0.0.1:8788",
      },
    });
  });

  it("passes a proxy-aware custom fetch to the grammY client when proxy env vars exist", () => {
    createTelegramAdapter({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "hello back" }),
      env: {
        HTTPS_PROXY: "http://proxy.internal:3128",
      },
    });

    const bot = expectSingleBot();
    expect(bot.config).toEqual({
      client: {
        fetch: expect.any(Function),
      },
    });
  });

  it("prefers a custom Telegram API root over auto-wiring proxy fetch", () => {
    createTelegramAdapter({
      token: "telegram-token",
      apiRoot: "http://127.0.0.1:8788",
      botAccountId: "bot-main",
      onEnvelope: async () => ({ replyText: "hello back" }),
      env: {
        HTTPS_PROXY: "http://proxy.internal:3128",
      },
    });

    const bot = expectSingleBot();
    expect(bot.config).toEqual({
      client: {
        apiRoot: "http://127.0.0.1:8788",
      },
    });
  });

  it("ignores group updates in Phase 0", async () => {
    const onEnvelope = vi.fn(async () => ({ replyText: "should not send" }));
    createTelegramAdapter({
      token: "telegram-token",
      botAccountId: "bot-main",
      onEnvelope,
    });

    const bot = expectSingleBot();
    const reply = vi.fn(async () => ({}));

    await bot.dispatch({
      message: {
        message_id: 11,
        date: 1_710_000_001,
        chat: { id: -1000, type: "group" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "hello group",
      },
      reply,
    });

    expect(onEnvelope).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("surfaces a sanitized send failure and keeps handling later messages", async () => {
    const onEnvelope = vi.fn(async () => ({ replyText: "hello back" }));
    const firstReply = vi.fn(async () => {
      throw new Error("telegram upstream rejected telegram-token-secret");
    });
    const secondReply = vi.fn(async () => ({}));

    const failedDispatch = await handleTelegramTextMessage({
      token: "telegram-token-secret",
      botAccountId: "bot-main",
      onEnvelope,
      ctx: {
        message: {
          message_id: 12,
          date: 1_710_000_002,
          chat: { id: 456, type: "private" },
          from: { id: 456, is_bot: false, first_name: "Owner" },
          text: "hello",
        },
        reply: firstReply,
      },
    });

    await expect(
      handleTelegramTextMessage({
        token: "telegram-token-secret",
        botAccountId: "bot-main",
        onEnvelope,
        ctx: {
          message: {
            message_id: 13,
            date: 1_710_000_003,
            chat: { id: 456, type: "private" },
            from: { id: 456, is_bot: false, first_name: "Owner" },
            text: "hello again",
          },
          reply: secondReply,
        },
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    expect(onEnvelope).toHaveBeenCalledTimes(2);
    expect(firstReply).toHaveBeenCalledWith("hello back");
    expect(secondReply).toHaveBeenCalledWith("hello back");
    expect(failedDispatch).toBeInstanceOf(Error);
    expect(failedDispatch?.message).toBe("Telegram send failed");
    expect(failedDispatch?.message).not.toContain("telegram-token-secret");

    const loggedText = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).toContain("Telegram send failed");
    expect(loggedText).not.toContain("telegram-token-secret");
  });

  it("surfaces a sanitized pipeline failure and keeps handling later messages", async () => {
    const onEnvelope = vi
      .fn<(_: unknown) => Promise<{ replyText?: string }>>()
      .mockRejectedValueOnce(new Error("model upstream leaked telegram-token-secret"))
      .mockResolvedValueOnce({ replyText: "recovered reply" });
    const firstReply = vi.fn(async () => ({}));
    const secondReply = vi.fn(async () => ({}));

    const failedDispatch = await handleTelegramTextMessage({
      token: "telegram-token-secret",
      botAccountId: "bot-main",
      onEnvelope,
      ctx: {
        message: {
          message_id: 14,
          date: 1_710_000_004,
          chat: { id: 456, type: "private" },
          from: { id: 456, is_bot: false, first_name: "Owner" },
          text: "first try",
        },
        reply: firstReply,
      },
    });

    await expect(
      handleTelegramTextMessage({
        token: "telegram-token-secret",
        botAccountId: "bot-main",
        onEnvelope,
        ctx: {
          message: {
            message_id: 15,
            date: 1_710_000_005,
            chat: { id: 456, type: "private" },
            from: { id: 456, is_bot: false, first_name: "Owner" },
            text: "second try",
          },
          reply: secondReply,
        },
      }),
    ).resolves.toBeUndefined();

    expect(onEnvelope).toHaveBeenCalledTimes(2);
    expect(firstReply).not.toHaveBeenCalled();
    expect(secondReply).toHaveBeenCalledWith("recovered reply");
    expect(failedDispatch).toBeInstanceOf(Error);
    expect(failedDispatch?.message).toBe("Telegram adapter failed");
    expect(failedDispatch?.message).not.toContain("telegram-token-secret");

    const loggedText = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).toContain("Telegram adapter failed");
    expect(loggedText).not.toContain("telegram-token-secret");
  });
});

describe("createTelegramProxyFetch", () => {
  it("bridges non-native abort signals before calling the underlying fetch", async () => {
    let abortListener: (() => void) | undefined;
    const forwardedSignals: Array<AbortSignal | undefined> = [];
    const fakeFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      forwardedSignals.push(init?.signal);
      return new Response("{}");
    });

    const proxyFetch = createTelegramProxyFetch(
      "http://proxy.internal:3128",
      fakeFetch as unknown as typeof fetch,
    );

    const foreignSignal = {
      aborted: false,
      addEventListener(_type: string, listener: () => void) {
        abortListener = listener;
      },
    } as unknown as AbortSignal;

    await proxyFetch("https://example.com", {
      signal: foreignSignal,
    });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(forwardedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(forwardedSignals[0]).not.toBe(foreignSignal);

    abortListener?.();
    expect(forwardedSignals[0]?.aborted).toBe(true);
  });
});

function expectSingleBot(): MockBot {
  expect(botInstances).toHaveLength(1);
  return botInstances[0]!;
}
