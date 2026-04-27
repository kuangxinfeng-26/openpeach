import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getDefaultOpenPeachModelConfigPath,
  parseOpenPeachModelProfileToml,
  resolveOpenPeachModelProfile,
  syncOpenPeachEnvText,
} from "./openpeach-profile-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const configPath = resolve(
  process.cwd(),
  args.config ?? getDefaultOpenPeachModelConfigPath(process.cwd()),
);
const envFilePath = resolve(process.cwd(), args.envFile ?? ".env");

if (!existsSync(configPath)) {
  throw new Error(`OpenPeach model config not found: ${configPath}`);
}

const profile = parseOpenPeachModelProfileToml(readFileSync(configPath, "utf8"));
const resolvedProfile = resolveOpenPeachModelProfile(profile);
const existingEnvText = existsSync(envFilePath)
  ? readFileSync(envFilePath, "utf8")
  : "";

writeFileSync(
  envFilePath,
  syncOpenPeachEnvText(existingEnvText, resolvedProfile),
  "utf8",
);

console.log(
  `Synced OpenPeach runtime model config from ${configPath} into ${envFilePath}`,
);

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--config":
        result.config = requireValue(argv, ++index, "--config");
        break;
      case "--env-file":
        result.envFile = requireValue(argv, ++index, "--env-file");
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-openpeach-env-from-profile.mjs [options]

Options:
  --config <path>    Path to the OpenPeach model profile TOML file.
  --env-file <path>  Path to the OpenPeach runtime .env file.
  --help             Show this help.
`);
}
