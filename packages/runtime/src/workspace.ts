import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type RuntimeWorkspacePaths = {
  openPeachHome: string;
  familyDir: string;
  agentsDir: string;
  usersDir: string;
  stateDbPath: string;
};

const CORE_AGENTS = ["main", "home", "lab"] as const;

export function resolveOpenPeachHome(value?: string): string {
  const rawValue = value?.trim();
  if (!rawValue) {
    return join(homedir(), ".openpeach");
  }

  return expandHomePath(rawValue);
}

export function getRuntimeWorkspacePaths(input: {
  openPeachHome: string;
  familyId: string;
}): RuntimeWorkspacePaths {
  const familyDir = join(input.openPeachHome, "families", input.familyId);

  return {
    openPeachHome: input.openPeachHome,
    familyDir,
    agentsDir: join(familyDir, "agents"),
    usersDir: join(familyDir, "users"),
    stateDbPath: join(familyDir, "state.db"),
  };
}

export function initializeRuntimeWorkspace(input: {
  openPeachHome: string;
  familyId: string;
  templateRoot?: string;
}): RuntimeWorkspacePaths {
  const paths = getRuntimeWorkspacePaths(input);

  for (const dir of [
    paths.familyDir,
    paths.agentsDir,
    paths.usersDir,
    join(paths.familyDir, "household"),
    join(paths.familyDir, "memory", "private"),
    join(paths.familyDir, "memory", "shared"),
    join(paths.familyDir, "memory", "device"),
    join(paths.familyDir, "memory", "project"),
    join(paths.familyDir, "memory", "restricted"),
    join(paths.familyDir, "tasks"),
    join(paths.familyDir, "outbox"),
    join(paths.familyDir, "logs"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  for (const agentId of CORE_AGENTS) {
    const agentDir = join(paths.agentsDir, agentId);
    for (const child of ["workspace", "state", "sessions", "artifacts", "skills"]) {
      mkdirSync(join(agentDir, child), { recursive: true });
    }
    copyTemplateIfMissing({
      source: input.templateRoot
        ? join(input.templateRoot, "agents", agentId, "agent.md")
        : undefined,
      target: join(agentDir, "agent.md"),
      fallback: fallbackAgentProfile(agentId),
    });
  }

  copyTemplateIfMissing({
    source: input.templateRoot
      ? join(input.templateRoot, "users", "owner", "user.md")
      : undefined,
    target: join(paths.usersDir, "owner", "user.md"),
    fallback: fallbackOwnerProfile(),
  });

  copyTemplateIfMissing({
    target: join(paths.familyDir, "README.md"),
    fallback: runtimeWorkspaceReadme(input.familyId),
  });

  return paths;
}

export function loadAgentProfile(input: {
  openPeachHome: string;
  familyId: string;
  agentId: "main" | "home" | "lab";
}): string {
  const paths = getRuntimeWorkspacePaths(input);
  return readFileSync(join(paths.agentsDir, input.agentId, "agent.md"), "utf8").trim();
}

function copyTemplateIfMissing(input: {
  source?: string;
  target: string;
  fallback: string;
}): void {
  if (existsSync(input.target)) {
    return;
  }

  mkdirSync(dirname(input.target), { recursive: true });
  const content = input.source && existsSync(input.source)
    ? readFileSync(input.source, "utf8")
    : input.fallback;
  writeFileSync(input.target, ensureTrailingNewline(content), "utf8");
}

function fallbackAgentProfile(agentId: string): string {
  return `# ${agentId} Agent\n\nRuntime profile for the ${agentId} core agent.\n`;
}

function fallbackOwnerProfile(): string {
  return "# Owner User Profile\n\nPrimary owner profile for this OpenPeach family workspace.\n";
}

function runtimeWorkspaceReadme(familyId: string): string {
  return `# OpenPeach Runtime Workspace\n\nFamily: ${familyId}\n\nThis directory contains runtime-owned agent profiles, user profiles, state, sessions, tasks, outbox artifacts, logs, and memory domains.\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
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
