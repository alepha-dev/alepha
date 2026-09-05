import { BadRequestError } from "alepha/server";

/**
 * Turns one base64 MCP payload into the `File` the storage layer takes.
 *
 * The inverse of `AttachmentContentService`, and shared by
 * `quest_attachment_add` and `folio_attachment_add` for the same reason the
 * render side is shared: the two surfaces have to agree on what an agent may
 * upload, and a second copy is how one of them quietly starts accepting a
 * payload the other refuses.
 */
export class AttachmentUploadService {
  /**
   * What a `mimeType` has to look like.
   *
   * There is no type allowlist here. It used to be the eight types
   * `quest_attachment_get` renders back inline, so that an agent could
   * always read what an agent wrote; what it actually did was refuse the
   * files a quest is worked from, an HTML mockup being the case that
   * retired it. Read-back is a property of the type, not a reason to reject
   * the upload: an agent that attaches a zip knows it is attaching a zip,
   * and the human on the other end is the one who opens it.
   *
   * The shape check is not decoration. This value is stored and later
   * handed straight back as the download's `Content-Type`, so a media type
   * carrying a separator or a control character has no business reaching
   * storage.
   */
  protected readonly mimeTypePattern =
    /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

  /**
   * 2 MB decoded. The type is open, the size is not: base64 through a
   * JSON-RPC frame is the wrong way to move anything larger.
   */
  public readonly maxBytes = 2 * 1024 * 1024;

  /**
   * Validate an agent's upload and hand back the file to store.
   *
   * `subject` names what the file is being attached to, so the refusal tells
   * the caller where to link the thing it could not upload.
   *
   * The bytes are re-wrapped as a `Uint8Array` view: a bare `Buffer` is
   * `ArrayBufferLike` and does not satisfy `BlobPart`.
   */
  public toFile(
    input: { name: string; mimeType: string; data: string },
    subject: "quest" | "folio",
  ): File {
    if (!this.mimeTypePattern.test(input.mimeType)) {
      throw new BadRequestError(
        `mimeType "${input.mimeType}" is not a media type. Send one shaped like "text/html" or "image/png".`,
      );
    }

    const bytes = this.decodeBase64(input.data);
    if (bytes.byteLength > this.maxBytes) {
      throw new BadRequestError(
        `Attachment is ${bytes.byteLength} bytes decoded, over the ${this.maxBytes} byte limit. Put anything larger somewhere it belongs and link to it from the ${subject}.`,
      );
    }

    return new File([new Uint8Array(bytes)], input.name, {
      type: input.mimeType,
    });
  }

  /**
   * Decode a base64 payload, refusing anything that is not actually base64.
   *
   * `Buffer.from(x, "base64")` never throws: it silently drops characters
   * it does not recognise, so a truncated or corrupted payload would be
   * stored as a shorter, broken file. Validating the alphabet first is what
   * turns that into an error the caller can act on.
   */
  protected decodeBase64(data: string): Buffer {
    const compact = data.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
      throw new BadRequestError(
        "`data` is not valid base64. Send the raw base64 of the file's bytes, with no data-URL prefix.",
      );
    }
    return Buffer.from(compact, "base64");
  }
}
