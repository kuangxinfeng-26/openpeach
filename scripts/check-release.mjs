import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  filterExistingCandidateFiles,
  findForbiddenReleaseFiles,
  findMissingRequiredFiles,
  findSecretLikeContent,
  releaseCheckCommands,
} from "./release-check-lib.mjs";

const candidateFiles = readGitCandidateFiles();
const existingFiles = filterExistingCandidateFiles(candidateFiles, (file) => {
  if (!existsSync(file)) {
    return false;
  }

  return statSync(file).isFile();
});

let failed = false;

failed =
  reportList(
    "Forbidden private/generated files would be published",
    findForbiddenReleaseFiles(existingFiles),
  ) || failed;
failed =
  reportList(
    "Required release files are missing",
    findMissingRequiredFiles(new Set(existingFiles)),
  ) || failed;
failed =
  reportSecretFindings(
    findSecretLikeContent(readTextCandidateFiles(existingFiles)),
  ) || failed;

if (failed) {
  process.exit(1);
}

console.log("[ok] release file hygiene");

for (const args of releaseCheckCommands) {
  const exitCode = await runNpm(args);
  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
  }
}

function readGitCandidateFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "-co", "--exclude-standard"],
    { encoding: "buffer" },
  );

  return output
    .toString("utf8")
    .split("\0")
    .filter((file) => file.length > 0);
}

function reportList(title, items) {
  if (items.length === 0) {
    return false;
  }

  console.error(`[fail] ${title}:`);
  for (const item of items) {
    console.error(`- ${item}`);
  }
  return true;
}

function reportSecretFindings(items) {
  if (items.length === 0) {
    return false;
  }

  console.error("[fail] Secret-like content found in release candidates:");
  for (const item of items) {
    console.error(`- ${item.path}:${item.line} ${item.kind}`);
  }
  return true;
}

function readTextCandidateFiles(files) {
  const readableExtensions = new Set([
    ".cjs",
    ".css",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yml",
    ".yaml",
  ]);

  return files
    .filter((file) => readableExtensions.has(fileExtension(file)) || file.startsWith(".env"))
    .map((file) => ({
      path: file,
      text: readFileSync(file, "utf8"),
    }));
}

function fileExtension(file) {
  const slashIndex = file.lastIndexOf("/");
  const dotIndex = file.lastIndexOf(".");
  if (dotIndex <= slashIndex) {
    return "";
  }

  return file.slice(dotIndex);
}

async function runNpm(args) {
  console.log(`> npm ${args.join(" ")}`);

  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
          stdio: "inherit",
        })
      : spawn("npm", args, {
          stdio: "inherit",
        });

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
