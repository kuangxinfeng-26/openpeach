import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createTelegramAdapter } from "../../../packages/channel-telegram/src/index.js";
import { createEventBus } from "../../../packages/event-bus/src/index.js";
import { ExternalChatClient } from "../../../packages/model-adapters/src/index.js";
import {
  initializeRuntimeWorkspace,
  loadAgentProfile,
  MainAgentRuntime,
} from "../../../packages/runtime/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../../packages/store-sqlite/src/index.js";
import { loadConfig } from "./config.js";
import { handleHumanEnvelope } from "./pipeline.js";

const PHASE0_TELEGRAM_BOT_ACCOUNT_ID = "bot-main";

export async function main(): Promise<void> {
  const config = loadConfig();
  initializeRuntimeWorkspace({
    openPeachHome: config.openPeachHome,
    familyId: config.familyId,
    templateRoot: `${process.cwd()}/.openpeach`,
  });
  const systemPrompt = loadAgentProfile({
    openPeachHome: config.openPeachHome,
    familyId: config.familyId,
    agentId: config.coreAgentId,
  });
  const db = openPeachDb(config.stateDbPath);
  migrate(db);

  const repositories = createRepositories(db);
  const model = new ExternalChatClient({
    baseUrl: config.modelBaseUrl,
    apiKey: config.modelApiKey,
    model: config.modelName,
    timeoutMs: config.modelTimeoutMs,
  });
  const eventBus = createEventBus(repositories);
  const runtime = new MainAgentRuntime({
    repositories,
    model,
    systemPrompt,
    emit(event) {
      eventBus.publish({
        eventId: randomUUID(),
        event,
        createdAtMs: Date.now(),
      });
    },
    sessionSearch(query) {
      return repositories.searchMessages(query).map((result) => ({
        messageId: result.messageId,
        sessionId: result.sessionId,
        snippet: result.text,
      }));
    },
  });

  const telegram = createTelegramAdapter({
    token: config.telegramBotToken,
    apiRoot: config.telegramApiRoot,
    botAccountId: PHASE0_TELEGRAM_BOT_ACCOUNT_ID,
    async onEnvelope(envelope) {
      const result = await handleHumanEnvelope({
        envelope,
        deps: {
          config: {
            familyId: config.familyId,
            ownerTelegramUserIds: config.ownerTelegramUserIds,
            coreAgentId: config.coreAgentId,
          },
          repositories,
          runtime,
        },
      });

      return result.ok ? { replyText: result.replyText, outboxId: result.outboxId } : {};
    },
    onReplySent({ outboxId }) {
      repositories.markOutboxSent(outboxId);
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    try {
      console.error(`Received ${signal}, stopping gateway`);
      await telegram.stop();
    } finally {
      db.close();
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await telegram.start();
  } catch (error) {
    db.close();
    throw error;
  }
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint) {
  void main().catch(() => {
    console.error("Gateway startup failed");
    process.exitCode = 1;
  });
}
