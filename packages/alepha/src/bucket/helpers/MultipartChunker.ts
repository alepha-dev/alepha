import type { FileLike } from "alepha";

/**
 * Cuts a stream into the parts a multipart upload protocol expects.
 *
 * Shared because S3 and R2 need exactly this, for exactly the same reason:
 * **neither accepts a body whose length is unknown.** R2's types say otherwise
 * — `put()` is typed to take a `ReadableStream` — and its runtime does not:
 * "Provided readable stream must have a known length (request/response body or
 * readable half of FixedLengthStream)". That compiles cleanly and only appears
 * on workerd, which is why it was found by deploying rather than by testing.
 *
 * A separate class rather than a method on `FileStorageProvider`: the providers
 * `implement` that contract instead of extending it, so anything protected
 * added there stops them being assignable to it.
 */
export class MultipartChunker {
  /**
   * The floor both protocols impose: every part but the last must reach 5 MiB.
   *
   * It is also what bounds a streaming provider's memory — one part at a time,
   * never the payload. Larger parts would mean fewer requests and more RAM.
   */
  public static readonly PART_SIZE = 5 * 1024 * 1024;

  /**
   * Yields the file's bytes in parts, the last one short.
   *
   * Always yields at least one part, empty if the file is: both protocols
   * refuse to complete an upload that has none.
   */
  public async *parts(file: FileLike): AsyncGenerator<Uint8Array> {
    const size = MultipartChunker.PART_SIZE;
    let pending: Uint8Array[] = [];
    let pendingSize = 0;
    let yielded = false;

    for await (const raw of file.stream() as AsyncIterable<
      Uint8Array | Buffer
    >) {
      const chunk = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      pending.push(chunk);
      pendingSize += chunk.length;

      while (pendingSize >= size) {
        const joined = this.join(pending, pendingSize);
        yield joined.subarray(0, size);
        yielded = true;
        const rest = joined.subarray(size);
        pending = rest.length > 0 ? [rest] : [];
        pendingSize = rest.length;
      }
    }

    if (pendingSize > 0 || !yielded) {
      yield this.join(pending, pendingSize);
    }
  }

  protected join(chunks: Uint8Array[], total: number): Uint8Array {
    if (chunks.length === 1) {
      return chunks[0];
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.length;
    }
    return joined;
  }
}
