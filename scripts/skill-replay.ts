import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillReplayRunner } from "../packages/skill-replay/src/index.js";
import type { SkillReplayRun } from "../packages/skill-registry/src/index.js";
import { createSkillRegistry } from "../packages/skill-registry/src/index.js";
import {
  createRepositories,
  openPeachDb,
} from "../packages/store-sqlite/src/index.js";

export type SkillReplayCliInput = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export function runSkillReplayOnCandidate(input: {
  dbPath: string;
  candidateId: string;
  replayRunId: string;
}): SkillReplayRun {
  const db = openPeachDb(input.dbPath);

  try {
    const repositories = createRepositories(db);
    return createSkillReplayRunner({
      skillRegistry: createSkillRegistry(db),
      taskStore: repositories,
    }).runCandidateReplay({
      candidateId: input.candidateId,
      replayRunId: input.replayRunId,
    });
  } finally {
    db.close();
  }
}

export function formatSkillReplayJson(replayRun: SkillReplayRun): string {
  return JSON.stringify(replayRun, null, 2);
}

export function runSkillReplayCli(input: SkillReplayCliInput): number {
  let parsedArgs: ReturnType<typeof parseSkillReplayArgs>;
  try {
    parsedArgs = parseSkillReplayArgs(input.argv);
  } catch (error) {
    input.stderr(toErrorMessage(error));
    input.stderr(skillReplayUsage());
    return 1;
  }
  if (parsedArgs.help) {
    input.stdout(skillReplayUsage());
    return 0;
  }
  if (!parsedArgs.candidateId) {
    input.stderr(skillReplayUsage());
    return 1;
  }

  const replayRunId =
    parsedArgs.replayRunId ??
    `replay:${parsedArgs.candidateId}:${Date.now().toString(36)}`;
  const dbPath = parsedArgs.dbPath ?? resolveSkillReplayDbPath(input.env);

  try {
    const replayRun = runSkillReplayOnCandidate({
      dbPath,
      candidateId: parsedArgs.candidateId,
      replayRunId,
    });
    input.stdout(formatSkillReplayJson(replayRun));
    return 0;
  } catch (error) {
    const message = toErrorMessage(error);
    input.stderr(message);
    return message.startsWith("skill candidate not found:") ? 2 : 1;
  }
}

function parseSkillReplayArgs(argv: string[]): {
  candidateId?: string;
  dbPath?: string;
  help: boolean;
  replayRunId?: string;
} {
  const result: {
    candidateId?: string;
    dbPath?: string;
    help: boolean;
    replayRunId?: string;
  } = {
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--db") {
      result.dbPath = requireArgValue(argv, ++index, "--db");
      continue;
    }
    if (arg === "--run-id") {
      result.replayRunId = requireArgValue(argv, ++index, "--run-id");
      continue;
    }
    if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (result.candidateId) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    result.candidateId = arg;
  }

  return result;
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function resolveSkillReplayDbPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.TAOQIBAO_STATE_DB?.trim();
  if (explicit) {
    return expandHomePath(explicit);
  }

  const openPeachHome = expandHomePath(
    env.OPENPEACH_HOME?.trim() || join(homedir(), ".openpeach"),
  );
  const familyId = env.TAOQIBAO_FAMILY_ID?.trim() || "main";

  return join(openPeachHome, "families", familyId, "state.db");
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

function skillReplayUsage(): string {
  return [
    "Usage: npm run skill:replay -- <candidate_id> [--run-id <id>] [--db <state.db>]",
    "",
    "Runs the local OpenPeach skill replay checks and stores a replay run in SQLite.",
    "Defaults to TAOQIBAO_STATE_DB or $OPENPEACH_HOME/families/$TAOQIBAO_FAMILY_ID/state.db.",
  ].join("\n");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown skill replay error";
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  loadDotenv({ override: true });
  process.exitCode = runSkillReplayCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout(message) {
      console.log(message);
    },
    stderr(message) {
      console.error(message);
    },
  });
}
