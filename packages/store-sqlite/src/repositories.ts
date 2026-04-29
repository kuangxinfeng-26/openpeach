import type { OpenPeachDb } from "./db.js";

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

export interface EventRecord {
  eventType: string;
  taskId?: string;
  sessionId?: string;
  payloadJson: string;
}

export interface InsertOutboxOnceInput {
  outboxId: string;
  idempotencyKey: string;
  channel: string;
  targetRef: string;
  payloadJson: string;
}

export interface InsertDeviceEventInput {
  deviceEventId: string;
  deviceId: string;
  eventType: string;
  taskId?: string;
  sessionId?: string;
  payloadJson: string;
  createdAtMs: number;
}

export interface SearchMessageResult {
  messageId: string;
  sessionId: string;
  text: string;
}

export interface MessageRecord {
  messageId: string;
  sessionId: string;
  role: string;
  text: string;
  timestampMs: number;
}

export interface TaskRepositoryPacket {
  taskId: string;
  objective: string;
  sourceSessionId: string;
  targetAgent: string;
  executionMode: string;
}

export type TaskRepositoryStatus =
  | "created"
  | "admitted"
  | "running"
  | "awaiting_confirmation"
  | "succeeded"
  | "failed";

interface SearchMessageRow {
  message_id: string;
  session_id: string;
  text: string;
}

interface MessageRow {
  message_id: string;
  session_id: string;
  role: string;
  text: string;
  timestamp_ms: number;
}

interface SessionKeyRow {
  session_id: string;
}

interface TaskRow {
  task_id: string;
  status: TaskRepositoryStatus;
}

interface TaskPacketRow {
  task_id: string;
  status: TaskRepositoryStatus;
  packet_json: string;
}

interface EventRow {
  event_type: string;
  task_id: string | null;
  session_id: string | null;
  payload_json: string;
}

export function createRepositories(db: OpenPeachDb) {
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

  const getMessageStatement = db.prepare(`
    SELECT message_id, session_id, role, text, timestamp_ms
    FROM session_messages
    WHERE message_id = ?
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

  const listEventsForTaskStatement = db.prepare(`
    SELECT event_type, task_id, session_id, payload_json
    FROM events
    WHERE task_id = ?
    ORDER BY created_at_ms, event_id
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

  const insertDeviceEventStatement = db.prepare(`
    INSERT INTO device_events (
      device_event_id,
      device_id,
      event_type,
      task_id,
      session_id,
      payload_json,
      created_at_ms
    )
    VALUES (
      @deviceEventId,
      @deviceId,
      @eventType,
      @taskId,
      @sessionId,
      @payloadJson,
      @createdAtMs
    )
  `);

  const markOutboxSentStatement = db.prepare(`
    UPDATE outbox
    SET status = 'sent',
        updated_at_ms = @nowMs
    WHERE outbox_id = @outboxId
  `);

  const insertTaskStatement = db.prepare(`
    INSERT INTO tasks (
      task_id,
      source_session_id,
      target_agent,
      execution_mode,
      status,
      objective,
      packet_json,
      created_at_ms,
      updated_at_ms
    )
    VALUES (
      @taskId,
      @sourceSessionId,
      @targetAgent,
      @executionMode,
      @status,
      @objective,
      @packetJson,
      @nowMs,
      @nowMs
    )
  `);

  const updateTaskStatusStatement = db.prepare(`
    UPDATE tasks
    SET status = @status,
        updated_at_ms = @nowMs
    WHERE task_id = @taskId
  `);

  const getTaskStatement = db.prepare(`
    SELECT task_id, status
    FROM tasks
    WHERE task_id = ?
  `);

  const getTaskPacketStatement = db.prepare(`
    SELECT task_id, status, packet_json
    FROM tasks
    WHERE task_id = ?
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

    getMessageById(messageId: string): MessageRecord | undefined {
      const row = getMessageStatement.get(messageId) as MessageRow | undefined;
      if (!row) {
        return undefined;
      }

      return {
        messageId: row.message_id,
        sessionId: row.session_id,
        role: row.role,
        text: row.text,
        timestampMs: row.timestamp_ms,
      };
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

    markOutboxSent(outboxId: string): void {
      markOutboxSentStatement.run({
        outboxId,
        nowMs: Date.now(),
      });
    },

    insertDeviceEvent(input: InsertDeviceEventInput): void {
      insertDeviceEventStatement.run({
        ...input,
        taskId: input.taskId ?? null,
        sessionId: input.sessionId ?? null,
      });
    },

    createTask(
      packet: TaskRepositoryPacket,
      status: "created" | "admitted",
    ): void {
      const existing = getTask(packet.taskId);
      if (existing) {
        if (existing.status === status) {
          return;
        }
        if (existing.status !== "created" || status !== "admitted") {
          throw new Error(
            `invalid task status transition: ${existing.status} -> ${status}`,
          );
        }

        updateTaskStatusStatement.run({
          taskId: packet.taskId,
          status,
          nowMs: Date.now(),
        });
        return;
      }

      insertTaskStatement.run({
        ...packet,
        status,
        packetJson: JSON.stringify(packet),
        nowMs: Date.now(),
      });
    },

    updateTaskStatus(
      taskId: string,
      status: "running" | "awaiting_confirmation" | "succeeded" | "failed",
    ): void {
      const existing = getTask(taskId);
      if (!existing) {
        throw new Error(`task not found: ${taskId}`);
      }
      if (!isAllowedTaskTransition(existing.status, status)) {
        throw new Error(
          `invalid task status transition: ${existing.status} -> ${status}`,
        );
      }

      updateTaskStatusStatement.run({
        taskId,
        status,
        nowMs: Date.now(),
      });
    },

    reviveTask(taskId: string): void {
      const existing = getTask(taskId);
      if (!existing) {
        throw new Error(`task not found: ${taskId}`);
      }
      if (existing.status === "running") {
        return;
      }
      if (existing.status !== "failed") {
        throw new Error(
          `invalid task revive transition: ${existing.status} -> running`,
        );
      }

      updateTaskStatusStatement.run({
        taskId,
        status: "running",
        nowMs: Date.now(),
      });
    },

    getTask(
      taskId: string,
    ): { taskId: string; status: TaskRepositoryStatus } | undefined {
      const row = getTask(taskId);
      if (!row) {
        return undefined;
      }

      return {
        taskId: row.task_id,
        status: row.status,
      };
    },

    getTaskPacket(
      taskId: string,
    ):
      | {
          taskId: string;
          status: TaskRepositoryStatus;
          packetJson: string;
        }
      | undefined {
      const row = getTaskPacketStatement.get(taskId) as TaskPacketRow | undefined;
      if (!row) {
        return undefined;
      }

      return {
        taskId: row.task_id,
        status: row.status,
        packetJson: row.packet_json,
      };
    },

    listEventsForTask(taskId: string): EventRecord[] {
      return listEventsForTaskStatement.all(taskId).map((row) => {
        const event = row as EventRow;

        return {
          eventType: event.event_type,
          taskId: event.task_id ?? undefined,
          sessionId: event.session_id ?? undefined,
          payloadJson: event.payload_json,
        };
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

  function getTask(taskId: string): TaskRow | undefined {
    return getTaskStatement.get(taskId) as TaskRow | undefined;
  }
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

function isAllowedTaskTransition(from: string, to: string): boolean {
  return (
    (from === "admitted" && to === "running") ||
    (from === "awaiting_confirmation" && to === "running") ||
    (from === "running" &&
      (to === "awaiting_confirmation" ||
        to === "succeeded" ||
        to === "failed"))
  );
}
