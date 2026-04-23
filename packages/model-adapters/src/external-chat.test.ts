import { describe, expect, it } from "vitest";
import { ExternalChatClient } from "./external-chat.js";

describe("ExternalChatClient", () => {
  it("returns trimmed assistant content for a successful completion", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "  hello from Taoqibao  " } }],
          }),
        ),
    });

    await expect(
      client.complete([{ role: "user", content: "hello" }]),
    ).resolves.toBe("hello from Taoqibao");
  });

  it("throws a sanitized error for non-2xx responses", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key-secret",
      model: "test-model",
      fetch: async () =>
        new Response("upstream rejected Bearer test-key-secret", {
          status: 401,
          statusText: "Unauthorized",
        }),
    });

    await expect(
      client.complete([{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/401|Unauthorized/i);

    await client
      .complete([{ role: "user", content: "hello" }])
      .catch((error: Error) => {
        expect(String(error)).not.toContain("test-key-secret");
        expect(error.message).not.toContain("test-key-secret");
      });
  });

  it("aborts cleanly when the request times out", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 10,
      fetch: async (_input, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Expected abort signal"));
            return;
          }

          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new Error("request timed out"));
          });
        }),
    });

    await expect(
      client.complete([{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/timeout|timed out|aborted/i);
  });
});
