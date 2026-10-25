/**
 * Reads a `text/event-stream` body into events, as every vendor streams.
 *
 * Follows the WHATWG parsing rules, which the vendors rely on and a
 * line-splitting shortcut gets wrong:
 *
 * - a chunk may end anywhere, mid-line or mid-character (a UTF-8 sequence
 *   split across two reads is decoded whole);
 * - lines end with `\n`, `\r\n` or a lone `\r`;
 * - a line starting with `:` is a comment (a keep-alive) and is skipped;
 * - several `data:` lines make one event, joined with `\n`;
 * - one space after the colon is dropped, any more is data.
 *
 * Unlike the specification, an event still pending when the stream closes
 * without a final blank line is dispatched rather than dropped: a vendor
 * that forgets the last blank line should not lose its last event.
 *
 * @example
 * ```ts
 * for await (const event of sse.read(response.body!, signal)) {
 *   if (event.data === "[DONE]") break;
 *   handle(event.event, JSON.parse(event.data));
 * }
 * ```
 */
export class SseReader {
  /**
   * Iterate the events of a stream. Aborting `signal` cancels the stream and
   * makes the iterator throw the abort reason.
   */
  public async *read(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<SseEvent> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const onAbort = () => {
      reader.cancel(signal?.reason).catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let buffer = "";
    let pending: PendingEvent = { data: [] };

    try {
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true });

        let index = this.lineEnd(buffer, done);
        while (index !== -1) {
          const line = buffer.slice(0, index);
          const width =
            buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
          buffer = buffer.slice(index + width);

          if (line === "") {
            const event = this.dispatch(pending);
            pending = { data: [] };
            if (event) {
              yield event;
            }
          } else {
            this.field(pending, line);
          }
          index = this.lineEnd(buffer, done);
        }

        if (done) {
          if (buffer !== "") {
            this.field(pending, buffer);
          }
          const event = this.dispatch(pending);
          if (event) {
            yield event;
          }
          return;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }
  }

  /**
   * Index of the first line terminator in `buffer`, or -1. A `\r` as the
   * last character is not a terminator yet unless the stream is done: the
   * `\n` of a `\r\n` may be in the next chunk.
   */
  protected lineEnd(buffer: string, done: boolean): number {
    for (let i = 0; i < buffer.length; i++) {
      const c = buffer[i];
      if (c === "\n") {
        return i;
      }
      if (c === "\r") {
        return i === buffer.length - 1 && !done ? -1 : i;
      }
    }
    return -1;
  }

  protected field(pending: PendingEvent, line: string): void {
    if (line.startsWith(":")) {
      return;
    }
    const colon = line.indexOf(":");
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (name === "data") {
      pending.data.push(value);
    } else if (name === "event") {
      pending.event = value;
    } else if (name === "id") {
      pending.id = value;
    } else if (name === "retry" && /^\d+$/.test(value)) {
      pending.retry = Number(value);
    }
  }

  protected dispatch(pending: PendingEvent): SseEvent | undefined {
    if (pending.data.length === 0) {
      return undefined;
    }
    const event: SseEvent = { data: pending.data.join("\n") };
    if (pending.event) {
      event.event = pending.event;
    }
    if (pending.id !== undefined) {
      event.id = pending.id;
    }
    if (pending.retry !== undefined) {
      event.retry = pending.retry;
    }
    return event;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One server-sent event.
 */
export interface SseEvent {
  /**
   * The `event:` field, absent for the default `message` type.
   */
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

interface PendingEvent {
  event?: string;
  data: string[];
  id?: string;
  retry?: number;
}
