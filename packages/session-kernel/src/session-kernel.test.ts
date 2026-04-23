import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openTaoqibaoDb, migrate, createRepositories } from "../../store-sqlite/src/index.js";
import { buildSessionKey } from "./session-key.js";
import { getOrCreateSession } from "./session-service.js";
import { sessionSearch } from "./session-search.js";

describe("session kernel", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("builds the deterministic session key path", () => {
    expect(
      buildSessionKey({
        familyId: "main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        scene: "default",
        threadId: "dm",
      }),
    ).toBe(
      "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
    );
  });

  it("returns the same session id for the same session key in the same db", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repo = createRepositories(db);
      const input = {
        familyId: "main",
        coreAgentId: "main" as const,
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
        scene: "default",
        threadId: "dm",
      };

      const first = getOrCreateSession(repo, input);
      const second = getOrCreateSession(repo, input);

      expect(first).toEqual(second);
      expect(first).toEqual({
        sessionId: createHash("sha256")
          .update(
            "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
            "utf8",
          )
          .digest("hex"),
        sessionKey:
          "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
        familyId: "main",
        coreAgentId: "main",
      });
    } finally {
      db.close();
    }
  });

  it("returns compact search results from the sqlite repo", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repo = createRepositories(db);
      const session = getOrCreateSession(repo, {
        familyId: "main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456",
      });

      repo.appendMessage({
        messageId: "message-1",
        sessionId: session.sessionId,
        role: "user",
        text: "客厅灯测试",
        timestampMs: 1_710_000_000_000,
      });

      expect(sessionSearch(repo, "客厅灯")).toEqual([
        {
          messageId: "message-1",
          sessionId: session.sessionId,
          snippet: "客厅灯测试",
        },
      ]);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-session-kernel-"));
    return openTaoqibaoDb(join(dir, "state.db"));
  }
});
