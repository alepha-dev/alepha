import { AiAuthError } from "../errors/AiAuthError.ts";
import { AiContextLengthError } from "../errors/AiContextLengthError.ts";
import { AiError } from "../errors/AiError.ts";
import { AiOverloadedError } from "../errors/AiOverloadedError.ts";
import { AiRateLimitError } from "../errors/AiRateLimitError.ts";

/**
 * Maps a vendor's HTTP failure to the typed `AiError` family, so an app
 * branches on `instanceof AiRateLimitError` whatever vendor it registered.
 *
 * Shared by every HTTP vendor provider: Anthropic, OpenAI and the
 * compatible endpoints answer with the same statuses for the same causes,
 * and spell a context overflow in their message rather than in a code.
 */
export class AiHttpErrors {
  /**
   * Message fragments vendors use for a conversation that does not fit:
   * Anthropic's "prompt is too long", OpenAI's "maximum context length",
   * Ollama and vLLM variants.
   */
  public readonly contextPattern =
    /prompt is too long|context.length|context window|maximum context|too many tokens|context_length_exceeded/i;

  /**
   * Read a failed response and build the error to throw.
   */
  public async fromResponse(
    provider: string,
    response: Response,
  ): Promise<AiError> {
    const body = await response.text().catch(() => "");
    const message = this.messageOf(body) || response.statusText || "";
    return this.fromStatus(provider, response.status, message, {
      retryAfter: response.headers.get("retry-after"),
    });
  }

  /**
   * Build the error for a status and a vendor message.
   */
  public fromStatus(
    provider: string,
    status: number,
    message: string,
    extra: { retryAfter?: string | null } = {},
  ): AiError {
    const text = `${provider}: ${message || `HTTP ${status}`}`;
    const data = { provider, status };

    if (status === 401 || status === 403) {
      return new AiAuthError(data, { message: text });
    }
    if (status === 429) {
      const retryAfter = Number(extra.retryAfter);
      return new AiRateLimitError(
        Number.isFinite(retryAfter) && extra.retryAfter
          ? { ...data, retryAfter }
          : data,
        { message: text },
      );
    }
    if (status === 529 || status === 503) {
      return new AiOverloadedError(data, { message: text });
    }
    if (status === 413 || this.contextPattern.test(message)) {
      return new AiContextLengthError(data, { message: text });
    }
    return new AiError(data, { message: text });
  }

  /**
   * Build the error for a failure the vendor reported inside a stream that
   * had already started with a 200 (Anthropic's `event: error`, an OpenAI
   * chunk carrying `error`). `type` is the vendor's error type.
   */
  public fromStreamError(
    provider: string,
    type: string | undefined,
    message: string,
  ): AiError {
    const status =
      type === "overloaded_error"
        ? 529
        : type === "rate_limit_error"
          ? 429
          : type === "authentication_error"
            ? 401
            : type === "permission_error"
              ? 403
              : 0;
    if (status) {
      return this.fromStatus(provider, status, message);
    }
    if (this.contextPattern.test(message)) {
      return new AiContextLengthError(
        { provider },
        { message: `${provider}: ${message}` },
      );
    }
    return new AiError({ provider }, { message: `${provider}: ${message}` });
  }

  /**
   * The human message of a vendor error body: `{ error: { message } }`
   * (Anthropic, OpenAI), `{ error: "..." }` (Ollama), `{ errors: [...] }`
   * (the Cloudflare REST API), or the raw text.
   */
  protected messageOf(body: string): string {
    if (!body) {
      return "";
    }
    try {
      const json = JSON.parse(body);
      if (typeof json?.error === "string") {
        return json.error;
      }
      if (typeof json?.error?.message === "string") {
        return json.error.message;
      }
      if (Array.isArray(json?.errors) && json.errors[0]?.message) {
        return String(json.errors[0].message);
      }
      if (typeof json?.message === "string") {
        return json.message;
      }
    } catch {
      // not JSON: use the text
    }
    return body.slice(0, 500);
  }
}
