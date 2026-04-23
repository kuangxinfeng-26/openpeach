import { HumanEnvelopeSchema, type HumanEnvelope } from "./human-envelope.js";

type TelegramLikeMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: { id: number; is_bot: boolean; first_name?: string };
  text?: string;
  message_thread_id?: number;
};

export function normalizeTelegramMessage(input: {
  botAccountId: string;
  message: TelegramLikeMessage;
}): HumanEnvelope {
  const { botAccountId, message } = input;

  if (!message.text || message.text.trim().length === 0) {
    throw new Error("Phase 0 only supports Telegram text messages");
  }

  const peerId = message.from?.id ?? message.chat.id;

  return HumanEnvelopeSchema.parse({
    id: `telegram:${botAccountId}:${message.chat.id}:${message.message_id}`,
    channel: "telegram",
    accountId: botAccountId,
    chatType: message.chat.type,
    peerId: String(peerId),
    chatId: String(message.chat.id),
    threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
    messageId: String(message.message_id),
    text: message.text.trim(),
    timestampMs: message.date * 1000,
    raw: message,
  });
}
