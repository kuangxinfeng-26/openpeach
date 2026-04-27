import { execSync } from "node:child_process";
import { join } from "node:path";
import { upsertEnvVars } from "./openpeach-install-lib.mjs";

export function getDefaultOpenPeachModelConfigPath(
  projectRoot = process.cwd(),
) {
  return join(projectRoot, ".openpeach", "model.runtime.local.toml");
}

export function parseOpenPeachModelProfileToml(tomlText) {
  const values = {};
  let currentSection = "";

  for (const originalLine of tomlText.split(/\r?\n/)) {
    const line = stripTomlComments(originalLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (currentSection !== "model") {
      continue;
    }

    const entryMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!entryMatch) {
      throw new Error(`Invalid model config line: ${originalLine}`);
    }

    values[entryMatch[1]] = parseTomlScalar(entryMatch[2].trim());
  }

  const authKeys = ["api_key", "api_key_env", "api_key_command"].filter((key) =>
    Object.prototype.hasOwnProperty.call(values, key),
  );

  if (authKeys.length === 0) {
    throw new Error(
      "Model profile must define one of model.api_key, model.api_key_env, or model.api_key_command",
    );
  }

  if (authKeys.length > 1) {
    throw new Error(
      "Model profile must define only one of model.api_key, model.api_key_env, or model.api_key_command",
    );
  }

  return {
    baseUrl: expectString(values.base_url, "model.base_url"),
    apiKey:
      typeof values.api_key === "string" ? values.api_key.trim() : undefined,
    apiKeyEnv:
      typeof values.api_key_env === "string"
        ? values.api_key_env.trim()
        : undefined,
    apiKeyCommand:
      typeof values.api_key_command === "string"
        ? values.api_key_command.trim()
        : undefined,
    modelName: expectString(values.model_name, "model.model_name"),
    timeoutMs:
      values.timeout_ms === undefined
        ? 30000
        : expectPositiveInteger(values.timeout_ms, "model.timeout_ms"),
  };
}

export function resolveOpenPeachModelProfile(
  profile,
  input = {},
) {
  const env = input.env ?? process.env;
  const execCommand = input.execCommand ?? defaultExecCommand;

  let apiKey = profile.apiKey;

  if (!apiKey && profile.apiKeyEnv) {
    apiKey = env[profile.apiKeyEnv]?.trim();
    if (!apiKey) {
      throw new Error(
        `Environment variable ${profile.apiKeyEnv} is empty for model.api_key_env`,
      );
    }
  }

  if (!apiKey && profile.apiKeyCommand) {
    apiKey = execCommand(profile.apiKeyCommand).trim();
    if (!apiKey) {
      throw new Error("model.api_key_command returned an empty API key");
    }
  }

  if (!apiKey) {
    throw new Error("Could not resolve a model API key from the profile");
  }

  return {
    baseUrl: profile.baseUrl,
    apiKey,
    modelName: profile.modelName,
    timeoutMs: profile.timeoutMs,
  };
}

export function buildOpenPeachModelEnvVars(profile) {
  return {
    TAOQIBAO_MODEL_BASE_URL: profile.baseUrl,
    TAOQIBAO_MODEL_API_KEY: profile.apiKey,
    TAOQIBAO_MODEL_NAME: profile.modelName,
    TAOQIBAO_MODEL_TIMEOUT_MS: String(profile.timeoutMs),
  };
}

export function syncOpenPeachEnvText(envText, profile) {
  return upsertEnvVars(envText, buildOpenPeachModelEnvVars(profile));
}

function defaultExecCommand(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stripTomlComments(line) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of line) {
    if (char === "\\" && inString && !escaped) {
      escaped = true;
      result += char;
      continue;
    }

    if (char === '"' && !escaped) {
      inString = !inString;
    }

    if (char === "#" && !inString) {
      break;
    }

    result += char;
    escaped = false;
  }

  return result;
}

function parseTomlScalar(rawValue) {
  if (/^".*"$/.test(rawValue)) {
    return JSON.parse(rawValue);
  }

  if (/^[1-9]\d*$/.test(rawValue) || rawValue === "0") {
    return Number.parseInt(rawValue, 10);
  }

  throw new Error(`Unsupported TOML value: ${rawValue}`);
}

function expectString(value, key) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string value: ${key}`);
  }

  return value.trim();
}

function expectPositiveInteger(value, key) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer value: ${key}`);
  }

  return value;
}
