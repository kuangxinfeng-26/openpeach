import { describe, expect, it } from "vitest";
import { loadConfig, resolveOpenPeachHome, resolveStateDbPath } from "./config.js";

describe("resolveStateDbPath", () => {
  it("expands $HOME-based state DB paths", () => {
    const result = resolveStateDbPath({
      TAOQIBAO_STATE_DB: "$HOME/.openpeach/families/main/state.db",
    });

    expect(result).not.toBe("$HOME/.openpeach/families/main/state.db");
    expect(result).toContain("state.db");
  });

  it("expands tilde-based state DB paths", () => {
    const result = resolveStateDbPath({
      TAOQIBAO_STATE_DB: "~/.openpeach/families/main/state.db",
    });

    expect(result).not.toBe("~/.openpeach/families/main/state.db");
    expect(result).toContain("state.db");
  });
});


describe("resolveOpenPeachHome", () => {
  it("defaults to the OpenPeach runtime home", () => {
    const result = resolveOpenPeachHome({});

    expect(result).toContain(".openpeach");
  });

  it("expands configured home paths", () => {
    const result = resolveOpenPeachHome({ OPENPEACH_HOME: "~/.openpeach-test" });

    expect(result).not.toBe("~/.openpeach-test");
    expect(result).toContain(".openpeach-test");
  });
});
describe("loadConfig", () => {
  it("uses the expanded state DB path in gateway config", () => {
    const config = loadConfig({
      TAOQIBAO_STATE_DB: "$HOME/.openpeach/families/main/state.db",
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

    expect(config.stateDbPath).not.toBe("$HOME/.openpeach/families/main/state.db");
    expect(config.stateDbPath).toContain("state.db");
  });

  it("defaults the state DB into the OpenPeach family workspace", () => {
    const config = loadConfig({
      OPENPEACH_HOME: "~/openpeach-test-home",
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

    expect(config.openPeachHome).toContain("openpeach-test-home");
    expect(config.stateDbPath).toContain("families");
    expect(config.stateDbPath).toContain("main");
    expect(config.stateDbPath).toContain("state.db");
  });

  it("includes an optional Telegram API root when configured", () => {
    const config = loadConfig({
      TAOQIBAO_STATE_DB: "$HOME/.openpeach/families/main/state.db",
      TAOQIBAO_FAMILY_ID: "main",
      TAOQIBAO_CORE_AGENT_ID: "main",
      TAOQIBAO_OWNER_TELEGRAM_USER_IDS: "123456789",
      TELEGRAM_BOT_TOKEN: "token",
      TAOQIBAO_TELEGRAM_API_ROOT: "http://127.0.0.1:8788",
      TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
      TAOQIBAO_MODEL_API_KEY: "key",
      TAOQIBAO_MODEL_NAME: "model",
      TAOQIBAO_MODEL_TIMEOUT_MS: "30000",
      TAOQIBAO_LOG_LEVEL: "info",
    });

    expect(config.telegramApiRoot).toBe("http://127.0.0.1:8788");
  });

  it("keeps the optional Story Bunny toy disabled unless explicitly enabled", () => {
    const disabled = loadConfig({
      TAOQIBAO_STATE_DB: "$HOME/.openpeach/families/main/state.db",
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
    const enabled = loadConfig({
      TAOQIBAO_STATE_DB: "$HOME/.openpeach/families/main/state.db",
      TAOQIBAO_FAMILY_ID: "main",
      TAOQIBAO_CORE_AGENT_ID: "main",
      TAOQIBAO_OWNER_TELEGRAM_USER_IDS: "123456789",
      TELEGRAM_BOT_TOKEN: "token",
      TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
      TAOQIBAO_MODEL_API_KEY: "key",
      TAOQIBAO_MODEL_NAME: "model",
      TAOQIBAO_MODEL_TIMEOUT_MS: "30000",
      TAOQIBAO_LOG_LEVEL: "info",
      OPENPEACH_ENABLE_STORY_BUNNY: "true",
    });

    expect(disabled.enableStoryBunnyToy).toBe(false);
    expect(enabled.enableStoryBunnyToy).toBe(true);
  });
});
