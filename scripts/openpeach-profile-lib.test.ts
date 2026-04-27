import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOpenPeachModelEnvVars,
  getDefaultOpenPeachModelConfigPath,
  parseOpenPeachModelProfileToml,
  resolveOpenPeachModelProfile,
  syncOpenPeachEnvText,
} from "./openpeach-profile-lib.mjs";

describe("getDefaultOpenPeachModelConfigPath", () => {
  it("uses an OpenPeach-native project path instead of a Codex directory", () => {
    expect(getDefaultOpenPeachModelConfigPath("/srv/openpeach")).toBe(
      join("/srv/openpeach", ".openpeach", "model.runtime.local.toml"),
    );
  });
});

describe("parseOpenPeachModelProfileToml", () => {
  it("parses a direct api key profile", () => {
    const profile = parseOpenPeachModelProfileToml(`
[model]
base_url = "https://api.example.com/v1"
api_key = "secret-key"
model_name = "gpt-5.4"
timeout_ms = 45000
`);

    expect(profile).toEqual({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      apiKeyEnv: undefined,
      apiKeyCommand: undefined,
      modelName: "gpt-5.4",
      timeoutMs: 45000,
    });
  });

  it("defaults timeout_ms and supports api_key_env", () => {
    const profile = parseOpenPeachModelProfileToml(`
[model]
base_url = "https://api.example.com/v1"
api_key_env = "OPENAI_API_KEY"
model_name = "gpt-5.4-mini"
`);

    expect(profile.timeoutMs).toBe(30000);
    expect(profile.apiKeyEnv).toBe("OPENAI_API_KEY");
  });
});

describe("resolveOpenPeachModelProfile", () => {
  it("resolves api_key_env against the provided environment", () => {
    const resolved = resolveOpenPeachModelProfile(
      {
        baseUrl: "https://api.example.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        modelName: "gpt-5.4",
        timeoutMs: 30000,
      },
      {
        env: {
          OPENAI_API_KEY: "env-key",
        },
      },
    );

    expect(resolved.apiKey).toBe("env-key");
  });

  it("resolves api_key_command through a command executor", () => {
    const resolved = resolveOpenPeachModelProfile(
      {
        baseUrl: "https://api.example.com/v1",
        apiKeyCommand: "print-key",
        modelName: "gpt-5.4",
        timeoutMs: 30000,
      },
      {
        execCommand(command: string) {
          expect(command).toBe("print-key");
          return "cmd-key";
        },
      },
    );

    expect(resolved.apiKey).toBe("cmd-key");
  });
});

describe("buildOpenPeachModelEnvVars", () => {
  it("maps the resolved profile to runtime env vars", () => {
    expect(
      buildOpenPeachModelEnvVars({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        modelName: "gpt-5.4",
        timeoutMs: 30000,
      }),
    ).toEqual({
      TAOQIBAO_MODEL_BASE_URL: "https://api.example.com/v1",
      TAOQIBAO_MODEL_API_KEY: "secret-key",
      TAOQIBAO_MODEL_NAME: "gpt-5.4",
      TAOQIBAO_MODEL_TIMEOUT_MS: "30000",
    });
  });
});

describe("syncOpenPeachEnvText", () => {
  it("upserts model env vars into an existing env file", () => {
    const nextEnvText = syncOpenPeachEnvText(
      [
        'TELEGRAM_BOT_TOKEN="telegram-token"',
        'TAOQIBAO_MODEL_BASE_URL="https://old.example.com/v1"',
        "",
      ].join("\n"),
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        modelName: "gpt-5.4",
        timeoutMs: 30000,
      },
    );

    expect(nextEnvText).toContain(
      'TAOQIBAO_MODEL_BASE_URL="https://api.example.com/v1"',
    );
    expect(nextEnvText).toContain('TAOQIBAO_MODEL_API_KEY="secret-key"');
    expect(nextEnvText).toContain('TAOQIBAO_MODEL_NAME="gpt-5.4"');
    expect(nextEnvText).toContain('TAOQIBAO_MODEL_TIMEOUT_MS="30000"');
  });
});
