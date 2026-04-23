import type { createRepositories } from "../../store-sqlite/src/repositories.js";

type SessionRepo = ReturnType<typeof createRepositories>;

export interface SessionSearchResult {
  messageId: string;
  sessionId: string;
  snippet: string;
}

export function sessionSearch(
  repo: SessionRepo,
  query: string,
): SessionSearchResult[] {
  return repo.searchMessages(query).map((result) => ({
    messageId: result.messageId,
    sessionId: result.sessionId,
    snippet: result.text,
  }));
}
