import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createTelegramAdapter } from "../../../packages/channel-telegram/src/index.js";
import { ExternalChatClient } from "../../../packages/model-adapters/src/index.js";
import {
  HomeAgentRuntime,
  initializeRuntimeWorkspace,
  LabAgentRuntime,
  loadAgentProfile,
  MainAgentRuntime,
} from "../../../packages/runtime/src/index.js";
import { createSkillEvolutionEngine } from "../../../packages/skill-evolution/src/index.js";
import { createSkillRegistry } from "../../../packages/skill-registry/src/index.js";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../../packages/store-sqlite/src/index.js";
import { loadConfig } from "./config.js";
import { createGatewayEventPublisher } from "./evolution-publisher.js";
import { createHomeDeviceAdapter, enabledHomeDeviceIds } from "./home-devices.js";
import { handleHumanEnvelope } from "./pipeline.js";
import { formatSkillReviewForTelegram } from "./skill-review.js";

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
  loadAgentProfile({
    openPeachHome: config.openPeachHome,
    familyId: config.familyId,
    agentId: "home",
  });
  const labSystemPrompt = loadAgentProfile({
    openPeachHome: config.openPeachHome,
    familyId: config.familyId,
    agentId: "lab",
  });
  const db = openPeachDb(config.stateDbPath);
  migrate(db);

  const repositories = createRepositories(db);
  const skillRegistry = createSkillRegistry(db);
  const skillEvolution = createSkillEvolutionEngine({ skillRegistry });
  const model = new ExternalChatClient({
    baseUrl: config.modelBaseUrl,
    apiKey: config.modelApiKey,
    model: config.modelName,
    timeoutMs: config.modelTimeoutMs,
  });
  const publishEvent = createGatewayEventPublisher({
    repositories,
    skillEvolution,
    createEventId: randomUUID,
    onEvolutionError() {
      console.error("Skill evolution proposal failed");
    },
  });
  const runtime = new MainAgentRuntime({
    repositories,
    model,
    systemPrompt,
    emit: publishEvent,
    sessionSearch(query) {
      return repositories.searchMessages(query).map((result) => ({
        messageId: result.messageId,
        sessionId: result.sessionId,
        snippet: result.text,
      }));
    },
  });
  const homeRuntime = new HomeAgentRuntime({
    repositories,
    deviceAdapter: createHomeDeviceAdapter({
      enableStoryBunnyToy: config.enableStoryBunnyToy,
    }),
    emit(event) {
      publishEvent(event);
    },
  });
  const labRuntime = new LabAgentRuntime({
    repositories,
    model,
    systemPrompt: labSystemPrompt,
    emit: publishEvent,
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
            enabledDeviceIds: enabledHomeDeviceIds({
              enableStoryBunnyToy: config.enableStoryBunnyToy,
            }),
          },
          repositories,
          runtime,
          homeRuntime,
          labRuntime,
          skillReview: {
            reviewCandidate(candidateId) {
              const review = skillRegistry.getCandidateReview(candidateId);
              return review ? formatSkillReviewForTelegram(review) : undefined;
            },
            approveCandidate(candidateId, input) {
              if (!skillRegistry.getCandidateReview(candidateId)) {
                return undefined;
              }
              skillRegistry.createOwnerApproval({
                approvalId: `skill-approval:${candidateId}:${randomUUID()}`,
                candidateId,
                reviewerIdentity: input.reviewerIdentity,
                decision: "approved",
                reason: input.reason,
              });
              const review = skillRegistry.getCandidateReview(candidateId);
              return review ? formatSkillReviewForTelegram(review) : undefined;
            },
            rejectCandidate(candidateId, input) {
              if (!skillRegistry.getCandidateReview(candidateId)) {
                return undefined;
              }
              skillRegistry.createOwnerApproval({
                approvalId: `skill-approval:${candidateId}:${randomUUID()}`,
                candidateId,
                reviewerIdentity: input.reviewerIdentity,
                decision: "rejected",
                reason: input.reason,
              });
              const review = skillRegistry.getCandidateReview(candidateId);
              return review ? formatSkillReviewForTelegram(review) : undefined;
            },
          },
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
