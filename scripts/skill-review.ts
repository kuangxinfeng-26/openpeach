import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSkillRegistry,
  type SkillCandidateReview,
} from "../packages/skill-registry/src/index.js";
import { openPeachReadonlyDb } from "../packages/store-sqlite/src/index.js";

export type SkillReviewCliInput = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export function reviewSkillCandidate(input: {
  dbPath: string;
  candidateId: string;
}): SkillCandidateReview | undefined {
  const db = openPeachReadonlyDb(input.dbPath);

  try {
    return createSkillRegistry(db).getCandidateReview(input.candidateId);
  } finally {
    db.close();
  }
}

export function formatSkillCandidateReviewJson(
  review: SkillCandidateReview | undefined,
): string {
  return JSON.stringify(review, null, 2);
}

export function runSkillReviewCli(input: SkillReviewCliInput): number {
  let parsedArgs: ReturnType<typeof parseSkillReviewArgs>;
  try {
    parsedArgs = parseSkillReviewArgs(input.argv);
  } catch (error) {
    input.stderr(toErrorMessage(error));
    input.stderr(skillReviewUsage());
    return 1;
  }
  if (parsedArgs.help) {
    input.stdout(skillReviewUsage());
    return 0;
  }
  if (!parsedArgs.candidateId) {
    input.stderr(skillReviewUsage());
    return 1;
  }

  const dbPath = parsedArgs.dbPath ?? resolveSkillReviewDbPath(input.env);

  try {
    const review = reviewSkillCandidate({
      dbPath,
      candidateId: parsedArgs.candidateId,
    });
    if (!review) {
      input.stderr(`Skill candidate not found: ${parsedArgs.candidateId}`);
      return 2;
    }

    input.stdout(formatSkillCandidateReviewJson(review));
    return 0;
  } catch (error) {
    input.stderr(toErrorMessage(error));
    return 1;
  }
}

function parseSkillReviewArgs(argv: string[]): {
  candidateId?: string;
  dbPath?: string;
  help: boolean;
} {
  const result: { candidateId?: string; dbPath?: string; help: boolean } = {
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

function resolveSkillReviewDbPath(env: NodeJS.ProcessEnv): string {
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

function skillReviewUsage(): string {
  return [
    "Usage: npm run skill:review -- <candidate_id> [--db <state.db>]",
    "",
    "Reads the OpenPeach SQLite state database and prints a skill candidate review as JSON.",
    "Defaults to TAOQIBAO_STATE_DB or $OPENPEACH_HOME/families/$TAOQIBAO_FAMILY_ID/state.db.",
  ].join("\n");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "unknown skill review error";
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  loadDotenv({ override: true });
  process.exitCode = runSkillReviewCli({
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
