export type OpenPeachEvent =
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
    }
  | {
      type: "device.state_read";
      sessionId: string;
      taskId: string;
      payload: { deviceId: string; state: Record<string, unknown> };
    }
  | {
      type: "device.command_acknowledged";
      sessionId: string;
      taskId: string;
      payload: {
        deviceId: string;
        action: string;
        commandId: string;
        state: Record<string, unknown>;
      };
    };

export type { OpenPeachEvent as Event };
