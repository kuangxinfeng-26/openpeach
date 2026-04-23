export interface SessionSearchRepo {
  searchMessages(query: string): Array<{
    messageId: string;
    sessionId: string;
    text: string;
  }>;
}

export interface SessionSearchResult {
  messageId: string;
  sessionId: string;
  snippet: string;
}

export function sessionSearch(
  repo: SessionSearchRepo,
  query: string,
): SessionSearchResult[] {
  return repo.searchMessages(query).map((result) => ({
    messageId: result.messageId,
    sessionId: result.sessionId,
    snippet: result.text,
  }));
}
