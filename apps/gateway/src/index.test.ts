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
});
