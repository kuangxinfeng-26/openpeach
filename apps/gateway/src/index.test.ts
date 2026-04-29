import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("gateway telegram wiring", () => {
  it("marks outbox rows as sent after Telegram confirms a reply", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );

    expect(source).toContain("onReplySent");
    expect(source).toContain("repositories.markOutboxSent(outboxId)");
  });

  it("wires the skill review registry into the Telegram pipeline", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );

    expect(source).toContain("createSkillRegistry(db)");
    expect(source).toContain("formatSkillReviewForTelegram(review)");
    expect(source).toContain("skillReview:");
  });

  it("wires skill evolution after event persistence without promoting skills", () => {
    const indexSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );
    const publisherSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "evolution-publisher.ts"),
      "utf8",
    );

    expect(indexSource).toContain("createSkillEvolutionEngine");
    expect(indexSource).toContain("createGatewayEventPublisher");
    expect(publisherSource).toContain("proposeFromCompletedTask");
    expect(`${indexSource}\n${publisherSource}`).not.toContain("promoteCandidate(");
  });

  it("wires the lab runtime into the Telegram pipeline", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );

    expect(source).toContain("LabAgentRuntime");
    expect(source).toContain("const labRuntime");
    expect(source).toContain("labRuntime,");
  });
});
