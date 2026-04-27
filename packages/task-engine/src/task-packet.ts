import { z } from "zod";

export const TaskPacketSchema = z.object({
  taskId: z.string(),
  objective: z.string().min(1),
  scopeKind: z.enum(["conversation", "device", "project", "family", "custom"]),
  scopeRef: z.string(),
  sourceSessionId: z.string(),
  requesterIdentityId: z.string(),
  targetAgent: z.enum(["main", "home", "lab"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  executionMode: z.enum(["turn", "microtask", "job", "flow"]),
  acceptanceContract: z.string(),
  reportingContract: z.string(),
  escalationPolicy: z.string(),
  resourceLocks: z.array(z.string()),
  budget: z.object({
    runtimeMs: z.number().int().positive(),
    toolCalls: z.number().int().nonnegative(),
    childTasks: z.number().int().nonnegative(),
  }),
  memoryPolicy: z.enum([
    "session_only",
    "candidate_memory",
    "promote_if_verified",
  ]),
});

export type TaskPacket = z.infer<typeof TaskPacketSchema>;
