import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPeachDb, migrate, createRepositories } from "../../store-sqlite/src/index.js";
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

  it("rejects field values containing reserved delimiters", () => {
    expect(() =>
      buildSessionKey({
        familyId: "main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "456/789",
      }),
    ).toThrow(/peerId.*reserved delimiter/i);
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

      const row = db
        .prepare("SELECT COUNT(*) AS count FROM sessions")
        .get() as { count: number };
      expect(row.count).toBe(1);
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
        text: "living room light test",
        timestampMs: 1_710_000_000_000,
      });

      expect(sessionSearch(repo, "living room")).toEqual([
        {
          messageId: "message-1",
          sessionId: session.sessionId,
          snippet: "living room light test",
        },
      ]);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-session-kernel-"));
    return openPeachDb(join(dir, "state.db"));
  }
});
