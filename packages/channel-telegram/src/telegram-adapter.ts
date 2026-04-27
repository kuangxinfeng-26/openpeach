import { Bot } from "grammy";
import {
  ProxyAgent,
  Socks5ProxyAgent,
  fetch as undiciFetch,
} from "undici";
import type { HumanEnvelope } from "../../envelope/src/index.js";
import { normalizeTelegramMessage } from "../../envelope/src/index.js";

type TelegramMessage = Parameters<typeof normalizeTelegramMessage>[0]["message"];

type TelegramMessageContext = {
  message?: TelegramMessage;
  replyWithChatAction?(action: "typing"): Promise<unknown>;
  reply(text: string): Promise<unknown>;
};

type TelegramTypingIndicator = {
  stop(): void;
};

const TELEGRAM_TYPING_REFRESH_INTERVAL_MS = 4_000;

export type HandleTelegramTextMessageInput = {
  token: string;
  botAccountId: string;
  onEnvelope: (
    envelope: HumanEnvelope,
  ) => Promise<{ replyText?: string; outboxId?: string }>;
  onReplySent?: (input: { outboxId: string }) => Promise<void> | void;
  ctx: TelegramMessageContext;
};

export function createTelegramAdapter(input: {
  token: string;
  apiRoot?: string;
  botAccountId: string;
  onEnvelope: (
    envelope: HumanEnvelope,
  ) => Promise<{ replyText?: string; outboxId?: string }>;
  onReplySent?: (input: { outboxId: string }) => Promise<void> | void;
  env?: NodeJS.ProcessEnv;
}): { start(): Promise<void>; stop(): Promise<void> } {
  const client = buildTelegramClientOptions({
    apiRoot: input.apiRoot,
    env: input.env ?? process.env,
  });
  const bot = new Bot(
    input.token,
    client
      ? {
          client,
        }
      : undefined,
  );
  bot.catch((error: { error: Error }) => {
    console.error(toHandledTelegramError(error.error, input.token).message);
  });

  bot.on("message:text", async (ctx: TelegramMessageContext) => {
    return handleTelegramTextMessage({
      token: input.token,
      botAccountId: input.botAccountId,
      onEnvelope: input.onEnvelope,
      onReplySent: input.onReplySent,
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

type TelegramClientOptions = {
  apiRoot?: string;
  fetch?: typeof fetch;
};

type TelegramClientOptionsInput = {
  apiRoot?: string;
  env: NodeJS.ProcessEnv;
};

const proxyFetchCache = new Map<string, typeof fetch>();

function buildTelegramClientOptions(
  input: TelegramClientOptionsInput,
): TelegramClientOptions | undefined {
  const client: TelegramClientOptions = {};

  if (input.apiRoot) {
    client.apiRoot = input.apiRoot;
  } else {
    const proxyFetch = createProxyAwareFetch(input.env);
    if (proxyFetch) {
      client.fetch = proxyFetch;
    }
  }

  return Object.keys(client).length > 0 ? client : undefined;
}

function createProxyAwareFetch(
  env: NodeJS.ProcessEnv,
): typeof fetch | undefined {
  const proxyUrl = resolveProxyUrl(env);
  if (!proxyUrl) {
    return undefined;
  }

  const cached = proxyFetchCache.get(proxyUrl);
  if (cached) {
    return cached;
  }

  const proxiedFetch = createTelegramProxyFetch(proxyUrl);
  proxyFetchCache.set(proxyUrl, proxiedFetch);
  return proxiedFetch;
}

export function createTelegramProxyFetch(
  proxyUrl: string,
  fetchImpl: typeof fetch = undiciFetch as typeof fetch,
): typeof fetch {
  const dispatcher = createProxyDispatcher(proxyUrl);

  return ((input, init) =>
    fetchImpl(input, withBridgedAbortSignal(init, dispatcher))) as typeof fetch;
}

function resolveProxyUrl(env: NodeJS.ProcessEnv): string | undefined {
  const candidates = [
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
    env.ALL_PROXY,
    env.all_proxy,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function createProxyDispatcher(proxyUrl: string) {
  if (proxyUrl.startsWith("socks5://") || proxyUrl.startsWith("socks5h://")) {
    return new Socks5ProxyAgent(proxyUrl);
  }

  return new ProxyAgent(proxyUrl);
}

function withBridgedAbortSignal(
  init: RequestInit | undefined,
  dispatcher: ReturnType<typeof createProxyDispatcher>,
): Parameters<typeof undiciFetch>[1] {
  const nextInit = {
    ...(init ?? {}),
    dispatcher,
  } as Parameters<typeof undiciFetch>[1];

  const signal = init?.signal as
    | {
        aborted?: boolean;
        addEventListener?: (
          type: string,
          listener: () => void,
          options?: { once?: boolean },
        ) => void;
      }
    | undefined;

  if (!signal) {
    return nextInit;
  }

  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener?.("abort", () => controller.abort(), {
      once: true,
    });
  }
  nextInit.signal = controller.signal;

  return nextInit;
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

    const typingIndicator = startTypingIndicator(input.ctx);
    let result: { replyText?: string; outboxId?: string };
    try {
      result = await runPipeline(input, envelope);
    } finally {
      typingIndicator.stop();
    }

    if (!result.replyText) {
      return;
    }

    await sendReply(input.ctx, result.replyText, input.token);
    if (result.outboxId) {
      await input.onReplySent?.({ outboxId: result.outboxId });
    }
  } catch (error) {
    const handledError = toHandledTelegramError(error, input.token);
    console.error(handledError.message);
    return handledError;
  }
}

function startTypingIndicator(
  ctx: TelegramMessageContext,
): TelegramTypingIndicator {
  if (!ctx.replyWithChatAction) {
    return createNoopTypingIndicator();
  }

  void sendTypingAction(ctx);

  const timer = setInterval(() => {
    void sendTypingAction(ctx);
  }, TELEGRAM_TYPING_REFRESH_INTERVAL_MS);
  timer.unref?.();

  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

function createNoopTypingIndicator(): TelegramTypingIndicator {
  return {
    stop(): void {},
  };
}

async function sendTypingAction(ctx: TelegramMessageContext): Promise<void> {
  if (!ctx.replyWithChatAction) {
    return;
  }

  try {
    await ctx.replyWithChatAction("typing");
  } catch {}
}

async function runPipeline(
  input: {
    token: string;
    onEnvelope: (
      envelope: HumanEnvelope,
    ) => Promise<{ replyText?: string; outboxId?: string }>;
  },
  envelope: HumanEnvelope,
): Promise<{ replyText?: string; outboxId?: string }> {
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
