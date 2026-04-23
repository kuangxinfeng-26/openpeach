import type { TaoqibaoDb } from "./db.js";

export interface UpsertSessionInput {
  sessionId: string;
  sessionKey: string;
  familyId: string;
  coreAgentId: string;
}

export interface AppendMessageInput {
  messageId: string;
  sessionId: string;
  role: string;
  text: string;
  timestampMs: number;
}

export interface SearchMessageResult {
  messageId: string;
  sessionId: string;
  text: string;
}

interface SearchMessageRow {
  message_id: string;
  session_id: string;
  text: string;
}

export function createRepositories(db: TaoqibaoDb) {
  const upsertSessionStatement = db.prepare(`
    INSERT INTO sessions (
      session_id,
      session_key,
      family_id,
      core_agent_id,
      created_at_ms,
      updated_at_ms
    )
    VALUES (@sessionId, @sessionKey, @familyId, @coreAgentId, @nowMs, @nowMs)
    ON CONFLICT(session_key) DO UPDATE SET
      updated_at_ms = excluded.updated_at_ms
  `);

  const appendMessageStatement = db.prepare(`
    INSERT INTO session_messages (
      message_id,
      session_id,
      role,
      text,
      timestamp_ms
    )
    VALUES (@messageId, @sessionId, @role, @text, @timestampMs)
  `);

  const appendMessageFtsStatement = db.prepare(`
    INSERT INTO session_messages_fts (message_id, session_id, text)
    VALUES (@messageId, @sessionId, @text)
  `);

  const appendMessageTransaction = db.transaction((input: AppendMessageInput) => {
    appendMessageStatement.run(input);
    appendMessageFtsStatement.run(input);
  });

  const searchMessagesStatement = db.prepare(`
    SELECT message_id, session_id, text
    FROM session_messages_fts
    WHERE session_messages_fts MATCH ?
    LIMIT 20
  `);

  return {
    upsertSession(input: UpsertSessionInput): void {
      upsertSessionStatement.run({
        ...input,
        nowMs: Date.now(),
      });
    },

    appendMessage(input: AppendMessageInput): void {
      appendMessageTransaction(input);
    },

    searchMessages(query: string): SearchMessageResult[] {
      return searchMessagesStatement.all(toFtsPrefixQuery(query)).map((row) => {
        const result = row as SearchMessageRow;

        return {
          messageId: result.message_id,
          sessionId: result.session_id,
          text: result.text,
        };
      });
    },
  };
}

function toFtsPrefixQuery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return '""';
  }

  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" ");
}
