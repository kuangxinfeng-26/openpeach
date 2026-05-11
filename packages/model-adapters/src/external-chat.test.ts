import { describe, expect, it, vi } from "vitest";
import { ExternalChatClient, type ExternalChatMessage } from "./external-chat.js";

function createMockFetch(response: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}) {
  const ok = response.ok ?? true;
  const status = response.status ?? 200;
  const statusText = response.statusText ?? "OK";
  const json = response.json ?? (() => Promise.resolve({}));

  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok,
    status,
    statusText,
    json,
  })) as unknown as (input: string, init?: RequestInit) => Promise<Response>;
}

describe("ExternalChatClient", () => {
  it("sends a chat completion request with correct headers and body", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hello back" } }],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-key",
      model: "gpt-4",
      fetch: mockFetch,
    });

    const messages: ExternalChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ];

    const result = await client.complete(messages);

    expect(result).toBe("Hello back");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");

    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-4");
    expect(body.messages).toEqual(messages);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "ok" } }],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com/v1///",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    await client.complete([{ role: "user", content: "test" }]);

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("throws on non-ok response and sanitizes API key from error", async () => {
    const mockFetch = createMockFetch({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "sk-secret-key-12345",
      model: "m",
      fetch: mockFetch,
    });

    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("provider request failed");
  });

  it("does not leak API key in error messages", async () => {
    const apiKey = "sk-super-secret-key";
    const mockFetch = createMockFetch({
      ok: false,
      status: 500,
      statusText: `Error with key ${apiKey}`,
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey,
      model: "m",
      fetch: mockFetch,
    });

    try {
      await client.complete([{ role: "user", content: "hi" }]);
    } catch (error) {
      expect((error as Error).message).not.toContain(apiKey);
      expect((error as Error).message).toContain("[REDACTED]");
    }
  });

  it("throws when response has no assistant content", async () => {
    const mockFetch = createMockFetch({
      json: () => Promise.resolve({ choices: [] }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toThrow();
  });

  it("throws when content is null", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: null } }],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toThrow();
  });

  it("handles array content with text parts", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "Hello" },
                  { type: "text", text: "World" },
                ],
              },
            },
          ],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    const result = await client.complete([{ role: "user", content: "hi" }]);
    expect(result).toBe("Hello World");
  });

  it("filters non-text parts from array content", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "Hello" },
                  { type: "image_url", url: "http://example.com" },
                  { type: "text", text: "World" },
                ],
              },
            },
          ],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    const result = await client.complete([{ role: "user", content: "hi" }]);
    expect(result).toBe("Hello World");
  });

  it("trims string content", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "  trimmed  " } }],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    const result = await client.complete([{ role: "user", content: "hi" }]);
    expect(result).toBe("trimmed");
  });

  it("throws when array content has no text parts", async () => {
    const mockFetch = createMockFetch({
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: [{ type: "image_url", url: "http://example.com" }],
              },
            },
          ],
        }),
    });

    const client = new ExternalChatClient({
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "m",
      fetch: mockFetch,
    });

    await expect(
      client.complete([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Model response did not contain plain text");
  });
});
