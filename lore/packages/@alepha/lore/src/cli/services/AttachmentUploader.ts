import { $inject, AlephaError, z } from "alepha";
import { BadRequestError, HttpClient } from "alepha/server";
import { $client } from "alepha/server/links";
import { FileDetector, FileSystemProvider } from "alepha/system";
import type { FolioAttachmentController } from "lore/api/controllers/FolioAttachmentController";
import type { FolioController } from "lore/api/controllers/FolioController";
import type { QuestController } from "lore/api/controllers/QuestController";

import { LoreClientService } from "./LoreClientService.ts";

/**
 * Sends a file to a quest or a folio without ever holding it.
 *
 * ## ⚠️ Why the bytes are not sent through `$client`
 *
 * `ArtifactUploader`'s reason, verbatim, and it is memory rather than taste:
 * `HttpClient.body()` builds a `FormData` for a multipart action and
 * materialises a `FileLike` through `new File([await value.arrayBuffer()],
 * …)`. That reads the whole file into the CLI's heap. It is also the reason
 * this command exists at all - moving bytes through MCP means base64 inside a
 * JSON-RPC frame, which capped every attachment at 2 MB while the server's own
 * buckets allow ten and none.
 *
 * So the multipart message is composed here, as a stream, over
 * `FileSystemProvider.readFileStream`. Peak memory is one chunk.
 *
 * **The cost is real and worth naming**: the two byte endpoints are addressed
 * by PATH, so a renamed route answers an older CLI with a 404 rather than
 * failing typecheck. Every OTHER call here goes through `$client` and is
 * checked, which is why the hand-addressed surface is exactly two URLs.
 *
 * ## Two calls per push, same as the UI
 *
 * The bytes go to a bucket, then the file id is placed on the quest or in the
 * folio. Uploading is not placing: a file that is never registered is an
 * orphan blob, which is what the caller's own error path is for.
 */
export class AttachmentUploader {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly detector = $inject(FileDetector);
  protected readonly http = $inject(HttpClient);
  protected readonly client = $inject(LoreClientService);

  /**
   * ⚠️ Declared after `client`, and it has to be: a field initializer reading
   * another field sees `undefined` if that field is declared below it. Same
   * ordering constraint every `$client` in this package carries.
   */
  protected readonly quests = $client<QuestController>(this.client.scope());
  protected readonly folios = $client<FolioController>(this.client.scope());
  protected readonly folioAttachments = $client<FolioAttachmentController>(
    this.client.scope(),
  );

  /**
   * What a byte endpoint answers.
   *
   * Both of them return `fileId`, and `POST /api/quests/attachments` returns a
   * `url` beside it that nothing here reads. `.loose()`, so a Lore that starts
   * answering with more does not break a CLI that wants less.
   */
  protected static readonly UPLOADED = z.object({ fileId: z.uuid() }).loose();

  /**
   * Attach a file to a quest, addressed by its per-project shortId.
   *
   * The shortId is resolved to the global id first, because that is what
   * `addAttachment` takes - and resolving it before a byte is sent is what
   * makes a wrong number a fast refusal rather than an orphan blob.
   */
  public async pushToQuest(
    input: QuestAttachmentInput,
  ): Promise<AttachmentPushed> {
    const quest = await this.quests.getQuestByShortId({
      params: { projectId: input.projectId, shortId: input.questShortId },
    });

    const name = input.name ?? this.basename(input.filePath);
    const { fileId } = await this.uploadBytes(
      "/api/quests/attachments",
      input.filePath,
      name,
      input.type,
    );

    // `addAttachment` dedupes on the file id, so a retry cannot double up.
    await this.quests.addAttachment({
      params: { id: quest.id },
      body: { fileId },
    });

    const files = await this.quests.listQuestAttachments({
      params: { id: quest.id },
    });
    const stored = files.find((it) => it.fileId === fileId);

    return {
      // A quest attachment keeps the name it was uploaded under: there is no
      // per-quest uniqueness rule to suffix it against.
      name: stored?.name ?? name,
      mimeType: stored?.mimeType ?? this.mimeType(name, input.type),
      size: stored?.size,
      subject: `quest #Q${input.questShortId}`,
    };
  }

  /**
   * Attach a file to a folio, addressed by its per-project shortId.
   */
  public async pushToFolio(
    input: FolioAttachmentInput,
  ): Promise<AttachmentPushed> {
    const folio = await this.folios.getByShortId({
      params: { projectId: input.projectId, shortId: input.folioShortId },
    });

    // A protected folio's `content` is a client-side encryption envelope the
    // server cannot read, so it can neither hold the reference an attachment
    // needs nor have it repointed on a later rename - which is why the editor
    // hides its upload handler there. The CLI is not the way around that
    // either, and the refusal comes BEFORE any byte is sent.
    if (folio.protected) {
      throw new BadRequestError(
        `Folio #F${input.folioShortId} is protected: its content is encrypted client-side, so an attachment could never be referenced from it. Attach the file to an unprotected folio instead.`,
      );
    }

    const name = input.name ?? this.basename(input.filePath);
    const { fileId } = await this.uploadBytes(
      "/api/folio/attachments/upload",
      input.filePath,
      name,
      input.type,
    );

    const attachment = await this.folioAttachments.registerAttachment({
      params: { projectId: input.projectId },
      body: { fileId, name, folioId: folio.id },
    });

    return {
      // ⚠️ `register` renames on collision, so this is the STORED name and not
      // the requested one. It is what an `assets/` reference has to carry.
      name: attachment.name,
      mimeType: this.mimeType(name, input.type),
      path: `assets/${encodeURIComponent(attachment.name)}`,
      subject: `folio #F${input.folioShortId}`,
    };
  }

