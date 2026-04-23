import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  reply: ReturnType<typeof vi.fn>;
};

type MessageTextHandler = (ctx: MockContext) => Promise<Error | void>;
type ErrorBoundaryHandler = (error: { error: Error }) => Promise<void> | void;

const { MockBot, botInstances } = vi.hoisted(() => {
  const hoistedBotInstances: MockBot[] = [];

  class MockBot {
    readonly handlers = new Map<string, MessageTextHandler>();
    readonly caughtErrors: Error[] = [];
    readonly start = vi.fn(async () => {});
    readonly stop = vi.fn(async () => {});
    private errorBoundary?: ErrorBoundaryHandler;

    constructor(readonly token: string) {
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

    await adapter.start();
    await bot.dispatch({
      message: {
        message_id: 10,
        date: 1_710_000_000,
        chat: { id: 456, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "  你好，淘气包  ",
      },
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
        text: "你好，淘气包",
      }),
    );
    expect(reply).toHaveBeenCalledWith("hello back");
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

function expectSingleBot(): MockBot {
  expect(botInstances).toHaveLength(1);
  return botInstances[0]!;
}
