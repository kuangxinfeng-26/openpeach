import { describe, expect, it } from "vitest";
import {
  renderMihomoServiceUnit,
  renderMihomoVmessConfig,
  renderOpenPeachServiceUnit,
  runtimeWorkspaceEnvVars,
  upsertEnvVars,
} from "./openpeach-install-lib.mjs";

describe("renderOpenPeachServiceUnit", () => {
  it("renders an OpenPeach gateway unit with Node 24 user-local path", () => {
    const unit = renderOpenPeachServiceUnit({
      appDir: "/opt/openpeach",
      envFile: "/opt/openpeach/.env",
      serviceName: "openpeach",
      serviceUser: "openpeach",
      requireMihomo: true,
    });

    expect(unit).toContain("Description=OpenPeach Gateway");
    expect(unit).toContain("After=network-online.target openpeach-mihomo.service");
    expect(unit).toContain(
      "Environment=PATH=/opt/openpeach/.local/node-current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(unit).toContain(
      "ExecStart=/opt/openpeach/.local/node-current/bin/npm run dev",
    );
    expect(unit).toContain("User=openpeach");
    expect(unit).toContain("Group=openpeach");
  });
});

describe("renderMihomoServiceUnit", () => {
  it("renders a mihomo sidecar unit bound to the OpenPeach service name", () => {
    const unit = renderMihomoServiceUnit({
      appDir: "/opt/openpeach",
      serviceName: "openpeach",
      serviceUser: "openpeach",
    });

    expect(unit).toContain("Description=OpenPeach Mihomo Sidecar");
    expect(unit).toContain(
      "ExecStart=/opt/openpeach/.local/bin/mihomo -d /opt/openpeach/.config/mihomo",
    );
    expect(unit).toContain("User=openpeach");
    expect(unit).toContain("Group=openpeach");
  });
});

describe("renderMihomoVmessConfig", () => {
  it("renders a minimal vmess-only mihomo config", () => {
    const config = renderMihomoVmessConfig({
      proxyName: "Example-VMess-WS",
      server: "proxy.example.com",
      port: 28443,
      uuid: "11111111-1111-4111-8111-111111111111",
      cipher: "auto",
      serverName: "proxy.example.com",
      wsPath: "/dwf",
      wsHost: "proxy.example.com",
    });

    expect(config).toContain("mode: rule");
    expect(config).toContain("name: Example-VMess-WS");
    expect(config).toContain("server: proxy.example.com");
    expect(config).toContain("port: 28443");
    expect(config).toContain("uuid: 11111111-1111-4111-8111-111111111111");
    expect(config).toContain("path: /dwf");
    expect(config).toContain("Host: proxy.example.com");
    expect(config).toContain("- MATCH,PROXY");
  });
});

describe("upsertEnvVars", () => {
  it("replaces existing values and appends missing ones without duplication", () => {
    const updated = upsertEnvVars(
      [
        'TELEGRAM_BOT_TOKEN="replace-me"',
        'HTTP_PROXY="http://old-proxy:7890"',
        "",
      ].join("\n"),
      {
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7890",
        NO_PROXY: "localhost,127.0.0.1,::1",
      },
    );

    expect(updated).toContain('HTTP_PROXY="http://127.0.0.1:7890"');
    expect(updated).toContain('HTTPS_PROXY="http://127.0.0.1:7890"');
    expect(updated).toContain('NO_PROXY="localhost,127.0.0.1,::1"');
    expect(updated.match(/^HTTP_PROXY=/gm)).toHaveLength(1);
  });

  it("strips a leading UTF-8 BOM so shell source can read the first key", () => {
    const updated = upsertEnvVars('\uFEFFTELEGRAM_BOT_TOKEN="token"\n', {
      HTTP_PROXY: "http://127.0.0.1:7890",
    });

    expect(updated.startsWith("\uFEFF")).toBe(false);
    expect(updated).toContain('TELEGRAM_BOT_TOKEN="token"');
    expect(updated).toContain('HTTP_PROXY="http://127.0.0.1:7890"');
  });
});

describe("runtimeWorkspaceEnvVars", () => {
  it("points runtime state into the OpenPeach family workspace", () => {
    expect(
      runtimeWorkspaceEnvVars({
        openPeachHome: "/opt/openpeach/.openpeach",
        familyId: "main",
      }),
    ).toEqual({
      OPENPEACH_HOME: "/opt/openpeach/.openpeach",
      TAOQIBAO_STATE_DB: "/opt/openpeach/.openpeach/families/main/state.db",
    });
  });
});