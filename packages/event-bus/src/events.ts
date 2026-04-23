export type TaoqibaoEvent =
  | {
      type: "message.received";
      sessionId: string;
      payload: { envelopeId: string };
    }
  | {
      type: "task.created";
      sessionId: string;
      taskId: string;
      payload: { objective: string };
    }
  | {
      type: "task.completed";
      sessionId: string;
      taskId: string;
      payload: { status: "succeeded" };
    }
  | {
      type: "task.failed";
      sessionId: string;
      taskId: string;
      payload: { reason: string };
    }
  | {
      type: "reply.queued";
      sessionId: string;
      taskId: string;
      payload: { outboxId: string };
    };

export type { TaoqibaoEvent as Event };
