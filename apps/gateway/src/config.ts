import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";

// OpenPeach treats the runtime .env as the local deployment source of truth.
// This prevents inherited host proxy variables from bypassing a configured
// local mihomo sidecar in WSL or systemd environments.
loadDotenv({ override: true });

export type GatewayConfig = {
  openPeachHome: string;
  stateDbPath: string;
  familyId: string;
  coreAgentId: "main";
  ownerTelegramUserIds: string[];
  telegramBotToken: string;
  telegramApiRoot?: string;
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  modelTimeoutMs: number;
  logLevel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const coreAgentId = requireMainAgentId(env.TAOQIBAO_CORE_AGENT_ID);
  const familyId = requireEnv(env, "TAOQIBAO_FAMILY_ID");
  const openPeachHome = resolveOpenPeachHome(env);

  return {
    openPeachHome,
    stateDbPath: resolveStateDbPath(env, { openPeachHome, familyId }),
    familyId,
    coreAgentId,
    ownerTelegramUserIds: splitCsv(
      requireEnv(env, "TAOQIBAO_OWNER_TELEGRAM_USER_IDS"),
      "TAOQIBAO_OWNER_TELEGRAM_USER_IDS",
    ),
    telegramBotToken: requireEnv(env, "TELEGRAM_BOT_TOKEN"),
    telegramApiRoot: optionalEnv(env, "TAOQIBAO_TELEGRAM_API_ROOT"),
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

export function resolveOpenPeachHome(env: NodeJS.ProcessEnv = process.env): string {
  const rawValue = env.OPENPEACH_HOME?.trim();
  if (!rawValue) {
    return join(homedir(), ".openpeach");
  }

  return expandHomePath(rawValue);
}

export function resolveStateDbPath(
  env: NodeJS.ProcessEnv = process.env,
  defaults?: { openPeachHome: string; familyId: string },
): string {
  const rawValue = env.TAOQIBAO_STATE_DB?.trim();
  if (!rawValue) {
    const openPeachHome = defaults?.openPeachHome ?? resolveOpenPeachHome(env);
    const familyId = defaults?.familyId ?? env.TAOQIBAO_FAMILY_ID?.trim() ?? "main";
    return join(openPeachHome, "families", familyId, "state.db");
  }

  return expandHomePath(rawValue);
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

function optionalEnv(
  env: NodeJS.ProcessEnv,
  key: keyof NodeJS.ProcessEnv,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
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
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Invalid positive integer env var: ${key}`);
  }

  const parsed = Number.parseInt(value, 10);
  return parsed;
}

function requireMainAgentId(value: string | undefined): "main" {
  if ((value?.trim() ?? "") !== "main") {
    throw new Error("TAOQIBAO_CORE_AGENT_ID must be 'main' in Phase 0");
  }

  return "main";
}

function expandHomePath(value: string): string {
  const prefixes = ["$HOME/", "$HOME\\", "~/", "~\\"];

  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return join(homedir(), value.slice(prefix.length));
    }
  }

  if (value === "$HOME" || value === "~") {
    return homedir();
  }

  return value;
}
