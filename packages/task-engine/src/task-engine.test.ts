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
import { parseDeviceIntent } from "./device-intent.js";
import { TaskRegistry } from "./task-registry.js";

describe("task engine", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("admits allowlisted owner private text as a turn task", () => {
    expect(
      admitTask({
        text: "hello",
        sessionId: "session-1",
        requesterIdentity: { role: "owner", allowed: true },
      }).executionMode,
    ).toBe("turn");
  });

  it("denies owner-shaped requesters that have not passed allowlist resolution", () => {
    const decision = admitTask({
      text: "is the living room lamp on?",
      sessionId: "session-1",
      requesterIdentity: { role: "owner" },
    });

    expect(decision).toMatchObject({
      admitted: false,
      reason: "Task denied because requester was not allowlisted",
    });
    expect("task" in decision).toBe(false);
  });

  it("routes explicit living-room lamp requests to the home agent as P1 device work", () => {
    const decision = admitTask({
      text: "is the living room lamp on?",
      sessionId: "session-home-1",
      messageId: "message-home-1",
      requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
    });

    expect(decision).toMatchObject({
      admitted: true,
      executionMode: "microtask",
      task: {
        taskId: "task:session-home-1:message-home-1",
        scopeKind: "device",
        scopeRef: "mock:living-room-lamp",
        targetAgent: "home",
        priority: "P1",
        executionMode: "microtask",
        resourceLocks: ["device:mock:living-room-lamp"],
        memoryPolicy: "session_only",
      },
    });
  });

  it("routes self-improvement and project requests to lab as candidate-memory work", () => {
    const decision = admitTask({
      text: "lab: turn this task trace into a reusable skill",
      sessionId: "session-lab-1",
      messageId: "message-lab-1",
      requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
    });

    expect(decision).toMatchObject({
      admitted: true,
      executionMode: "job",
      task: {
        taskId: "task:session-lab-1:message-lab-1",
        scopeKind: "project",
        scopeRef: "openpeach-self-improvement",
        targetAgent: "lab",
        priority: "P3",
        executionMode: "job",
        resourceLocks: ["project:openpeach-self-improvement"],
        memoryPolicy: "candidate_memory",
      },
    });
  });

  it("parses device intent without coupling routing to keyword checks", () => {
    expect(parseDeviceIntent("\u8bf7\u5e2e\u6211\u6253\u5f00\u5ba2\u5385\u706f")).toEqual({
      deviceId: "mock:living-room-lamp",
      matchedAlias: "\u5ba2\u5385\u706f",
    });

    expect(parseDeviceIntent("start camera recording")).toEqual({
      deviceId: "mock:front-camera",
      matchedAlias: "camera",
    });

    expect(parseDeviceIntent("chat with me")).toBeUndefined();
  });

  it("keeps optional toy intents out of home routing until enabled", () => {
    expect(parseDeviceIntent("trigger story bunny bedtime")).toEqual({
      deviceId: "toy:story-bunny",
      matchedAlias: "story bunny",
    });

    expect(
      admitTask({
        text: "trigger story bunny bedtime",
        sessionId: "session-toy-default",
        messageId: "message-toy-default",
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      }).task,
    ).toMatchObject({
      targetAgent: "main",
      scopeKind: "conversation",
    });

    expect(
      admitTask({
        text: "trigger story bunny bedtime",
        sessionId: "session-toy-enabled",
        messageId: "message-toy-enabled",
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
        enabledDeviceIds: ["toy:story-bunny"],
      }).task,
    ).toMatchObject({
      targetAgent: "home",
      scopeKind: "device",
      scopeRef: "toy:story-bunny",
    });
  });

  it("denies unknown requesters without creating a model task", () => {
    const decision = admitTask({
      text: "hello",
      sessionId: "session-1",
      requesterIdentity: { role: "unknown" },
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toMatch(/denied|unknown|allowlisted/i);
    expect("task" in decision).toBe(false);
  });

  it("denies empty or whitespace-only text without creating a task", () => {
    const decision = admitTask({
      text: "   ",
      sessionId: "session-1",
      requesterIdentity: { role: "owner", allowed: true },
    });

    expect(decision).toMatchObject({
      admitted: false,
    });
    expect(decision.reason).toMatch(/empty|whitespace/i);
    expect("task" in decision).toBe(false);
  });

  it("assigns session-scoped task ids for repeated identical turns", () => {
    const withMessageA = admitTask({
      text: "hello",
      sessionId: "session-1",
      messageId: "message-1",
      requesterIdentity: { role: "owner", allowed: true },
    });
    const withMessageB = admitTask({
      text: "hello",
      sessionId: "session-1",
      messageId: "message-2",
      requesterIdentity: { role: "owner", allowed: true },
    });
    const sameMessageOtherSession = admitTask({
      text: "hello",
      sessionId: "session-2",
      messageId: "message-1",
      requesterIdentity: { role: "owner", allowed: true },
    });
    const generatedA = admitTask({
      text: "hello",
      sessionId: "session-1",
      requesterIdentity: { role: "owner", allowed: true },
    });
    const generatedB = admitTask({
      text: "hello",
      sessionId: "session-1",
      requesterIdentity: { role: "owner", allowed: true },
    });

    expect(withMessageA.task?.taskId).toBe("task:session-1:message-1");
    expect(withMessageB.task?.taskId).toBe("task:session-1:message-2");
    expect(sameMessageOtherSession.task?.taskId).toBe("task:session-2:message-1");
    expect(withMessageA.task?.taskId).not.toBe(withMessageB.task?.taskId);
    expect(withMessageA.task?.taskId).not.toBe(
      sameMessageOtherSession.task?.taskId,
    );
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
        text: "hello",
        sessionId: "session-1",
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
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
        text: "hello",
        sessionId: "session-1",
        taskId: "task-audit-1",
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
      });

      expect(decision.task).toBeDefined();
      registry.create(decision.task);

      const row = db
        .prepare("SELECT packet_json FROM tasks WHERE task_id = ?")
        .get(decision.task.taskId) as { packet_json: string };

      expect(JSON.parse(row.packet_json)).toMatchObject({
        taskId: "task-audit-1",
        objective: "hello",
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
        text: "hello",
        sessionId: "session-1",
        taskId: "task-status-1",
        requesterIdentity: { role: "owner", allowed: true, personId: "person-1" },
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
