import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openTaoqibaoDb } from "./db.js";
import { migrate } from "./migrations.js";
import { createRepositories } from "./repositories.js";

describe("createRepositories", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("searches appended session messages with FTS5", () => {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-store-"));
    const db = openTaoqibaoDb(join(dir, "state.db"));

    try {
      migrate(db);
      const repo = createRepositories(db);

      repo.upsertSession({
        sessionId: "session-1",
        sessionKey:
          "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
        familyId: "main",
        coreAgentId: "main",
      });

      repo.appendMessage({
        messageId: "message-1",
        sessionId: "session-1",
        role: "user",
        text: "客厅灯测试",
        timestampMs: 1_710_000_000_000,
      });

      const results = repo.searchMessages("客厅灯");

      expect(results).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
