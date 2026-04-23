import { createHash } from "node:crypto";
import { buildSessionKey, type SessionKeyInput } from "./session-key.js";

export interface SessionUpsertRepo {
  upsertSession(input: {
    sessionId: string;
    sessionKey: string;
    familyId: string;
    coreAgentId: string;
  }): void;
}

export type SessionContext = {
  sessionId: string;
  sessionKey: string;
  familyId: string;
  coreAgentId: "main";
};

export function getOrCreateSession(
  repo: SessionUpsertRepo,
  input: SessionKeyInput & { coreAgentId: "main" },
): SessionContext {
  const sessionKey = buildSessionKey(input);
  const sessionId = createHash("sha256").update(sessionKey, "utf8").digest("hex");

  repo.upsertSession({
    sessionId,
    sessionKey,
    familyId: input.familyId,
    coreAgentId: input.coreAgentId,
  });

  return {
    sessionId,
    sessionKey,
    familyId: input.familyId,
    coreAgentId: input.coreAgentId,
  };
}
