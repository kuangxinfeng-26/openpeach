import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRuntimeWorkspacePaths,
  initializeRuntimeWorkspace,
  loadAgentProfile,
} from "./workspace.js";

describe("runtime workspace", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("creates OpenClaw-style agent and user directories", () => {
    dir = mkdtempSync(join(tmpdir(), "openpeach-workspace-"));

    const paths = initializeRuntimeWorkspace({
      openPeachHome: dir,
      familyId: "main",
    });

    expect(existsSync(join(paths.familyDir, "agents", "main", "agent.md"))).toBe(true);
    expect(existsSync(join(paths.familyDir, "agents", "main", "workspace"))).toBe(true);
    expect(existsSync(join(paths.familyDir, "agents", "home", "state"))).toBe(true);
    expect(existsSync(join(paths.familyDir, "agents", "lab", "skills"))).toBe(true);
    expect(existsSync(join(paths.familyDir, "users", "owner", "user.md"))).toBe(true);
    expect(existsSync(join(paths.familyDir, "memory", "restricted"))).toBe(true);
  });

  it("copies repository templates without overwriting runtime-local edits", () => {
    dir = mkdtempSync(join(tmpdir(), "openpeach-workspace-"));
    const templateRoot = join(dir, "templates");
    const openPeachHome = join(dir, "runtime");
    const templateMain = join(templateRoot, "agents", "main", "agent.md");

    mkdirSync(join(templateRoot, "agents", "main"), { recursive: true });
    writeFileSync(templateMain, "# Template main\n", { encoding: "utf8", flag: "wx" });

    initializeRuntimeWorkspace({
      openPeachHome,
      familyId: "main",
      templateRoot,
    });

    const paths = getRuntimeWorkspacePaths({ openPeachHome, familyId: "main" });
    const runtimeMain = join(paths.agentsDir, "main", "agent.md");
    expect(readFileSync(runtimeMain, "utf8")).toBe("# Template main\n");

    writeFileSync(runtimeMain, "# Local main\n", "utf8");
    initializeRuntimeWorkspace({
      openPeachHome,
      familyId: "main",
      templateRoot,
    });

    expect(readFileSync(runtimeMain, "utf8")).toBe("# Local main\n");
  });

  it("loads the active runtime agent profile", () => {
    dir = mkdtempSync(join(tmpdir(), "openpeach-workspace-"));
    initializeRuntimeWorkspace({
      openPeachHome: dir,
      familyId: "main",
    });

    const paths = getRuntimeWorkspacePaths({ openPeachHome: dir, familyId: "main" });
    writeFileSync(join(paths.agentsDir, "main", "agent.md"), "# Runtime main\n\nUse this profile.\n", "utf8");

    expect(
      loadAgentProfile({
        openPeachHome: dir,
        familyId: "main",
        agentId: "main",
      }),
    ).toBe("# Runtime main\n\nUse this profile.");
  });
});
