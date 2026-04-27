export const releaseCheckCommands = [
  ["audit"],
  ["run", "check"],
  ["test"],
  ["run", "build"],
  ["run", "doctor"],
];

export const requiredReleaseFiles = [
  ".env.example",
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "deploy/linux/install-openpeach.sh",
  "docs/open-source-readiness.md",
  "docs/phase0-runbook.md",
  "package.json",
];

const forbiddenExactFiles = new Set([
  ".env",
  ".openpeach/model.runtime.local.toml",
]);

const forbiddenPrefixes = [
  ".tmp/",
  "_sources/",
  "generated/",
  "node_modules/",
  ".codex/",
  ".pytest_cache/",
  ".superpowers/",
  ".worktrees/",
];

export function findForbiddenReleaseFiles(files) {
  return files.map(normalizePath).filter((file) => isForbiddenReleaseFile(file));
}

export function filterExistingCandidateFiles(files, existsFile) {
  return files.map(normalizePath).filter((file) => existsFile(file));
}

export function findMissingRequiredFiles(files) {
  const normalizedFiles = new Set([...files].map(normalizePath));
  return requiredReleaseFiles.filter((file) => !normalizedFiles.has(file));
}

export function findSecretLikeContent(files) {
  const findings = [];

  for (const file of files) {
    const lines = file.text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const kind = classifySecretLine(line);
      if (kind) {
        findings.push({
          path: normalizePath(file.path),
          line: index + 1,
          kind,
        });
      }
    }
  }

  return findings;
}

function isForbiddenReleaseFile(file) {
  if (forbiddenExactFiles.has(file)) {
    return true;
  }

  if (file.startsWith(".env.") && file !== ".env.example") {
    return true;
  }

  if (file.startsWith("deploy/mihomo/") && file.endsWith(".local.env")) {
    return true;
  }

  if (file.endsWith(".log") || file.endsWith(".db") || file.endsWith(".db-shm") || file.endsWith(".db-wal")) {
    return true;
  }

  return forbiddenPrefixes.some((prefix) => file.startsWith(prefix));
}

function normalizePath(file) {
  return file.replaceAll("\\", "/");
}

function classifySecretLine(line) {
  if (/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/.test(line)) {
    return "telegram-bot-token";
  }

  if (/\bAIza[0-9A-Za-z_-]{30,45}\b/.test(line)) {
    return "google-api-key";
  }

  const quotedAssignment =
    /(?:^|[\s"',{])([A-Za-z0-9_-]*(?:api[_-]?key|token|password|passwd|secret)[A-Za-z0-9_-]*)\s*[:=]\s*(["'])([^"']{16,})\2/i.exec(
      line,
    );
  const envAssignment =
    /^\s*([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|PASSWD|SECRET)[A-Z0-9_]*)\s*=\s*([^\s#]{16,})/.exec(
      line,
    );
  const assignmentValue = quotedAssignment?.[3] ?? envAssignment?.[2];
  if (
    assignmentValue &&
    !isPlaceholderSecretValue(assignmentValue) &&
    looksLikeRealSecretValue(assignmentValue)
  ) {
    return "secret-assignment";
  }

  return undefined;
}

function isPlaceholderSecretValue(value) {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("replace-me") ||
    normalized.includes("your-") ||
    normalized.includes("example") ||
    normalized.includes("dummy") ||
    normalized.includes("test-") ||
    normalized.includes("telegram-token") ||
    normalized.includes("api-key") ||
    normalized.includes("changeme") ||
    normalized.includes("placeholder")
  ) {
    return true;
  }

  if (/^x{8,}$/i.test(value)) {
    return true;
  }

  if (/^0{8,}(-0{4,})*$/.test(value)) {
    return true;
  }

  return false;
}

function looksLikeRealSecretValue(value) {
  const categories = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  return value.length >= 16 && categories >= 3;
}
