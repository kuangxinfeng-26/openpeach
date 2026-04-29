import { randomUUID } from "node:crypto";
import {
  createEventBus,
  type OpenPeachEvent,
} from "../../../packages/event-bus/src/index.js";
import type { createSkillEvolutionEngine } from "../../../packages/skill-evolution/src/index.js";
import { TaskPacketSchema } from "../../../packages/task-engine/src/index.js";

export type GatewayEventPublisherDeps = {
  repositories: {
    insertEvent(input: {
      eventId: string;
      eventType: string;
      taskId?: string;
      sessionId?: string;
      payloadJson: string;
      createdAtMs: number;
    }): void;
    getTaskPacket(taskId: string):
      | {
          taskId: string;
          status: string;
          packetJson: string;
        }
      | undefined;
  };
  skillEvolution: ReturnType<typeof createSkillEvolutionEngine>;
  createEventId?: () => string;
  nowMs?: () => number;
  onEvolutionError?: (error: unknown) => void;
};

export function createGatewayEventPublisher(
  deps: GatewayEventPublisherDeps,
): (event: OpenPeachEvent) => void {
  const eventBus = createEventBus(deps.repositories);
  const createEventId = deps.createEventId ?? randomUUID;
  const nowMs = deps.nowMs ?? Date.now;

  return (event) => {
    eventBus.publish({
      eventId: createEventId(),
      event,
      createdAtMs: nowMs(),
    });

    if (event.type !== "task.completed") {
      return;
    }

    try {
      const taskRecord = deps.repositories.getTaskPacket(event.taskId);
      if (!taskRecord) {
        return;
      }

      deps.skillEvolution.proposeFromCompletedTask({
        task: TaskPacketSchema.parse(JSON.parse(taskRecord.packetJson)),
        events: [event],
      });
    } catch (error) {
      if (deps.onEvolutionError) {
        deps.onEvolutionError(error);
        return;
      }

      console.error("Skill evolution proposal failed");
    }
  };
}
