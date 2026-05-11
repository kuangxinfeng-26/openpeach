import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openPeachDb,
  migrate,
  createRepositories,
} from "../../store-sqlite/src/index.js";
import { getOrCreateSession } from "./session-service.js";
import { getSessionHistory } from "./session-history.js";

describe("getSessionHistory", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-session-history-"));
    return openPeachDb(join(dir, "state.db"));
  }

  function setupSession(db: ReturnType<typeof openPeachDb>) {
    migrate(db);
    const repo = createRepositories(db);
    const session = getOrCreateSession(repo, {
      familyId: "main",
      coreAgentId: "main",
      channel: "telegram",
      accountId: "bot-main",
      peerId: "456",
    });
    return { repo, session };
  }

  it("returns empty history for a session with no messages", () => {
    const db = openTestDb();
    try {
      const { repo, session } = setupSession(db);

      const result = getSessionHistory(repo, session.sessionId);

      expect(result.sessionId).toBe(session.sessionId);
      expect(result.messages).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
    } finally {
      db.close();
    }
  });

  it("returns messages in chronological order", () => {
    const db = openTestDb();
    try {
      const { repo, session } = setupSession(db);

      repo.appendMessage({
        messageId: "msg-1",
        sessionId: session.sessionId,
        role: "user",
        text: "Hello",
        timestampMs: 1000,
      });
      repo.appendMessage({
        messageId: "msg-2",
        sessionId: session.sessionId,
        role: "assistant",
        text: "Hi there",
        timestampMs: 2000,
      });
      repo.appendMessage({
        messageId: "msg-3",
        sessionId: session.sessionId,
        role: "user",
        text: "How are you?",
        timestampMs: 3000,
      });

      const result = getSessionHistory(repo, session.sessionId);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]!.text).toBe("Hello");
      expect(result.messages[0]!.role).toBe("user");
      expect(result.messages[1]!.text).toBe("Hi there");
      expect(result.messages[1]!.role).toBe("assistant");
      expect(result.messages[2]!.text).toBe("How are you?");
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(false);
    } finally {
      db.close();
    }
  });

  it("respects the limit parameter", () => {
    const db = openTestDb();
    try {
      const { repo, session } = setupSession(db);

      for (let i = 1; i <= 5; i++) {
        repo.appendMessage({
          messageId: `msg-${i}`,
          sessionId: session.sessionId,
          role: i % 2 === 1 ? "user" : "assistant",
          text: `Message ${i}`,
          timestampMs: i * 1000,
        });
      }

      const result = getSessionHistory(repo, session.sessionId, { limit: 3 });

      expect(result.messages).toHaveLength(3);
      // Should return the 3 most recent messages in chronological order
      expect(result.messages[0]!.text).toBe("Message 3");
      expect(result.messages[1]!.text).toBe("Message 4");
      expect(result.messages[2]!.text).toBe("Message 5");
      expect(result.totalCount).toBe(5);
      expect(result.hasMore).toBe(true);
    } finally {
      db.close();
    }
  });

  it("defaults to 20 messages", () => {
    const db = openTestDb();
    try {
      const { repo, session } = setupSession(db);

      for (let i = 1; i <= 25; i++) {
        repo.appendMessage({
          messageId: `msg-${i}`,
          sessionId: session.sessionId,
          role: "user",
          text: `Message ${i}`,
          timestampMs: i * 1000,
        });
      }

      const result = getSessionHistory(repo, session.sessionId);

      expect(result.messages).toHaveLength(20);
      expect(result.totalCount).toBe(25);
      expect(result.hasMore).toBe(true);
      // Most recent 20 messages, starting from message 6
      expect(result.messages[0]!.text).toBe("Message 6");
      expect(result.messages[19]!.text).toBe("Message 25");
    } finally {
      db.close();
    }
  });

  it("does not mix messages from different sessions", () => {
    const db = openTestDb();
    try {
      migrate(db);
      const repo = createRepositories(db);

      const session1 = getOrCreateSession(repo, {
        familyId: "main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "111",
      });
      const session2 = getOrCreateSession(repo, {
        familyId: "main",
        coreAgentId: "main",
        channel: "telegram",
        accountId: "bot-main",
        peerId: "222",
      });

      repo.appendMessage({
        messageId: "s1-msg-1",
        sessionId: session1.sessionId,
        role: "user",
        text: "Session 1 message",
        timestampMs: 1000,
      });
      repo.appendMessage({
        messageId: "s2-msg-1",
        sessionId: session2.sessionId,
        role: "user",
        text: "Session 2 message",
        timestampMs: 2000,
      });

      const result1 = getSessionHistory(repo, session1.sessionId);
      const result2 = getSessionHistory(repo, session2.sessionId);

      expect(result1.messages).toHaveLength(1);
      expect(result1.messages[0]!.text).toBe("Session 1 message");
      expect(result2.messages).toHaveLength(1);
      expect(result2.messages[0]!.text).toBe("Session 2 message");
    } finally {
      db.close();
    }
  });

  it("returns correct totalCount even when limit is larger than message count", () => {
    const db = openTestDb();
    try {
      const { repo, session } = setupSession(db);

      repo.appendMessage({
        messageId: "msg-1",
        sessionId: session.sessionId,
        role: "user",
        text: "Only message",
        timestampMs: 1000,
      });

      const result = getSessionHistory(repo, session.sessionId, { limit: 100 });

      expect(result.messages).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.hasMore).toBe(false);
    } finally {
      db.close();
    }
  });
});
