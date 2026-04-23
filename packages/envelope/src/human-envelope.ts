import { z } from "zod";

export const HumanEnvelopeSchema = z.object({
  id: z.string(),
  channel: z.literal("telegram"),
  accountId: z.string(),
  chatType: z.enum(["private", "group", "supergroup", "channel"]),
  peerId: z.string(),
  chatId: z.string(),
  threadId: z.string().optional(),
  messageId: z.string(),
  text: z.string().min(1),
  timestampMs: z.number().int().positive(),
  raw: z.unknown(),
});

export type HumanEnvelope = z.infer<typeof HumanEnvelopeSchema>;
