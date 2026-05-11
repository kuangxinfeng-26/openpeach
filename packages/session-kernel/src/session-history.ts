export interface SessionHistoryRepo {
  listRecentMessages(
    sessionId: string,
    limit?: number,
  ): Array<{
    messageId: string;
    sessionId: string;
    role: string;
    text: string;
    timestampMs: number;
  }>;
  countSessionMessages(sessionId: string): number;
}

export interface SessionHistoryMessage {
  messageId: string;
  role: string;
  text: string;
  timestampMs: number;
}

export interface SessionHistoryResult {
  sessionId: string;
  messages: SessionHistoryMessage[];
  totalCount: number;
  hasMore: boolean;
}

/**
 * Retrieves recent conversation history for a session.
 * Messages are returned in chronological order (oldest first).
 * Useful for prompt assembly and context building.
 */
export function getSessionHistory(
  repo: SessionHistoryRepo,
  sessionId: string,
  options: { limit?: number } = {},
): SessionHistoryResult {
  const limit = options.limit ?? 20;
  const totalCount = repo.countSessionMessages(sessionId);
  const messages = repo.listRecentMessages(sessionId, limit);

  return {
    sessionId,
    messages: messages.map((m) => ({
      messageId: m.messageId,
      role: m.role,
      text: m.text,
      timestampMs: m.timestampMs,
    })),
    totalCount,
    hasMore: totalCount > limit,
  };
}
