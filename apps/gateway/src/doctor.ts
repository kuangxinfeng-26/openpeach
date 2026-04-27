import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeRuntimeWorkspace,
  loadAgentProfile,
} from "../../../packages/runtime/src/index.js";
import { migrate, openPeachDb } from "../../../packages/store-sqlite/src/index.js";
import { loadConfig, resolveStateDbPath } from "./config.js";

export type DoctorCheck = {
  name:
    | "node-version"
    | "required-env"
    | "state-db-path"
    | "runtime-workspace"
    | "fts5-migration"
    | "telegram-token"
    | "model-config";
  ok: boolean;
  detail: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
};

const REQUIRED_ENV_KEYS = [
  "TAOQIBAO_FAMILY_ID",
  "TAOQIBAO_CORE_AGENT_ID",
  "TAOQIBAO_OWNER_TELEGRAM_USER_IDS",
  "TELEGRAM_BOT_TOKEN",
  "TAOQIBAO_MODEL_BASE_URL",
  "TAOQIBAO_MODEL_API_KEY",
  "TAOQIBAO_MODEL_NAME",
  "TAOQIBAO_MODEL_TIMEOUT_MS",
  "TAOQIBAO_LOG_LEVEL",
] as const;

const MODEL_ENV_KEYS = [
  "TAOQIBAO_MODEL_BASE_URL",
  "TAOQIBAO_MODEL_API_KEY",
  "TAOQIBAO_MODEL_NAME",
  "TAOQIBAO_MODEL_TIMEOUT_MS",
] as const;

export function runDoctor(env: NodeJS.ProcessEnv = process.env): DoctorResult {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion(process.versions.node));
  checks.push(checkRequiredEnv(env));
  checks.push(checkStateDbPath(env));
  checks.push(checkRuntimeWorkspace(env));
  checks.push(checkFts5Migration());
  checks.push(checkTelegramToken(env));
  checks.push(checkModelConfig(env));

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export function main(): number {
  const result = runDoctor();

  for (const check of result.checks) {
    const status = check.ok ? "[ok]" : "[fail]";
    console.log(`${status} ${check.name}: ${check.detail}`);
  }

  if (result.ok) {
    console.log("Doctor passed");
    return 0;
  }

  console.error("Doctor failed");
  return 1;
}

function checkNodeVersion(nodeVersion: string): DoctorCheck {
  const [major] = parseNodeVersion(nodeVersion);

  if (major >= 22) {
    return {
      name: "node-version",
      ok: true,
      detail: `Node ${nodeVersion} satisfies >= 22`,
    };
  }

  return {
    name: "node-version",
    ok: false,
    detail: `Node ${nodeVersion} does not satisfy >= 22`,
  };
}

function checkRequiredEnv(env: NodeJS.ProcessEnv): DoctorCheck {
  const missing = missingEnvKeys(env, REQUIRED_ENV_KEYS);
  if (missing.length > 0) {
    return {
      name: "required-env",
      ok: false,
      detail: `Missing required env vars: ${missing.join(", ")}`,
    };
  }

  try {
    loadConfig(env);
  } catch (error) {
    return {
      name: "required-env",
      ok: false,
      detail: safeErrorMessage(error, "Invalid gateway configuration"),
    };
  }

  return {
    name: "required-env",
    ok: true,
    detail: "Required env vars are present",
  };
}

function checkStateDbPath(env: NodeJS.ProcessEnv): DoctorCheck {
  const stateDbPath = resolveStateDbPath(env);
  const existedBeforeProbe = existsSync(stateDbPath);

  try {
    mkdirSync(dirname(stateDbPath), { recursive: true });
    const db = openPeachDb(stateDbPath);
    db.close();

    if (!existedBeforeProbe) {
      rmSync(stateDbPath, { force: true });
      rmSync(`${stateDbPath}-shm`, { force: true });
      rmSync(`${stateDbPath}-wal`, { force: true });
    }

    return {
      name: "state-db-path",
      ok: true,
      detail: "SQLite DB path is writable",
    };
  } catch (error) {
    return {
      name: "state-db-path",
      ok: false,
      detail: `SQLite DB path is not writable: ${safeErrorMessage(error, "Unknown error")}`,
    };
  }
}

function checkRuntimeWorkspace(env: NodeJS.ProcessEnv): DoctorCheck {
  try {
    const config = loadConfig(env);
    initializeRuntimeWorkspace({
      openPeachHome: config.openPeachHome,
      familyId: config.familyId,
    });
    const profile = loadAgentProfile({
      openPeachHome: config.openPeachHome,
      familyId: config.familyId,
      agentId: config.coreAgentId,
    });

    if (profile.length === 0) {
      throw new Error("main agent profile is empty");
    }

    return {
      name: "runtime-workspace",
      ok: true,
      detail: "Runtime workspace is initialized",
    };
  } catch (error) {
    return {
      name: "runtime-workspace",
      ok: false,
      detail: `Runtime workspace is not ready: ${safeErrorMessage(error, "Unknown error")}`,
    };
  }
}
function checkFts5Migration(): DoctorCheck {
  let dir: string | undefined;

  try {
    dir = mkdtempSync(join(tmpdir(), "openpeach-doctor-"));
    const db = openPeachDb(join(dir, "doctor.db"));

    try {
      migrate(db);
      db.prepare(
        `
          INSERT INTO session_messages_fts (message_id, session_id, text)
          VALUES (?, ?, ?)
        `,
      ).run("message-1", "session-1", "doctor phrase");

      const row = db
        .prepare(
          `
            SELECT message_id
            FROM session_messages_fts
            WHERE session_messages_fts MATCH ?
          `,
        )
        .get("phrase") as { message_id: string } | undefined;

      if (row?.message_id !== "message-1") {
        throw new Error("FTS5 query did not return the inserted row");
      }
    } finally {
      db.close();
    }

    return {
      name: "fts5-migration",
      ok: true,
      detail: "FTS5 migration works in a temporary database",
    };
  } catch (error) {
    return {
      name: "fts5-migration",
      ok: false,
      detail: `FTS5 migration failed: ${safeErrorMessage(error, "Unknown error")}`,
    };
  } finally {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function checkTelegramToken(env: NodeJS.ProcessEnv): DoctorCheck {
  if (env.TELEGRAM_BOT_TOKEN?.trim()) {
    return {
      name: "telegram-token",
      ok: true,
      detail: "Telegram bot token is configured",
    };
  }

  return {
    name: "telegram-token",
    ok: false,
    detail: "Telegram bot token is missing",
  };
}

function checkModelConfig(env: NodeJS.ProcessEnv): DoctorCheck {
  const missing = missingEnvKeys(env, MODEL_ENV_KEYS);
  if (missing.length > 0) {
    return {
      name: "model-config",
      ok: false,
      detail: `Model config is missing: ${missing.join(", ")}`,
    };
  }

  return {
    name: "model-config",
    ok: true,
    detail: "Model config is configured",
  };
}

function missingEnvKeys(
  env: NodeJS.ProcessEnv,
  keys: ReadonlyArray<keyof NodeJS.ProcessEnv>,
): string[] {
  return keys.filter((key) => !(env[key]?.trim() ?? "")).map(String);
}

function parseNodeVersion(nodeVersion: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion);
  if (!match) {
    return [0, 0, 0];
  }

  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isEntrypoint) {
  process.exitCode = main();
}
