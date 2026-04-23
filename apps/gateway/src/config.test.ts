import { describe, expect, it } from "vitest";
import { loadConfig, resolveStateDbPath } from "./config.js";

describe("resolveStateDbPath", () => {
  it("expands $HOME-based state DB paths", () => {
    const result = resolveStateDbPath({
      TAOQIBAO_STATE_DB: "$HOME/.taoqibao/state.db",
    });

    expect(result).not.toBe("$HOME/.taoqibao/state.db");
    expect(result).toContain("state.db");
  });

  it("expands tilde-based state DB paths", () => {
    const result = resolveStateDbPath({
      TAOQIBAO_STATE_DB: "~/taoqibao/state.db",
    });

    expect(result).not.toBe("~/taoqibao/state.db");
    expect(result).toContain("state.db");
  });
});

describe("loadConfig", () => {
  it("uses the expanded state DB path in gateway config", () => {
    const config = loadConfig({
      TAOQIBAO_STATE_DB: "$HOME/.taoqibao/state.db",
      TAOQIBAO_FAMILY_ID: "main",
      TAOQIBAO_CORE_AGENT_ID: "main",
      TAOQIBAO_OWNER_TELEGRAM_USER_IDS: "123456789",
      TELEGRAM_BOT_TOKEN: "token",
      TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
      TAOQIBAO_MODEL_API_KEY: "key",
      TAOQIBAO_MODEL_NAME: "model",
      TAOQIBAO_MODEL_TIMEOUT_MS: "30000",
      TAOQIBAO_LOG_LEVEL: "info",
    });

    expect(config.stateDbPath).not.toBe("$HOME/.taoqibao/state.db");
    expect(config.stateDbPath).toContain("state.db");
  });
});
