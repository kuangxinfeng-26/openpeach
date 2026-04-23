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

    const error = await captureError(
      client.complete([{ role: "user", content: "hello" }]),
    );

    expect(error.message).toContain("401");
    expect(error.message).toContain("Unauthorized");
    expect(error.message).toContain("provider request failed");
    expect(String(error)).not.toContain("test-key-secret");
    expect(error.message).not.toContain("test-key-secret");
    expect(error.message).not.toContain("upstream rejected");
  });

  it("does not leak raw upstream response bodies in non-2xx errors", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetch: async () =>
        new Response("provider stack trace: token=abc123", {
          status: 500,
          statusText: "Internal Server Error",
        }),
    });

    const error = await captureError(
      client.complete([{ role: "user", content: "hello" }]),
    );

    expect(error.message).toContain("500");
    expect(error.message).toContain("provider request failed");
    expect(error.message).not.toContain("provider stack trace");
    expect(error.message).not.toContain("token=abc123");
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

  it("joins text parts when content is returned as an array", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: "text", text: "  hello " },
                    { type: "image_url", image_url: { url: "https://example.test/image.png" } },
                    { type: "text", text: " Taoqibao  " },
                  ],
                },
              },
            ],
          }),
        ),
    });

    await expect(
      client.complete([{ role: "user", content: "hello" }]),
    ).resolves.toBe("hello Taoqibao");
  });

  it("throws a controlled error when content is not plain text", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "test-key",
      model: "test-model",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }],
                },
              },
            ],
          }),
        ),
    });

    await expect(
      client.complete([{ role: "user", content: "hello" }]),
    ).rejects.toThrow("Model response did not contain plain text");
  });

  it("does not destroy error messages when apiKey is empty", async () => {
    const client = new ExternalChatClient({
      baseUrl: "https://model.test/v1",
      apiKey: "",
      model: "test-model",
      fetch: async () =>
        new Response(null, {
          status: 503,
          statusText: "Service Unavailable",
        }),
    });

    const error = await captureError(
      client.complete([{ role: "user", content: "hello" }]),
    );

    expect(error.message).toBe(
      "External chat request failed with 503 Service Unavailable: provider request failed",
    );
  });
});

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected promise to reject");
}
