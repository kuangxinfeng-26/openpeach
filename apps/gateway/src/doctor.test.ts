import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }

    vi.restoreAllMocks();
  });

  it("passes all checks for a valid phase 0 environment without exposing secrets", () => {
    const env = createEnv();

    const result = runDoctor(env);

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([
      { name: "node-version", ok: true, detail: expect.stringContaining(">= 22") },
      { name: "required-env", ok: true, detail: "Required env vars are present" },
      {
        name: "state-db-path",
        ok: true,
        detail: expect.stringContaining("SQLite DB path is writable"),
      },
      { name: "runtime-workspace", ok: true, detail: "Runtime workspace is initialized" },
      { name: "fts5-migration", ok: true, detail: "FTS5 migration works in a temporary database" },
      { name: "telegram-token", ok: true, detail: "Telegram bot token is configured" },
      { name: "model-config", ok: true, detail: "Model config is configured" },
    ]);

    expect(JSON.stringify(result)).not.toContain(env.TELEGRAM_BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(env.TAOQIBAO_MODEL_API_KEY);
  });

  it("fails with clear missing env messages and no secret values", () => {
    const env = createEnv({
      TELEGRAM_BOT_TOKEN: "",
      TAOQIBAO_MODEL_API_KEY: "",
      TAOQIBAO_MODEL_NAME: "",
    });

    const result = runDoctor(env);

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        {
          name: "required-env",
          ok: false,
          detail:
            "Missing required env vars: TELEGRAM_BOT_TOKEN, TAOQIBAO_MODEL_API_KEY, TAOQIBAO_MODEL_NAME",
        },
        { name: "telegram-token", ok: false, detail: "Telegram bot token is missing" },
        { name: "model-config", ok: false, detail: "Model config is missing: TAOQIBAO_MODEL_API_KEY, TAOQIBAO_MODEL_NAME" },
      ]),
    );

    expect(JSON.stringify(result)).not.toContain("123456:secret-token");
    expect(JSON.stringify(result)).not.toContain("super-secret-api-key");
  });

  it("fails the state DB path check when the configured target is a directory", () => {
    const env = createEnv();
    rmSync(env.TAOQIBAO_STATE_DB!, { force: true });
    mkdirSync(env.TAOQIBAO_STATE_DB!);

    const result = runDoctor(env);

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        {
          name: "state-db-path",
          ok: false,
          detail: expect.stringContaining("SQLite DB path is not writable"),
        },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(env.TELEGRAM_BOT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(env.TAOQIBAO_MODEL_API_KEY);
  });

  it("does not print secrets in CLI output when config values are invalid but present", () => {
    const originalEnv = process.env;
    const env = {
      ...process.env,
      ...createEnv({
        TAOQIBAO_CORE_AGENT_ID: "not-main",
      }),
    } as NodeJS.ProcessEnv;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      process.env = env;

      const exitCode = main();
      const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .join("\n");

      expect(exitCode).toBe(1);
      expect(output).toContain("required-env");
      expect(output).toContain("Doctor failed");
      expect(output).not.toContain(env.TELEGRAM_BOT_TOKEN!);
      expect(output).not.toContain(env.TAOQIBAO_MODEL_API_KEY!);
    } finally {
      process.env = originalEnv;
    }
  });

  function createEnv(
    overrides: Partial<NodeJS.ProcessEnv> = {},
  ): NodeJS.ProcessEnv {
    dir = mkdtempSync(join(tmpdir(), "openpeach-doctor-"));

    return {
      OPENPEACH_HOME: join(dir, "openpeach-home"),
      TAOQIBAO_STATE_DB: join(dir, "state.db"),
      TAOQIBAO_FAMILY_ID: "main",
      TAOQIBAO_CORE_AGENT_ID: "main",
      TAOQIBAO_OWNER_TELEGRAM_USER_IDS: "123456789",
      TELEGRAM_BOT_TOKEN: "bot-token-placeholder",
      TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
      TAOQIBAO_MODEL_API_KEY: "super-secret-api-key",
      TAOQIBAO_MODEL_NAME: "gpt-test",
      TAOQIBAO_MODEL_TIMEOUT_MS: "30000",
      TAOQIBAO_LOG_LEVEL: "info",
      ...overrides,
    };
  }
});
