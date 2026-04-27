const DEFAULT_SYSTEM_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function renderOpenPeachServiceUnit(input) {
  const mihomoServiceName = `${input.serviceName}-mihomo.service`;
  const after = input.requireMihomo
    ? `network-online.target ${mihomoServiceName}`
    : "network-online.target";

  return joinLines([
    "[Unit]",
    "Description=OpenPeach Gateway",
    `After=${after}`,
    `Wants=${after}`,
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${input.appDir}`,
    `Environment=PATH=${input.appDir}/.local/node-current/bin:${DEFAULT_SYSTEM_PATH}`,
    `EnvironmentFile=${input.envFile}`,
    `ExecStart=${input.appDir}/.local/node-current/bin/npm run dev`,
    "Restart=on-failure",
    "RestartSec=5",
    `User=${input.serviceUser}`,
    `Group=${input.serviceUser}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ]);
}

export function renderMihomoServiceUnit(input) {
  return joinLines([
    "[Unit]",
    "Description=OpenPeach Mihomo Sidecar",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${input.appDir}`,
    `ExecStart=${input.appDir}/.local/bin/mihomo -d ${input.appDir}/.config/mihomo`,
    "Restart=on-failure",
    "RestartSec=5",
    `User=${input.serviceUser}`,
    `Group=${input.serviceUser}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ]);
}

export function renderMihomoVmessConfig(input) {
  return joinLines([
    `port: ${input.httpPort ?? 7890}`,
    `socks-port: ${input.socksPort ?? 7891}`,
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "ipv6: false",
    "unified-delay: true",
    "profile:",
    "  store-selected: true",
    "",
    "proxies:",
    `  - name: ${input.proxyName}`,
    "    type: vmess",
    `    server: ${input.server}`,
    `    port: ${input.port}`,
    `    uuid: ${input.uuid}`,
    `    alterId: ${input.alterId ?? 0}`,
    `    cipher: ${input.cipher ?? "auto"}`,
    `    udp: ${renderBoolean(input.udp ?? true)}`,
    `    tls: ${renderBoolean(input.tls ?? true)}`,
    `    servername: ${input.serverName}`,
    `    skip-cert-verify: ${renderBoolean(input.skipCertVerify ?? true)}`,
    "    network: ws",
    "    ws-opts:",
    `      path: ${input.wsPath}`,
    "      headers:",
    `        Host: ${input.wsHost}`,
    "",
    "proxy-groups:",
    "  - name: PROXY",
    "    type: select",
    "    proxies:",
    `      - ${input.proxyName}`,
    "",
    "rules:",
    "  - MATCH,PROXY",
  ]);
}


export function runtimeWorkspaceEnvVars(input) {
  return {
    OPENPEACH_HOME: input.openPeachHome,
    TAOQIBAO_STATE_DB: `${input.openPeachHome}/families/${input.familyId}/state.db`,
  };
}
export function upsertEnvVars(envText, vars) {
  const entries = Object.entries(vars);
  const normalizedEnvText = envText.replace(/^\uFEFF/, "");
  const existingLines =
    normalizedEnvText.length > 0 ? normalizedEnvText.split(/\r?\n/) : [];
  const nextLines = [];
  const seen = new Set();

  for (const originalLine of existingLines) {
    const line = originalLine.trimEnd();
    if (line.length === 0) {
      nextLines.push("");
      continue;
    }
    if (line.startsWith("#") || !line.includes("=")) {
      nextLines.push(line);
      continue;
    }

    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();

    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      nextLines.push(`${key}="${vars[key]}"`);
      seen.add(key);
      continue;
    }

    nextLines.push(line);
  }

  for (const [key, value] of entries) {
    if (!seen.has(key)) {
      nextLines.push(`${key}="${value}"`);
    }
  }

  return `${trimTrailingEmptyLines(nextLines).join("\n")}\n`;
}

function trimTrailingEmptyLines(lines) {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function joinLines(lines) {
  return `${lines.join("\n")}\n`;
}

function renderBoolean(value) {
  return value ? "true" : "false";
}
