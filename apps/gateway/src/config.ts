import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";

export type GatewayConfig = {
  stateDbPath: string;
  familyId: string;
  coreAgentId: "main";
  ownerTelegramUserIds: string[];
  telegramBotToken: string;
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelTimeoutMs: number;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const coreAgentId = requireMainAgentId(env.TAOQIBAO_CORE_AGENT_ID);

  return {
    stateDbPath: env.TAOQIBAO_STATE_DB?.trim() || join(homedir(), ".taoqibao", "state.db"),
    familyId: requireEnv(env, "TAOQIBAO_FAMILY_ID"),
    coreAgentId,
    ownerTelegramUserIds: splitCsv(
      requireEnv(env, "TAOQIBAO_OWNER_TELEGRAM_USER_IDS"),
      "TAOQIBAO_OWNER_TELEGRAM_USER_IDS",
    ),
    telegramBotToken: requireEnv(env, "TELEGRAM_BOT_TOKEN"),
    modelBaseUrl: requireEnv(env, "TAOQIBAO_MODEL_BASE_URL"),
    modelApiKey: requireEnv(env, "TAOQIBAO_MODEL_API_KEY"),
    modelName: requireEnv(env, "TAOQIBAO_MODEL_NAME"),
    modelTimeoutMs: parsePositiveInt(
      requireEnv(env, "TAOQIBAO_MODEL_TIMEOUT_MS"),
      "TAOQIBAO_MODEL_TIMEOUT_MS",
    ),
    logLevel: requireEnv(env, "TAOQIBAO_LOG_LEVEL"),
  };
}

function requireEnv(
  env: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return value;
}

function splitCsv(value: string, key: string): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return items;
}

function parsePositiveInt(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer env var: ${key}`);
  }

  return parsed;
}

function requireMainAgentId(value: string | undefined): "main" {
  if ((value?.trim() ?? "") !== "main") {
    throw new Error("TAOQIBAO_CORE_AGENT_ID must be 'main' in Phase 0");
  }

  return "main";
}
