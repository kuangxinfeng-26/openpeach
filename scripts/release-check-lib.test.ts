import { describe, expect, it } from "vitest";
import {
  filterExistingCandidateFiles,
  findForbiddenReleaseFiles,
  findMissingRequiredFiles,
  findSecretLikeContent,
  releaseCheckCommands,
} from "./release-check-lib.mjs";

describe("filterExistingCandidateFiles", () => {
  it("ignores deleted tracked files that are no longer publishable", () => {
    expect(
      filterExistingCandidateFiles(
        ["README.md", "deploy/systemd/taoqibao.service"],
        (file) => file === "README.md",
      ),
    ).toEqual(["README.md"]);
  });
});

describe("findForbiddenReleaseFiles", () => {
  it("flags secrets, runtime artifacts, and private source material", () => {
    expect(
      findForbiddenReleaseFiles([
        ".env",
        ".env.example",
        ".openpeach/model.runtime.example.toml",
        ".openpeach/model.runtime.local.toml",
        "_sources/openclaw/file.ts",
        "generated/demo.png",
        "node_modules/pkg/index.js",
        ".tmp/output.log",
        "README.md",
      ]),
    ).toEqual([
      ".env",
      ".openpeach/model.runtime.local.toml",
      "_sources/openclaw/file.ts",
      "generated/demo.png",
      "node_modules/pkg/index.js",
      ".tmp/output.log",
    ]);
  });
});

describe("findMissingRequiredFiles", () => {
  it("reports missing open-source readiness files", () => {
    expect(
      findMissingRequiredFiles(
        new Set([
          ".env.example",
          "AGENTS.md",
          "CONTRIBUTING.md",
          "LICENSE",
          "README.md",
          ".github/workflows/ci.yml",
          "deploy/linux/install-openpeach.sh",
          "docs/phase0-runbook.md",
          "package.json",
        ]),
      ),
    ).toEqual(["docs/open-source-readiness.md"]);
  });
});

describe("findSecretLikeContent", () => {
  it("reports common real secret shapes without returning the secret value", () => {
    const telegramToken = `1234567890:${"A".repeat(35)}`;
    const googleApiKey = `AI${"zaSy"}${"A".repeat(33)}`;
    const passwordAssignment = `pass${"word"}="${"A1b2C3d4E5f6G7h8J9k0"}"`;

    expect(
      findSecretLikeContent([
        {
          path: "docs/example.md",
          text: [
            `telegram=${telegramToken}`,
            `google=${googleApiKey}`,
            passwordAssignment,
          ].join("\n"),
        },
      ]),
    ).toEqual([
      { path: "docs/example.md", line: 1, kind: "telegram-bot-token" },
      { path: "docs/example.md", line: 2, kind: "google-api-key" },
      { path: "docs/example.md", line: 3, kind: "secret-assignment" },
    ]);
  });

  it("allows placeholder values in examples", () => {
    expect(
      findSecretLikeContent([
        {
          path: ".env.example",
          text: [
            'TELEGRAM_BOT_TOKEN="replace-me"',
            'TAOQIBAO_MODEL_API_KEY="your-api-key"',
            'OPENPEACH_VMESS_UUID="00000000-0000-0000-0000-000000000000"',
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
  });

  it("allows source code variable wiring and test placeholders", () => {
    expect(
      findSecretLikeContent([
        {
          path: "apps/gateway/src/index.ts",
          text: [
            "apiKey: config.modelApiKey,",
            "token: config.telegramBotToken,",
            "this.apiKey = options.apiKey;",
            'token: "telegram-token-secret",',
            'apiKey: "test-key-secret",',
          ].join("\n"),
        },
      ]),
    ).toEqual([]);
  });
});

describe("releaseCheckCommands", () => {
  it("runs the release gates after repository hygiene checks", () => {
    expect(releaseCheckCommands).toEqual([
      ["audit"],
      ["run", "check"],
      ["test"],
      ["run", "build"],
      ["run", "doctor"],
    ]);
  });
});
