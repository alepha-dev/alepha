/*
 * The two client-side halves of an `$sse` stream, in a file of their own
 * with no server dependency: `SseStream` (a direct `run()`) and
 * `SseFetchResponse` (an HTTP response read as it arrives). Exported from
 * the shared barrel, so the browser entry of `alepha/server` has them too:
 * `$client` opens a `$sse` from the browser with `SseFetchResponse`.
 */

/**
 * Async iterable stream of SSE events.
 *
 * Supports push-based event delivery via `push()`, error propagation
 * via `fail()`, and clean termination via `end()`.
 */
export class SseStream<T> implements AsyncIterable<T> {
  protected queue: T[] = [];
  protected error: Error | null = null;
  protected done = false;
  protected resolve: (() => void) | null = null;
  protected listeners: Array<(data: T) => void> = [];

  /**
   * Push a new event into the stream.
   */
  public push(data: T): void {
    if (this.done) return;
    this.queue.push(data);
    for (const listener of this.listeners) {
      listener(data);
    }
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Signal an error on the stream.
   */
  public fail(error: Error): void {
    this.error = error;
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * End the stream gracefully.
   */
  public end(): void {
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /**
   * Subscribe to new events as they arrive.
   */
  public subscribe(listener: (data: T) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.error) {
        throw this.error;
      }
      if (this.done) {
        return;
      }
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}

// ----------------------------------------------------------------------------------------------------------

/**
 * Response wrapper for SSE fetch requests.
 *
 * Wraps a standard `Response` and parses the `text/event-stream` body
 * into an async iterable of typed events.
 */
export class SseFetchResponse<T> implements AsyncIterable<T> {
  public readonly response: Response;

  constructor(response: Response) {
    this.response = response;
  }

  /**
   * HTTP status code of the response.
   */
  public get status(): number {
    return this.response.status;
  }

  /**
   * HTTP status text of the response.
   */
  public get statusText(): string {
    return this.response.statusText;
  }

  /**
   * Response headers.
   */
  public get headers(): Headers {
    return this.response.headers;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const reader = this.response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              yield JSON.parse(data) as T;
            } catch {
              // skip non-JSON data lines
            }
          }
        }
      }

      // process remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6);
        try {
          yield JSON.parse(data) as T;
        } catch {
          // skip non-JSON data lines
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
