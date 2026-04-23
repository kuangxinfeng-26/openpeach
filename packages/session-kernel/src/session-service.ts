import { createHash } from "node:crypto";
import type { createRepositories } from "../../store-sqlite/src/repositories.js";
import { buildSessionKey, type SessionKeyInput } from "./session-key.js";

type SessionRepo = ReturnType<typeof createRepositories>;

export type SessionContext = {
  sessionId: string;
  sessionKey: string;
  familyId: string;
  coreAgentId: "main";
};

export function getOrCreateSession(
  repo: SessionRepo,
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
