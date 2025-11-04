import { Readable } from "node:stream";
import { getContentType } from "./getContentType.js";

/**
 * Magic byte signatures for common file formats.
 * Each signature is represented as an array of bytes or null (wildcard).
 */
const MAGIC_BYTES: Record<
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
    { signature: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], mimeType: "image/gif" }, // GIF87a
    { signature: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], mimeType: "image/gif" }, // GIF89a
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
    { signature: [0x25, 0x50, 0x44, 0x46, 0x2d], mimeType: "application/pdf" },
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
  mkv: [{ signature: [0x1a, 0x45, 0xdf, 0xa3], mimeType: "video/x-matroska" }],

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
const ALL_SIGNATURES = Object.entries(MAGIC_BYTES).flatMap(
  ([ext, signatures]) => signatures.map((sig) => ({ ext, ...sig })),
);

/**
 * Reads all bytes from a stream and returns the first N bytes along with a new stream containing all data.
 * This approach reads the entire stream upfront to avoid complex async handling issues.
 */
async function peekBytes(
  stream: Readable,
  numBytes: number,
): Promise<{ buffer: Buffer; stream: Readable }> {
  const chunks: Buffer[] = [];

  // Read the entire stream
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const allData = Buffer.concat(chunks);
  const buffer = allData.subarray(0, numBytes);

  // Create a new stream with all the data
  const newStream = Readable.from(allData);

  return { buffer, stream: newStream };
}

/**
 * Checks if a buffer matches a magic byte signature.
 */
function matchesSignature(
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
 * Detects the file type by checking magic bytes against the stream content.
 *
 * @param stream - The readable stream to check
 * @param filename - The filename (used to get the extension)
 * @returns File type information including MIME type, extension, and verification status
 *
 * @example
 * ```typescript
 * const stream = fs.createReadStream('image.png');
 * const result = await detectFileType(stream, 'image.png');
 * console.log(result.mimeType); // 'image/png'
 * console.log(result.verified); // true if magic bytes match
 * ```
 */
export async function detectFileType(
  stream: Readable,
  filename: string,
): Promise<FileTypeResult> {
  // Get the expected MIME type from the filename extension
  const expectedMimeType = getContentType(filename);

  // Extract extension - only if filename contains a dot
  const lastDotIndex = filename.lastIndexOf(".");
  const ext =
    lastDotIndex > 0 ? filename.substring(lastDotIndex + 1).toLowerCase() : "";

  // Read the first 16 bytes (enough for most magic byte checks)
  const { buffer, stream: newStream } = await peekBytes(stream, 16);

  // First, check if the extension's expected signature matches
  const expectedSignatures = MAGIC_BYTES[ext];
  if (expectedSignatures) {
    for (const { signature, mimeType } of expectedSignatures) {
      if (matchesSignature(buffer, signature)) {
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
  for (const { ext: detectedExt, signature, mimeType } of ALL_SIGNATURES) {
    if (detectedExt !== ext && matchesSignature(buffer, signature)) {
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
