import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openPeachDb } from "./db.js";
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
    const db = openTestDb();

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
        text: "living room light test",
        timestampMs: 1_710_000_000_000,
      });

      const results = repo.searchMessages("living room");

      expect(results).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects a session key reused with a different session id", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repo = createRepositories(db);
      const sessionKey =
        "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm";

      repo.upsertSession({
        sessionId: "session-1",
        sessionKey,
        familyId: "main",
        coreAgentId: "main",
      });

      expect(() =>
        repo.upsertSession({
          sessionId: "session-2",
          sessionKey,
          familyId: "main",
          coreAgentId: "main",
        }),
      ).toThrow(/sessionKey.*different sessionId/i);
    } finally {
      db.close();
    }
  });

  it("marks an outbox row as sent after delivery", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repo = createRepositories(db);
      repo.insertOutboxOnce({
        outboxId: "outbox-1",
        idempotencyKey: "telegram:reply:1",
        channel: "telegram",
        targetRef: "456",
        payloadJson: JSON.stringify({ text: "hello" }),
      });

      repo.markOutboxSent("outbox-1");

      const row = db
        .prepare("SELECT status FROM outbox WHERE outbox_id = ?")
        .get("outbox-1") as { status: string } | undefined;
      expect(row?.status).toBe("sent");
    } finally {
      db.close();
    }
  });

  it("rejects appending a message for a missing session", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repo = createRepositories(db);

      expect(() =>
        repo.appendMessage({
          messageId: "message-1",
          sessionId: "missing-session",
          role: "user",
          text: "living room light test",
          timestampMs: 1_710_000_000_000,
        }),
      ).toThrow(/foreign key/i);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-store-"));
    return openPeachDb(join(dir, "state.db"));
  }
});
