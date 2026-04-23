import type { TaskPacket } from "./task-packet.js";

export type TaskStatus =
  | "created"
  | "admitted"
  | "running"
  | "succeeded"
  | "failed";

export type TaskRepository = {
  createTask(packet: TaskPacket, status: "created" | "admitted"): void;
  updateTaskStatus(
    taskId: string,
    status: "running" | "succeeded" | "failed",
  ): void;
  getTask(taskId: string): { taskId: string; status: TaskStatus } | undefined;
};

export class TaskRegistry {
  constructor(private readonly repository: TaskRepository) {}

  create(packet: TaskPacket): void {
    this.repository.createTask(packet, "created");
  }

  admit(packet: TaskPacket): void {
    this.repository.createTask(packet, "admitted");
  }

  markRunning(taskId: string): void {
    this.repository.updateTaskStatus(taskId, "running");
  }

  markSucceeded(taskId: string): void {
    this.repository.updateTaskStatus(taskId, "succeeded");
  }

  markFailed(taskId: string): void {
    this.repository.updateTaskStatus(taskId, "failed");
  }

  get(taskId: string): { taskId: string; status: TaskStatus } | undefined {
    return this.repository.getTask(taskId);
  }
}
