import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const host = process.env.TELEGRAM_RELAY_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.TELEGRAM_RELAY_PORT ?? "8788", 10);
const upstreamOrigin =
  process.env.TELEGRAM_RELAY_UPSTREAM ?? "https://api.telegram.org";
const execFileAsync = promisify(execFile);

const server = createServer(async (req, res) => {
  const targetUrl = new URL(req.url ?? "/", upstreamOrigin);

  try {
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await readBody(req);

    const upstream = await forwardRequest({
      url: targetUrl,
      method: req.method ?? "GET",
      headers: filterHeaders(req.headers),
      body,
    });

    res.statusCode = upstream.status;

    for (const [key, value] of Object.entries(upstream.headers)) {
      if (key.toLowerCase() === "transfer-encoding") {
        continue;
      }
      res.setHeader(key, value);
    }

    res.end(upstream.body);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: "telegram_relay_error",
        detail:
          error instanceof Error && error.message
            ? error.message
            : "Unknown relay error",
      }),
    );
  }
});

server.listen(port, host, () => {
  console.log(`Telegram relay listening on http://${host}:${port}`);
});

function filterHeaders(headers) {
  const nextHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!value) {
      continue;
    }
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-length" ||
      lower === "expect" ||
      lower === "connection"
    ) {
      continue;
    }

    nextHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  return nextHeaders;
}

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
  });
}

async function forwardRequest(input) {
  if (process.platform === "win32") {
    return forwardRequestViaPowerShell(input);
  }

  const upstream = await fetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
  });

  return {
    status: upstream.status,
    headers: Object.fromEntries(upstream.headers.entries()),
    body: Buffer.from(await upstream.arrayBuffer()),
  };
}

async function forwardRequestViaPowerShell(input) {
  const env = {
    ...process.env,
    TELEGRAM_RELAY_URL: input.url.toString(),
    TELEGRAM_RELAY_METHOD: input.method,
    TELEGRAM_RELAY_HEADERS_JSON: JSON.stringify(input.headers),
    TELEGRAM_RELAY_BODY_BASE64: input.body
      ? input.body.toString("base64")
      : "",
  };

  const relayScript = `
$ProgressPreference = 'SilentlyContinue'
$headers = @{}
if ($env:TELEGRAM_RELAY_HEADERS_JSON) {
  $parsed = $env:TELEGRAM_RELAY_HEADERS_JSON | ConvertFrom-Json
  foreach ($item in $parsed.PSObject.Properties) {
    $headers[$item.Name] = [string]$item.Value
  }
}
$contentType = $null
if ($headers.ContainsKey('content-type')) {
  $contentType = [string]$headers['content-type']
  $headers.Remove('content-type')
}
$params = @{
  Uri = $env:TELEGRAM_RELAY_URL
  Method = $env:TELEGRAM_RELAY_METHOD
  Headers = $headers
  UseBasicParsing = $true
  TimeoutSec = 60
}
if ($contentType) {
  $params.ContentType = $contentType
}
if ($env:TELEGRAM_RELAY_BODY_BASE64) {
  $params.Body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TELEGRAM_RELAY_BODY_BASE64))
}
try {
  $response = Invoke-WebRequest @params
  $result = @{
    status = [int]$response.StatusCode
    contentType = [string]$response.Headers['Content-Type']
    bodyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$response.Content))
  } | ConvertTo-Json -Compress
  [Console]::Out.Write($result)
} catch {
  if ($_.Exception.Response) {
    $resp = $_.Exception.Response
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $content = $reader.ReadToEnd()
    $result = @{
      status = [int]$resp.StatusCode
      contentType = [string]$resp.ContentType
      bodyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$content))
    } | ConvertTo-Json -Compress
    [Console]::Out.Write($result)
    exit 0
  }
  throw
}
`;

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-Command", relayScript],
    {
      env,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    },
  );

  const result = JSON.parse(stdout);
  return {
    status: result.status,
    headers: result.contentType
      ? {
          "content-type": result.contentType,
        }
      : {},
    body: Buffer.from(result.bodyBase64 ?? "", "base64"),
  };
}
