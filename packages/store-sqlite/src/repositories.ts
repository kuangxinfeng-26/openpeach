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

export interface InsertEventInput {
  eventId: string;
  eventType: string;
  taskId?: string;
  sessionId?: string;
  payloadJson: string;
  createdAtMs: number;
}

export interface InsertOutboxOnceInput {
  outboxId: string;
  idempotencyKey: string;
  channel: string;
  targetRef: string;
  payloadJson: string;
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

interface SessionKeyRow {
  session_id: string;
}

export function createRepositories(db: TaoqibaoDb) {
  const findSessionByKeyStatement = db.prepare(`
    SELECT session_id
    FROM sessions
    WHERE session_key = ?
  `);

  const insertSessionStatement = db.prepare(`
    INSERT INTO sessions (
      session_id,
      session_key,
      family_id,
      core_agent_id,
      created_at_ms,
      updated_at_ms
    )
    VALUES (@sessionId, @sessionKey, @familyId, @coreAgentId, @nowMs, @nowMs)
  `);

  const updateSessionStatement = db.prepare(`
    UPDATE sessions
    SET
      family_id = @familyId,
      core_agent_id = @coreAgentId,
      updated_at_ms = @nowMs
    WHERE session_key = @sessionKey
      AND session_id = @sessionId
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
    // Phase 0 assumes append-only messages and stores a prefix-searchable FTS row per message.
    appendMessageFtsStatement.run(input);
  });

  const searchMessagesStatement = db.prepare(`
    SELECT message_id, session_id, text
    FROM session_messages_fts
    WHERE session_messages_fts MATCH ?
    LIMIT 20
  `);

  const insertEventStatement = db.prepare(`
    INSERT INTO events (
      event_id,
      event_type,
      task_id,
      session_id,
      payload_json,
      created_at_ms
    )
    VALUES (
      @eventId,
      @eventType,
      @taskId,
      @sessionId,
      @payloadJson,
      @createdAtMs
    )
  `);

  const insertOutboxOnceStatement = db.prepare(`
    INSERT INTO outbox (
      outbox_id,
      idempotency_key,
      channel,
      target_ref,
      payload_json,
      status,
      created_at_ms,
      updated_at_ms
    )
    VALUES (
      @outboxId,
      @idempotencyKey,
      @channel,
      @targetRef,
      @payloadJson,
      'pending',
      @nowMs,
      @nowMs
    )
    ON CONFLICT(idempotency_key) DO NOTHING
  `);

  return {
    upsertSession(input: UpsertSessionInput): void {
      const existing = findSessionByKeyStatement.get(input.sessionKey) as
        | SessionKeyRow
        | undefined;
      const values = {
        ...input,
        nowMs: Date.now(),
      };

      if (!existing) {
        insertSessionStatement.run(values);
        return;
      }

      if (existing.session_id !== input.sessionId) {
        throw new Error(
          `sessionKey already exists with different sessionId: ${input.sessionKey}`,
        );
      }

      updateSessionStatement.run(values);
    },

    appendMessage(input: AppendMessageInput): void {
      appendMessageTransaction(input);
    },

    insertEvent(input: InsertEventInput): void {
      insertEventStatement.run({
        ...input,
        taskId: input.taskId ?? null,
        sessionId: input.sessionId ?? null,
      });
    },

    insertOutboxOnce(input: InsertOutboxOnceInput): void {
      insertOutboxOnceStatement.run({
        ...input,
        nowMs: Date.now(),
      });
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
