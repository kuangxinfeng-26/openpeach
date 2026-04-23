export type ExternalChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ExternalChatFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ExternalChatClientOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: ExternalChatFetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type TextContentPart = {
  type: "text";
  text: string;
};

export class ExternalChatClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: ExternalChatFetch;

  constructor(options: ExternalChatClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(messages: ExternalChatMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("Request timed out"));
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(
          this.sanitizeMessage(
            `External chat request failed with ${response.status} ${response.statusText}: provider request failed`,
          ),
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = this.extractAssistantContent(
        payload.choices?.[0]?.message?.content,
      );

      if (!content) {
        throw new Error("External chat response did not include assistant content");
      }

      return content;
    } catch (error) {
      throw this.sanitizeError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitizeError(error: unknown): Error {
    if (error instanceof Error) {
      return new Error(this.sanitizeMessage(error.message));
    }

    return new Error("External chat request failed");
  }

  private sanitizeMessage(message: string): string {
    if (!this.apiKey) {
      return message;
    }

    return message.split(this.apiKey).join("[REDACTED]");
  }

  private extractAssistantContent(content: unknown): string {
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .filter((part): part is TextContentPart => this.isTextContentPart(part))
        .map((part) => part.text.trim())
        .filter((part) => part.length > 0)
        .join(" ")
        .trim();

      if (text) {
        return text;
      }
    }

    throw new Error("Model response did not contain plain text");
  }

  private isTextContentPart(part: unknown): part is TextContentPart {
    if (!part || typeof part !== "object") {
      return false;
    }

    const candidate = part as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string";
  }
}
