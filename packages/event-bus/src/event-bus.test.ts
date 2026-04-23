import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepositories,
  migrate,
  openTaoqibaoDb,
} from "../../store-sqlite/src/index.js";
import { createEventBus } from "./index.js";

describe("event bus", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("persists a task.created event with its typed payload", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);
      const eventBus = createEventBus(repositories);

      eventBus.publish({
        eventId: "event-1",
        createdAtMs: 1_710_000_000_000,
        event: {
          type: "task.created",
          sessionId: "session-1",
          taskId: "task-1",
          payload: {
            objective: "Draft a family travel checklist",
          },
        },
      });

      const row = db
        .prepare(
          `
            SELECT event_id, event_type, task_id, session_id, payload_json, created_at_ms
            FROM events
            WHERE event_id = ?
          `,
        )
        .get("event-1") as
        | {
            event_id: string;
            event_type: string;
            task_id: string | null;
            session_id: string | null;
            payload_json: string;
            created_at_ms: number;
          }
        | undefined;

      expect(row).toEqual({
        event_id: "event-1",
        event_type: "task.created",
        task_id: "task-1",
        session_id: "session-1",
        payload_json: JSON.stringify({
          objective: "Draft a family travel checklist",
        }),
        created_at_ms: 1_710_000_000_000,
      });
    } finally {
      db.close();
    }
  });

  it("ignores duplicate outbox inserts for the same idempotency key", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);

      repositories.insertOutboxOnce({
        outboxId: "outbox-1",
        idempotencyKey: "telegram:session-1:task-1",
        channel: "telegram",
        targetRef: "chat:456",
        payloadJson: JSON.stringify({ text: "First send" }),
      });

      repositories.insertOutboxOnce({
        outboxId: "outbox-2",
        idempotencyKey: "telegram:session-1:task-1",
        channel: "telegram",
        targetRef: "chat:789",
        payloadJson: JSON.stringify({ text: "Second send" }),
      });

      const countRow = db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM outbox
            WHERE idempotency_key = ?
          `,
        )
        .get("telegram:session-1:task-1") as { count: number };

      const row = db
        .prepare(
          `
            SELECT outbox_id, channel, target_ref, payload_json, status, created_at_ms, updated_at_ms
            FROM outbox
            WHERE idempotency_key = ?
          `,
        )
        .get("telegram:session-1:task-1") as
        | {
            outbox_id: string;
            channel: string;
            target_ref: string;
            payload_json: string;
            status: string;
            created_at_ms: number;
            updated_at_ms: number;
          }
        | undefined;

      expect(countRow.count).toBe(1);
      expect(row).toMatchObject({
        outbox_id: "outbox-1",
        channel: "telegram",
        target_ref: "chat:456",
        payload_json: JSON.stringify({ text: "First send" }),
        status: "pending",
      });
      expect(row?.created_at_ms).toEqual(expect.any(Number));
      expect(row?.updated_at_ms).toEqual(expect.any(Number));
    } finally {
      db.close();
    }
  });

  it("throws when a duplicate outbox id uses a different idempotency key", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const repositories = createRepositories(db);

      repositories.insertOutboxOnce({
        outboxId: "outbox-1",
        idempotencyKey: "telegram:session-1:task-1",
        channel: "telegram",
        targetRef: "chat:456",
        payloadJson: JSON.stringify({ text: "First send" }),
      });

      expect(() =>
        repositories.insertOutboxOnce({
          outboxId: "outbox-1",
          idempotencyKey: "telegram:session-1:task-2",
          channel: "telegram",
          targetRef: "chat:456",
          payloadJson: JSON.stringify({ text: "Second send" }),
        }),
      ).toThrow(/unique|constraint/i);
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-event-bus-"));
    return openTaoqibaoDb(join(dir, "state.db"));
  }
});
