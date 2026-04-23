import type { TaoqibaoEvent } from "./events.js";

export interface PublishEventInput {
  eventId: string;
  event: TaoqibaoEvent;
  createdAtMs: number;
}

export interface EventRepository {
  insertEvent(input: {
    eventId: string;
    eventType: string;
    taskId?: string;
    sessionId?: string;
    payloadJson: string;
    createdAtMs: number;
  }): void;
}

export function createEventBus(repository: EventRepository) {
  return {
    publish(input: PublishEventInput): void {
      repository.insertEvent({
        eventId: input.eventId,
        eventType: input.event.type,
        taskId: "taskId" in input.event ? input.event.taskId : undefined,
        sessionId: input.event.sessionId,
        payloadJson: JSON.stringify(input.event.payload),
        createdAtMs: input.createdAtMs,
      });
    },
  };
}

export type { TaoqibaoEvent } from "./events.js";
