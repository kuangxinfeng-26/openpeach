import { readFileSync, writeFileSync } from "node:fs";
import {
  renderMihomoServiceUnit,
  renderMihomoVmessConfig,
  renderOpenPeachServiceUnit,
  runtimeWorkspaceEnvVars,
  upsertEnvVars,
} from "./openpeach-install-lib.mjs";

const command = process.argv[2];

switch (command) {
  case "service":
    process.stdout.write(
      renderOpenPeachServiceUnit({
        appDir: requireEnv("OPENPEACH_APP_DIR"),
        envFile: requireEnv("OPENPEACH_ENV_FILE"),
        serviceName: requireEnv("OPENPEACH_SERVICE_NAME"),
        serviceUser: requireEnv("OPENPEACH_SERVICE_USER"),
        requireMihomo: process.env.OPENPEACH_REQUIRE_MIHOMO === "1",
      }),
    );
    break;
  case "mihomo-service":
    process.stdout.write(
      renderMihomoServiceUnit({
        appDir: requireEnv("OPENPEACH_APP_DIR"),
        serviceName: requireEnv("OPENPEACH_SERVICE_NAME"),
        serviceUser: requireEnv("OPENPEACH_SERVICE_USER"),
      }),
    );
    break;
  case "mihomo-vmess":
    process.stdout.write(
      renderMihomoVmessConfig({
        proxyName: requireEnv("OPENPEACH_VMESS_NAME"),
        server: requireEnv("OPENPEACH_VMESS_SERVER"),
        port: parseInteger(requireEnv("OPENPEACH_VMESS_PORT"), "OPENPEACH_VMESS_PORT"),
        uuid: requireEnv("OPENPEACH_VMESS_UUID"),
        alterId: parseInteger(
          process.env.OPENPEACH_VMESS_ALTER_ID ?? "0",
          "OPENPEACH_VMESS_ALTER_ID",
        ),
        cipher: process.env.OPENPEACH_VMESS_CIPHER ?? "auto",
        tls: parseBoolean(process.env.OPENPEACH_VMESS_TLS ?? "true"),
        serverName:
          process.env.OPENPEACH_VMESS_SERVER_NAME ??
          requireEnv("OPENPEACH_VMESS_SERVER"),
        wsPath: requireEnv("OPENPEACH_VMESS_WS_PATH"),
        wsHost:
          process.env.OPENPEACH_VMESS_WS_HOST ??
          requireEnv("OPENPEACH_VMESS_SERVER"),
        udp: parseBoolean(process.env.OPENPEACH_VMESS_UDP ?? "true"),
        skipCertVerify: parseBoolean(
          process.env.OPENPEACH_VMESS_SKIP_CERT_VERIFY ?? "true",
        ),
        httpPort: parseInteger(
          process.env.OPENPEACH_MIHOMO_HTTP_PORT ?? "7890",
          "OPENPEACH_MIHOMO_HTTP_PORT",
        ),
        socksPort: parseInteger(
          process.env.OPENPEACH_MIHOMO_SOCKS_PORT ?? "7891",
          "OPENPEACH_MIHOMO_SOCKS_PORT",
        ),
      }),
    );
    break;
  case "runtime-env":
    process.stdout.write(
      upsertEnvVars(
        readFileSync(requireArg(3, "runtime-env requires an env file path"), "utf8"),
        runtimeWorkspaceEnvVars({
          openPeachHome: requireEnv("OPENPEACH_HOME"),
          familyId: process.env.TAOQIBAO_FAMILY_ID?.trim() || "main",
        }),
      ),
    );
    break;  case "env-upsert": {
    const envFilePath = process.argv[3];
    if (!envFilePath) {
      throw new Error("env-upsert requires an env file path");
    }
    const entries = process.argv.slice(4);
    const vars = Object.fromEntries(entries.map(parseAssignment));
    const existing = readFileSync(envFilePath, "utf8");
    writeFileSync(envFilePath, upsertEnvVars(existing, vars), "utf8");
    break;
  }
  default:
    throw new Error(
      "Unknown command. Expected one of: service, mihomo-service, mihomo-vmess, runtime-env, env-upsert",
    );
}

function requireArg(index, message) {
  const value = process.argv[index];
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function requireEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }

  return value;
}

function parseInteger(value, key) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid integer env var: ${key}`);
  }
  return Number.parseInt(value, 10);
}

function parseBoolean(value) {
  return value === "1" || value.toLowerCase() === "true";
}

function parseAssignment(assignment) {
  const equalsIndex = assignment.indexOf("=");
  if (equalsIndex <= 0) {
    throw new Error(`Invalid env assignment: ${assignment}`);
  }
  const key = assignment.slice(0, equalsIndex);
  const value = assignment.slice(equalsIndex + 1);
  return [key, value];
}
