import { $inject, AlephaError, z } from "alepha";
import { HttpClient } from "alepha/server";
import { FileSystemProvider } from "alepha/system";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Sends a packed artifact to a Lore instance without ever holding it.
 *
 * ## ⚠️ Why this is not `$client`
 *
 * Every other call in this package goes through `$client<SomeController>()`,
 * which checks the call against the endpoint that will answer it. This one
 * cannot, and the reason is memory rather than taste: `HttpClient.body()`
 * builds a `FormData` for a multipart action and materialises a `FileLike`
 * through `new File([await value.arrayBuffer()], ...)`. That reads the whole
 * tarball into the CLI's heap, which is precisely what a CI runner packing a
 * large app cannot afford and what this quest was written to avoid.
 *
 * A `Blob` would be appended by reference and streamed - but a lazily-read
 * `Blob` over a path is `node:fs`'s `openAsBlob`, which is not a seam this
 * package has and not something every runtime it may run on provides.
 *
 * So the multipart message is composed here, as a stream, over
 * `FileSystemProvider.readFileStream`. Peak memory is one chunk.
 *
 * **The cost is real and worth naming**: the endpoint is addressed by PATH, so
 * a renamed route answers an older CLI with a 404 rather than failing
 * typecheck. Same class of promise as the action names `QualityController`
 * documents, one level lower.
 */
export class ArtifactUploader {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly http = $inject(HttpClient);
  protected readonly client = $inject(LoreClientService);

  /**
   * What comes back. A hand-written shape, and the only one in this package.
   *
   * It exists for the same reason the transport does: the typed client would
   * have given this for free and cannot be used here. Kept to the four fields
   * the command prints, so the surface that can drift is as small as the job
   * allows - and `.loose()`, so a Lore that starts answering with more does
   * not break a CLI that wants less.
   */
  protected static readonly RESPONSE = z
    .object({
      artifact: z
        .object({
          app: z.string(),
          tag: z.string(),
          runtime: z.string(),
          sha256: z.string(),
          size: z.integer(),
        })
        .loose(),
      stored: z.boolean(),
    })
    .loose();

  /**
   * Push the tarball at `archivePath` into a project's registry.
   */
  public async upload(input: ArtifactUploadInput): Promise<ArtifactUploaded> {
    const fields: Record<string, string> = {
      app: this.field("app", input.app),
      tag: this.field("tag", input.tag),
    };
    if (input.commitSha) {
      fields.commitSha = this.field("commitSha", input.commitSha);
    }
    if (input.force) {
      fields.force = "true";
    }

    // Random enough that it cannot occur inside a gzip stream by accident, and
    // long enough that it cannot be produced by one on purpose either. The
    // parts are never scanned for it here - that is the receiver's job - so a
    // collision would corrupt the message silently, which is the one failure
    // mode a boundary has.
    const boundary = `----alepha-artifact-${crypto.randomUUID()}`;
    const stream = await this.fs.readFileStream(input.archivePath);

    const res = await this.http.fetch(
      `${this.client.hostname()}/api/projects/${input.projectId}/artifacts`,
      {
        method: "POST",
        headers: {
          authorization: await this.client.authorization(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        // A stream body needs `duplex: "half"` on undici, and the DOM lib's
        // `RequestInit` has no such field - it is a fetch extension, not a
        // spec type. Without it node refuses the request outright.
        duplex: "half",
        body: this.body(boundary, fields, input.filename, stream),
        schema: { response: ArtifactUploader.RESPONSE },
      } as never,
    );

    return res.data as ArtifactUploaded;
  }

  /**
   * The multipart message, as a stream.
   *
   * A pull-driven `ReadableStream` over an async generator: the scalar parts
   * are a few hundred bytes, the file part is forwarded chunk by chunk, and
   * nothing is ever concatenated. Pull rather than push, so the generator only
   * reads from disk as fast as the socket drains it - which is the whole
   * point, since a push loop would read the file at memory speed and buffer
   * the difference.
   *
   * ⚠️ Hand-built rather than `ReadableStream.from`. That helper exists on
   * node but is not in the DOM lib's type for `ReadableStream`, so using it
   * costs a cast that would also hide its absence anywhere it is missing.
   */
  protected body(
    boundary: string,
    fields: Record<string, string>,
    filename: string,
    file: AsyncIterable<unknown>,
  ): ReadableStream<Uint8Array> {
    const chunks = this.chunks(boundary, fields, filename, file);
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      },
      async cancel(reason) {
        // An abandoned request must close the file handle behind the
        // generator, and only `return()` runs its `finally`.
        await chunks.return(reason);
      },
    });
  }

  protected async *chunks(
    boundary: string,
    fields: Record<string, string>,
    filename: string,
    file: AsyncIterable<unknown>,
  ): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();

    for (const [name, value] of Object.entries(fields)) {
      yield encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      );
    }

    yield encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "Content-Type: application/gzip\r\n\r\n",
    );

    for await (const chunk of file) {
      yield chunk instanceof Uint8Array
        ? chunk
        : new Uint8Array(chunk as ArrayBufferLike);
    }

    yield encoder.encode(`\r\n--${boundary}--\r\n`);
  }

  /**
   * A scalar part's value, refused if it could not be one.
   *
   * ⚠️ This is a TRANSPORT check, not a copy of the server's rules. A quote or
   * a newline inside an unquoted form field ends the field or the part, so a
   * tag containing one would compose a message that says something other than
   * what the caller asked - and would do it silently. What an app name and a
   * tag may actually contain is Lore's to decide, and it answers 400 for the
   * rest.
   */
  protected field(name: string, value: string): string {
    if (/["\r\n]/.test(value)) {
      throw new AlephaError(
        `Invalid --${name} "${value}": a quote or a line break cannot travel in a form field.`,
      );
    }
    return value;
  }
}

export interface ArtifactUploadInput {
  projectId: number;
  app: string;
  tag: string;
  commitSha?: string;
  force?: boolean;
  /**
   * Absolute path to the `tar.gz` produced by `alepha pack`.
   */
  archivePath: string;
  /**
   * The name the part carries. Cosmetic on the receiving side - the runtime
   * comes from the manifest inside the archive and never from this - but it is
   * what a server-side log names.
   */
  filename: string;
}

export interface ArtifactUploaded {
  artifact: {
    app: string;
    tag: string;
    runtime: string;
    sha256: string;
    size: number;
  };
  /**
   * False when Lore already held these exact bytes, which is a success.
   */
  stored: boolean;
}
