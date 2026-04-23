import { Bot } from "grammy";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import { normalizeTelegramMessage } from "../../envelope/src/index.js";

type TelegramMessage = Parameters<typeof normalizeTelegramMessage>[0]["message"];

type TelegramMessageContext = {
  message?: TelegramMessage;
  reply(text: string): Promise<unknown>;
};

export type HandleTelegramTextMessageInput = {
  token: string;
  botAccountId: string;
  onEnvelope: (envelope: HumanEnvelope) => Promise<{ replyText?: string }>;
  ctx: TelegramMessageContext;
};

export function createTelegramAdapter(input: {
  token: string;
  botAccountId: string;
  onEnvelope: (envelope: HumanEnvelope) => Promise<{ replyText?: string }>;
}): { start(): Promise<void>; stop(): Promise<void> } {
  const bot = new Bot(input.token);
  bot.catch((error: { error: Error }) => {
    console.error(toHandledTelegramError(error.error, input.token).message);
  });

  bot.on("message:text", async (ctx: TelegramMessageContext) => {
    return handleTelegramTextMessage({
      token: input.token,
      botAccountId: input.botAccountId,
      onEnvelope: input.onEnvelope,
      ctx,
    });
  });

  return {
    start(): Promise<void> {
      return bot.start();
    },
    stop(): Promise<void> {
      return bot.stop();
    },
  };
}

export async function handleTelegramTextMessage(
  input: HandleTelegramTextMessageInput,
): Promise<Error | void> {
  try {
    const message = input.ctx.message;
    if (!message || message.chat.type !== "private") {
      return;
    }

    const envelope = normalizeTelegramMessage({
      botAccountId: input.botAccountId,
      message,
    });

    const result = await runPipeline(input, envelope);
    if (!result.replyText) {
      return;
    }

    await sendReply(input.ctx, result.replyText, input.token);
  } catch (error) {
    const handledError = toHandledTelegramError(error, input.token);
    console.error(handledError.message);
    return handledError;
  }
}

async function runPipeline(
  input: {
    token: string;
    onEnvelope: (envelope: HumanEnvelope) => Promise<{ replyText?: string }>;
  },
  envelope: HumanEnvelope,
): Promise<{ replyText?: string }> {
  try {
    return await input.onEnvelope(envelope);
  } catch (error) {
    throw sanitizeTelegramError(error, input.token, "Telegram adapter failed");
  }
}

async function sendReply(
  ctx: TelegramMessageContext,
  replyText: string,
  token: string,
): Promise<void> {
  try {
    await ctx.reply(replyText);
  } catch (error) {
    throw sanitizeTelegramError(error, token, "Telegram send failed");
  }
}

function sanitizeTelegramError(
  _error: unknown,
  _token: string,
  fallbackMessage: string,
): Error {
  return new Error(fallbackMessage);
}

function toHandledTelegramError(error: unknown, token: string): Error {
  if (
    error instanceof Error &&
    (error.message === "Telegram send failed" ||
      error.message === "Telegram adapter failed")
  ) {
    return error;
  }

  return sanitizeTelegramError(error, token, "Telegram adapter failed");
}
