import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepositories,
  migrate,
  openPeachDb,
} from "../../store-sqlite/src/index.js";
import { admitTask } from "./admission.js";
import { TaskRegistry } from "./task-registry.js";

describe("task engine", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("admits allowed owner private text as a turn task", () => {
    expect(
      admitTask({
        text: "浣犲ソ",
        sessionId: "session-1",
        requesterIdentity: { role: "owner" },
      }).executionMode,
    ).toBe("turn");
  });

  it("denies unknown requesters without creating a model task", () => {
    const decision = admitTask({
      text: "浣犲ソ",
      sessionId: "session-1",
      requesterIdentity: { role: "unknown" },
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toMatch(/denied|unknown/i);
    expect("task" in decision).toBe(false);
  });

  it("denies empty or whitespace-only text without creating a task", () => {
    const decision = admitTask({
      text: "   ",
      sessionId: "session-1",
      requesterIdentity: { role: "owner" },
    });

    expect(decision).toMatchObject({
      admitted: false,
    });
    expect(decision.reason).toMatch(/empty|whitespace/i);
    expect("task" in decision).toBe(false);
  });

  it("assigns distinct task ids for repeated identical turns", () => {
    const withMessageA = admitTask({
      text: "浣犲ソ",
      sessionId: "session-1",
      messageId: "message-1",
      requesterIdentity: { role: "owner" },
    });
    const withMessageB = admitTask({
      text: "浣犲ソ",
      sessionId: "session-1",
      messageId: "message-2",
      requesterIdentity: { role: "owner" },
    });
    const generatedA = admitTask({
      text: "浣犲ソ",
      sessionId: "session-1",
      requesterIdentity: { role: "owner" },
    });
    const generatedB = admitTask({
      text: "浣犲ソ",
      sessionId: "session-1",
      requesterIdentity: { role: "owner" },
    });

    expect(withMessageA.task?.taskId).toBe("message-1");
    expect(withMessageB.task?.taskId).toBe("message-2");
    expect(withMessageA.task?.taskId).not.toBe(withMessageB.task?.taskId);
    expect(generatedA.task?.taskId).toBeDefined();
    expect(generatedB.task?.taskId).toBeDefined();
    expect(generatedA.task?.taskId).not.toBe(generatedB.task?.taskId);
  });

  it("persists task registry status progression", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = new TaskRegistry(createRepositories(db));
      const decision = admitTask({
        text: "浣犲ソ",
        sessionId: "session-1",
        requesterIdentity: { role: "owner", personId: "person-1" },
      });

      expect(decision.task).toBeDefined();
      registry.create(decision.task);
      expect(registry.get(decision.task.taskId)).toEqual({
        taskId: decision.task.taskId,
        status: "created",
      });

      registry.admit(decision.task);
      expect(registry.get(decision.task.taskId)?.status).toBe("admitted");

      registry.markRunning(decision.task.taskId);
      expect(registry.get(decision.task.taskId)?.status).toBe("running");

      registry.markSucceeded(decision.task.taskId);
      expect(registry.get(decision.task.taskId)?.status).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  it("persists packet_json for audit and reconstruction", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = new TaskRegistry(createRepositories(db));
      const decision = admitTask({
        text: "浣犲ソ",
        sessionId: "session-1",
        taskId: "task-audit-1",
        requesterIdentity: { role: "owner", personId: "person-1" },
      });

      expect(decision.task).toBeDefined();
      registry.create(decision.task);

      const row = db
        .prepare("SELECT packet_json FROM tasks WHERE task_id = ?")
        .get(decision.task.taskId) as { packet_json: string };

      expect(JSON.parse(row.packet_json)).toMatchObject({
        taskId: "task-audit-1",
        objective: "浣犲ソ",
        sourceSessionId: "session-1",
      });
    } finally {
      db.close();
    }
  });

  it("rejects invalid task status regressions", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = new TaskRegistry(createRepositories(db));
      const decision = admitTask({
        text: "浣犲ソ",
        sessionId: "session-1",
        taskId: "task-status-1",
        requesterIdentity: { role: "owner", personId: "person-1" },
      });

      expect(decision.task).toBeDefined();
      registry.create(decision.task);
      registry.admit(decision.task);
      registry.markRunning(decision.task.taskId);
      registry.markSucceeded(decision.task.taskId);

      expect(() => registry.markRunning(decision.task.taskId)).toThrow(
        /invalid task status transition/i,
      );
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-task-engine-"));
    return openPeachDb(join(dir, "state.db"));
  }
});
