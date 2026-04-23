import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepositories,
  migrate,
  openTaoqibaoDb,
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
        text: "你好",
        sessionId: "session-1",
        requesterIdentity: { role: "owner" },
      }).executionMode,
    ).toBe("turn");
  });

  it("denies unknown requesters without creating a model task", () => {
    const decision = admitTask({
      text: "你好",
      sessionId: "session-1",
      requesterIdentity: { role: "unknown" },
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toMatch(/denied|unknown/i);
    expect("task" in decision).toBe(false);
  });

  it("persists task registry status progression", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = new TaskRegistry(createRepositories(db));
      const decision = admitTask({
        text: "你好",
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

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "taoqibao-task-engine-"));
    return openTaoqibaoDb(join(dir, "state.db"));
  }
});