  /**
   * The file's own name, for when `--name` gives none.
   *
   * Split on both separators rather than through `node:path`: this package
   * reaches the filesystem only through `FileSystemProvider`, which has
   * `join` and `resolve` and no `basename`, and a direct `node:path` import
   * is a seam nothing can substitute.
   */
  protected basename(path: string): string {
    const segments = path.split(/[\\/]/);
    return segments.findLast(Boolean) ?? path;
  }

  /**
   * The media type this file travels as.
   *
   * `--type` wins, otherwise the extension decides through `FileDetector`,
   * which already answers `application/octet-stream` for anything it cannot
   * name. The value is stored and later handed straight back as the
   * download's `Content-Type`, so a media type carrying a separator or a
   * control character has no business reaching storage.
   */
  protected mimeType(name: string, override?: string): string {
    const type = override ?? this.detector.getContentType(name);
    if (!AttachmentUploader.MIME_TYPE.test(type)) {
      throw new AlephaError(
        `Invalid --type "${type}": that is not a media type. Send one shaped like "text/html" or "image/png".`,
      );
    }
    return type;
  }

  protected static readonly MIME_TYPE =
    /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

  /**
   * Stream the file to one of the two byte endpoints.
   */
  protected async uploadBytes(
    path: string,
    filePath: string,
    name: string,
    type: string | undefined,
  ): Promise<{ fileId: string }> {
    const mimeType = this.mimeType(name, type);
    const partName = this.field(name);

    // Random enough that it cannot occur inside the file's bytes by accident,
    // and long enough that it cannot be produced on purpose either. The parts
    // are never scanned for it here - that is the receiver's job - so a
    // collision would corrupt the message silently, which is the one failure
    // mode a boundary has.
    const boundary = `----alepha-attachment-${crypto.randomUUID()}`;
    const stream = await this.fs.readFileStream(filePath);

    const res = await this.http.fetch(`${this.client.hostname()}${path}`, {
      method: "POST",
      headers: {
        authorization: await this.client.authorization(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      // A stream body needs `duplex: "half"` on undici, and the DOM lib's
      // `RequestInit` has no such field - it is a fetch extension, not a spec
      // type. Without it node refuses the request outright.
      duplex: "half",
      body: this.body(boundary, partName, mimeType, stream),
      schema: { response: AttachmentUploader.UPLOADED },
    } as never);

    return res.data as { fileId: string };
  }

  /**
   * The multipart message, as a stream.
   *
   * A pull-driven `ReadableStream` over an async generator: the header block
   * is a few hundred bytes, the file part is forwarded chunk by chunk, and
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
    filename: string,
    mimeType: string,
    file: AsyncIterable<unknown>,
  ): ReadableStream<Uint8Array> {
    const chunks = this.chunks(boundary, filename, mimeType, file);
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
    filename: string,
    mimeType: string,
    file: AsyncIterable<unknown>,
  ): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();

    yield encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    );

    for await (const chunk of file) {
      yield chunk instanceof Uint8Array
        ? chunk
        : new Uint8Array(chunk as ArrayBufferLike);
    }

    yield encoder.encode(`\r\n--${boundary}--\r\n`);
  }

  /**
   * A filename on its way into a header, refused if it could not be one.
   *
   * ⚠️ This is a TRANSPORT check, not a copy of the server's rules. A quote or
   * a newline inside the `Content-Disposition` line ends the field or the
   * part, so a name containing one would compose a message that says something
   * other than what the caller asked - and would do it silently. What a name
   * may actually contain is Lore's to decide, and it answers 400 for the rest.
   */
  protected field(value: string): string {
    if (/["\r\n]/.test(value)) {
      throw new AlephaError(
        `Invalid attachment name "${value}": a quote or a line break cannot travel in a form field. Pass --name with something simpler.`,
      );
    }
    return value;
  }
}

export interface QuestAttachmentInput {
  projectId: number;
  /**
   * The quest's per-project shortId — the number in Lore's URLs and in
   * `quest_get`, never the internal id.
   */
  questShortId: number;
  filePath: string;
  /**
   * Overrides the on-disk filename.
   */
  name?: string;
  /**
   * Overrides the media type guessed from the extension.
   */
  type?: string;
}

export interface FolioAttachmentInput {
  projectId: number;
  /**
   * The folio's per-project shortId.
   */
  folioShortId: number;
  filePath: string;
  name?: string;
  type?: string;
}

export interface AttachmentPushed {
  /**
   * The name the server actually stored, which is not always the one that was
   * sent: a folio auto-suffixes a name already taken on it.
   */
  name: string;
  mimeType: string;
  size?: number;
  /**
   * The markdown reference, for a folio attachment only. A quest attachment is
   * listed on the quest rather than referenced from its body.
   */
  path?: string;
  /**
   * What it was attached to, in the typed reference grammar, for the log line.
   */
  subject: string;
}
