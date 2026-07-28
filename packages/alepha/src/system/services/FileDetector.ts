import { Readable } from "node:stream";

export interface FileTypeResult {
  /**
   * The detected MIME type
   */
  mimeType: string;
  /**
   * The detected file extension
   */
  extension: string;
  /**
   * Whether the file type was verified by magic bytes
   */
  verified: boolean;
  /**
   * The stream (potentially wrapped to allow re-reading)
   */
  stream: Readable;
}

/**
 * Service for detecting file types and getting content types.
 *
 * @example
 * ```typescript
 * const detector = alepha.inject(FileDetector);
 *
 * // Get content type from filename
 * const mimeType = detector.getContentType("image.png"); // "image/png"
 *
 * // Detect file type by magic bytes
 * const stream = createReadStream('image.png');
 * const result = await detector.detectFileType(stream, 'image.png');
 * console.log(result.mimeType); // 'image/png'
 * console.log(result.verified); // true if magic bytes match
 * ```
 */
export class FileDetector {
  /**
   * Magic byte signatures for common file formats.
   * Each signature is represented as an array of bytes or null (wildcard).
   */
  protected static readonly MAGIC_BYTES: Record<
    string,
    { signature: (number | null)[]; mimeType: string }[]
  > = {
    // Images
    png: [
      {
        signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        mimeType: "image/png",
      },
    ],
    jpg: [
      { signature: [0xff, 0xd8, 0xff, 0xe0], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe1], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe2], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe3], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe8], mimeType: "image/jpeg" },
    ],
    jpeg: [
      { signature: [0xff, 0xd8, 0xff, 0xe0], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe1], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe2], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe3], mimeType: "image/jpeg" },
      { signature: [0xff, 0xd8, 0xff, 0xe8], mimeType: "image/jpeg" },
    ],
    gif: [
      {
        signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
        mimeType: "image/gif",
      }, // GIF87a
      {
        signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
        mimeType: "image/gif",
      }, // GIF89a
    ],
    webp: [
      {
        signature: [
          0x52,
          0x49,
          0x46,
          0x46,
          null,
          null,
          null,
          null,
          0x57,
          0x45,
          0x42,
          0x50,
        ],
        mimeType: "image/webp",
      },
    ],
    bmp: [{ signature: [0x42, 0x4d], mimeType: "image/bmp" }],
    ico: [{ signature: [0x00, 0x00, 0x01, 0x00], mimeType: "image/x-icon" }],
    tiff: [
      { signature: [0x49, 0x49, 0x2a, 0x00], mimeType: "image/tiff" }, // Little-endian
      { signature: [0x4d, 0x4d, 0x00, 0x2a], mimeType: "image/tiff" }, // Big-endian
    ],
    tif: [
      { signature: [0x49, 0x49, 0x2a, 0x00], mimeType: "image/tiff" },
      { signature: [0x4d, 0x4d, 0x00, 0x2a], mimeType: "image/tiff" },
    ],

    // Documents
    pdf: [
      {
        signature: [0x25, 0x50, 0x44, 0x46, 0x2d],
        mimeType: "application/pdf",
      },
    ], // %PDF-
    zip: [
      { signature: [0x50, 0x4b, 0x03, 0x04], mimeType: "application/zip" },
      { signature: [0x50, 0x4b, 0x05, 0x06], mimeType: "application/zip" },
      { signature: [0x50, 0x4b, 0x07, 0x08], mimeType: "application/zip" },
    ],

    // Archives
    rar: [
      {
        signature: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
        mimeType: "application/vnd.rar",
      },
    ],
    "7z": [
      {
        signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
        mimeType: "application/x-7z-compressed",
      },
    ],
    tar: [
      {
        signature: [0x75, 0x73, 0x74, 0x61, 0x72],
        mimeType: "application/x-tar",
      },
    ],
    gz: [{ signature: [0x1f, 0x8b], mimeType: "application/gzip" }],
    tgz: [{ signature: [0x1f, 0x8b], mimeType: "application/gzip" }],

    // Audio
    mp3: [
      { signature: [0xff, 0xfb], mimeType: "audio/mpeg" },
      { signature: [0xff, 0xf3], mimeType: "audio/mpeg" },
      { signature: [0xff, 0xf2], mimeType: "audio/mpeg" },
      { signature: [0x49, 0x44, 0x33], mimeType: "audio/mpeg" }, // ID3
    ],
    wav: [
      {
        signature: [
          0x52,
          0x49,
          0x46,
          0x46,
          null,
          null,
          null,
          null,
          0x57,
          0x41,
          0x56,
          0x45,
        ],
        mimeType: "audio/wav",
      },
    ],
    ogg: [{ signature: [0x4f, 0x67, 0x67, 0x53], mimeType: "audio/ogg" }],
    flac: [{ signature: [0x66, 0x4c, 0x61, 0x43], mimeType: "audio/flac" }], // fLaC

    // Video
    mp4: [
      {
        signature: [null, null, null, null, 0x66, 0x74, 0x79, 0x70],
        mimeType: "video/mp4",
      }, // ftyp
      {
        signature: [
          null,
          null,
          null,
          null,
          0x66,
          0x74,
          0x79,
          0x70,
          0x69,
          0x73,
          0x6f,
          0x6d,
        ],
        mimeType: "video/mp4",
      }, // ftypisom
      {
        signature: [
          null,
          null,
          null,
          null,
          0x66,
          0x74,
          0x79,
          0x70,
          0x6d,
          0x70,
          0x34,
          0x32,
        ],
        mimeType: "video/mp4",
      }, // ftypmp42
    ],
    webm: [{ signature: [0x1a, 0x45, 0xdf, 0xa3], mimeType: "video/webm" }],
    avi: [
      {
        signature: [
          0x52,
          0x49,
          0x46,
          0x46,
          null,
          null,
          null,
          null,
          0x41,
          0x56,
          0x49,
          0x20,
        ],
        mimeType: "video/x-msvideo",
      },
    ],
    mov: [
      {
        signature: [
          null,
          null,
          null,
          null,
          0x66,
          0x74,
          0x79,
          0x70,
          0x71,
          0x74,
          0x20,
          0x20,
        ],
        mimeType: "video/quicktime",
      },
    ],
    mkv: [
      { signature: [0x1a, 0x45, 0xdf, 0xa3], mimeType: "video/x-matroska" },
    ],

    // Office (DOCX, XLSX, PPTX are all ZIP-based)
    docx: [
      {
        signature: [0x50, 0x4b, 0x03, 0x04],
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ],
    xlsx: [
      {
        signature: [0x50, 0x4b, 0x03, 0x04],
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
    pptx: [
      {
        signature: [0x50, 0x4b, 0x03, 0x04],
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
    ],
    doc: [
      {
        signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        mimeType: "application/msword",
      },
    ],
    xls: [
      {
        signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        mimeType: "application/vnd.ms-excel",
      },
    ],
    ppt: [
      {
        signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
        mimeType: "application/vnd.ms-powerpoint",
      },
    ],
  };

  /**
   * All possible format signatures for checking against actual file content
   */
  protected static readonly ALL_SIGNATURES = Object.entries(
    FileDetector.MAGIC_BYTES,
  ).flatMap(([ext, signatures]) => signatures.map((sig) => ({ ext, ...sig })));

  /**
   * MIME type map for file extensions.
   *
   * Can be used to get the content type of file based on its extension.
   * Feel free to add more mime types in your project!
   */
  public static readonly mimeMap: Record<string, string> = {
    // Documents
    json: "application/json",
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    xml: "application/xml",
    csv: "text/csv",
    pdf: "application/pdf",
    md: "text/markdown",
    markdown: "text/markdown",
    rtf: "application/rtf",

    // Styles and scripts
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    ts: "application/typescript",
    jsx: "text/jsx",
    tsx: "text/tsx",

    // Archives
    zip: "application/zip",
    rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
    tgz: "application/gzip",

    // Images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tiff: "image/tiff",
    tif: "image/tiff",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",

    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    mkv: "video/x-matroska",

    // Office
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",

    // Fonts
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
  };

  /**
   * Reverse MIME type map for looking up extensions from MIME types.
   * Prefers shorter, more common extensions when multiple exist.
   */
  protected static readonly reverseMimeMap: Record<string, string> = (() => {
    const reverse: Record<string, string> = {};
    // Process in order so common extensions come first
    for (const [ext, mimeType] of Object.entries(FileDetector.mimeMap)) {
      // Only set if not already set (prefer first/shorter extension)
      if (!reverse[mimeType]) {
        reverse[mimeType] = ext;
      }
    }
    return reverse;
  })();

  /**
   * Returns the file extension for a given MIME type.
   *
   * @param mimeType - The MIME type to look up
   * @returns The file extension (without dot), or "bin" if not found
   *
   * @example
   * ```typescript
   * const detector = alepha.inject(FileDetector);
   * const ext = detector.getExtensionFromMimeType("image/png"); // "png"
   * const ext2 = detector.getExtensionFromMimeType("application/octet-stream"); // "bin"
   * ```
   */
  getExtensionFromMimeType(mimeType: string): string {
    return FileDetector.reverseMimeMap[mimeType] || "bin";
  }
  /**
   * Returns the content type of file based on its filename.
   *
   * @param filename - The filename to check
   * @returns The MIME type
   *
   * @example
   * ```typescript
   * const detector = alepha.inject(FileDetector);
   * const mimeType = detector.getContentType("image.png"); // "image/png"
   * ```
   */
  getContentType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop() || "";
    return FileDetector.mimeMap[ext] || "application/octet-stream";
  }

  /**
   * Detects the file type by checking magic bytes against the stream content.
   *
   * @param stream - The readable stream to check
   * @param filename - The filename (used to get the extension)
   * @returns File type information including MIME type, extension, and verification status
   *
   * @example
   * ```typescript
   * const detector = alepha.inject(FileDetector);
   * const stream = createReadStream('image.png');
   * const result = await detector.detectFileType(stream, 'image.png');
   * console.log(result.mimeType); // 'image/png'
   * console.log(result.verified); // true if magic bytes match
   * ```
   */
  async detectFileType(
    stream: Readable,
    filename: string,
  ): Promise<FileTypeResult> {
    // Get the expected MIME type from the filename extension
    const expectedMimeType = this.getContentType(filename);

    // Extract extension - only if filename contains a dot
    const lastDotIndex = filename.lastIndexOf(".");
    const ext =
      lastDotIndex > 0
        ? filename.substring(lastDotIndex + 1).toLowerCase()
        : "";

    // Read the first 16 bytes (enough for most magic byte checks)
    const { buffer, stream: newStream } = await this.peekBytes(stream, 16);

    // First, check if the extension's expected signature matches
    const expectedSignatures = FileDetector.MAGIC_BYTES[ext];
    if (expectedSignatures) {
      for (const { signature, mimeType } of expectedSignatures) {
        if (this.matchesSignature(buffer, signature)) {
          return {
            mimeType,
            extension: ext,
            verified: true,
            stream: newStream,
          };
        }
      }
    }

    // If the expected signature didn't match, try all other signatures
    for (const {
      ext: detectedExt,
      signature,
      mimeType,
    } of FileDetector.ALL_SIGNATURES) {
      if (detectedExt !== ext && this.matchesSignature(buffer, signature)) {
        return {
          mimeType,
          extension: detectedExt,
          verified: true,
          stream: newStream,
        };
      }
    }

    // If no magic bytes matched, fall back to extension-based detection
    // or return binary if extension is not recognized
    return {
      mimeType: expectedMimeType,
      extension: ext,
      verified: false,
      stream: newStream,
    };
  }

  /**
   * Read the first `numBytes` of a stream, and return a stream that still
   * yields the complete payload.
   *
   * Only enough chunks to satisfy the peek are pulled; the rest of the source
   * is re-attached lazily behind the bytes already consumed. This used to
   * buffer the ENTIRE stream before looking at 16 magic bytes, so detecting the
   * type of a multi-GB upload materialised the whole file in memory.
   *
   * @protected
   */
  protected async peekBytes(
    stream: Readable,
    numBytes: number,
  ): Promise<{ buffer: Buffer; stream: Readable }> {
    const chunks: Buffer[] = [];
    let size = 0;

    const iterator = stream[Symbol.asyncIterator]();
    while (size < numBytes) {
      const { value, done } = await iterator.next();
      if (done) {
        break;
      }
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      chunks.push(chunk);
      size += chunk.length;
    }

    const head = Buffer.concat(chunks);
    const buffer = head.subarray(0, numBytes);

    // Replay what we consumed, then drain whatever is left of the source. The
    // iterator is resumed rather than the stream re-read, so no byte is lost
    // and none is read twice.
    const newStream = Readable.from(
      (async function* () {
        if (head.length > 0) {
          yield head;
        }
        while (true) {
          const { value, done } = await iterator.next();
          if (done) {
            return;
          }
          yield value;
        }
      })(),
    );

    return { buffer, stream: newStream };
  }

  /**
   * Checks if a buffer matches a magic byte signature.
   *
   * @protected
   */
  protected matchesSignature(
    buffer: Buffer,
    signature: (number | null)[],
  ): boolean {
    if (buffer.length < signature.length) {
      return false;
    }

    for (let i = 0; i < signature.length; i++) {
      if (signature[i] !== null && buffer[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }
}
