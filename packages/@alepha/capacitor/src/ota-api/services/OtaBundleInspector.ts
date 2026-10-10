import { AlephaError } from "alepha";

/**
 * Opens and inspects an uploaded bundle with the app's public key, on the
 * server: the release manifest is only metadata, so what it says about the
 * bundle is checked against the bundle itself before it is published.
 *
 * Capgo v2 encrypts the AES session key and the checksum with the
 * publisher's private key, so the public key undoes both: anyone holding it
 * (every installed app) can decrypt a bundle, which makes the encryption an
 * integrity and origin check rather than a secret. The server uses exactly
 * that to verify, in this order:
 *
 * 1. the session key and the checksum decrypt under the app's public key
 *    (a bundle sealed with another key is refused here);
 * 2. the ciphertext decrypts, and the plain ZIP's SHA-256 equals the
 *    decrypted checksum (a modified file or checksum is refused here);
 * 3. the ZIP itself: `index.html` at its root, no absolute or `..` path, no
 *    symlink, no encrypted or unknown entry, no ZIP64, within the file count
 *    and expanded size limits, every entry inflating to exactly its declared
 *    size and CRC (a ZIP bomb is refused here, before any device unpacks it).
 *
 * Web Crypto, `DecompressionStream` and `BigInt` only, so it runs on Node,
 * Bun and workerd alike: `node:crypto`'s raw RSA calls are not available on
 * every runtime the API is deployed to.
 */
export class OtaBundleInspector {
  protected static readonly CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  /**
   * Decrypt a bundle and check it against its checksum. Resolves with the
   * plain ZIP.
   */
  public async open(input: {
    ciphertext: Uint8Array;
    sessionKey: string;
    checksum: string;
    publicKey: string;
  }): Promise<{ archive: Uint8Array; archiveSha256: string }> {
    const [ivPart, keyPart, ...rest] = input.sessionKey.split(":");
    if (!ivPart || !keyPart || rest.length > 0) {
      throw new OtaBundleError("The session key is not '<iv>:<key>'.");
    }
    const iv = this.fromBase64(ivPart);
    if (iv.length !== 16) {
      throw new OtaBundleError("The session key's IV is not 16 bytes.");
    }
    const key = this.rsaPublicDecrypt(
      input.publicKey,
      this.fromBase64(keyPart),
    );
    if (key.length !== 16) {
      throw new OtaBundleError(
        "The session key does not decrypt under this app's public key.",
      );
    }
    if (!/^[0-9a-f]+$/i.test(input.checksum)) {
      throw new OtaBundleError("The checksum is not hex.");
    }
    const expected = this.toHex(
      this.rsaPublicDecrypt(input.publicKey, this.fromHex(input.checksum)),
    );

    let archive: Uint8Array;
    try {
      const aes = await crypto.subtle.importKey(
        "raw",
        this.buffer(key),
        { name: "AES-CBC" },
        false,
        ["decrypt"],
      );
      archive = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-CBC", iv: this.buffer(iv) },
          aes,
          this.buffer(input.ciphertext),
        ),
      );
    } catch {
      throw new OtaBundleError("The bundle does not decrypt.");
    }

    const archiveSha256 = await this.sha256(archive);
    if (archiveSha256 !== expected) {
      throw new OtaBundleError(
        "The bundle does not match its checksum: it, or the checksum, was modified.",
      );
    }
    return { archive, archiveSha256 };
  }

  /**
   * Check a plain ZIP is a web layer a device can safely unpack.
   */
  public async inspect(
    archive: Uint8Array,
    limits: { maxFiles: number; maxExpandedSize: number },
  ): Promise<{ files: number; expandedSize: number }> {
    const view = new DataView(
      archive.buffer,
      archive.byteOffset,
      archive.byteLength,
    );
    const end = this.findEnd(view);
    const entries = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (
      view.getUint16(end + 4, true) !== 0 ||
      view.getUint16(end + 6, true) !== 0 ||
      entries === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new OtaBundleError("Multi-disk and ZIP64 archives are refused.");
    }
    if (directoryOffset + directorySize > end) {
      throw new OtaBundleError("The ZIP's central directory is out of bounds.");
    }

    const names = new Set<string>();
    let files = 0;
    let expandedSize = 0;
    let cursor = directoryOffset;
    const decoder = new TextDecoder("utf-8", { fatal: true });

    for (let index = 0; index < entries; index++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) {
        throw new OtaBundleError("The ZIP's central directory is corrupt.");
      }
      const madeBy = view.getUint16(cursor + 4, true);
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const attributes = view.getUint32(cursor + 38, true);
      const localOffset = view.getUint32(cursor + 42, true);
      let name: string;
      try {
        name = decoder.decode(
          archive.subarray(cursor + 46, cursor + 46 + nameLength),
        );
      } catch {
        throw new OtaBundleError("A ZIP entry name is not UTF-8.");
      }
      cursor += 46 + nameLength + extraLength + commentLength;

      if (flags & 0x1) {
        throw new OtaBundleError(`'${name}' is an encrypted ZIP entry.`);
      }
      if (method !== 0 && method !== 8) {
        throw new OtaBundleError(
          `'${name}' uses compression method ${method}; only stored and deflate are accepted.`,
        );
      }
      if (madeBy >> 8 === 3 && ((attributes >>> 16) & 0o170000) === 0o120000) {
        throw new OtaBundleError(`'${name}' is a symlink.`);
      }
      const directory = name.endsWith("/");
      const path = directory ? name.slice(0, -1) : name;
      if (
        path === "" ||
        path.startsWith("/") ||
        /^[A-Za-z]:/.test(path) ||
        path.includes("\\") ||
        path.includes("\0") ||
        path
          .split("/")
          .some((part) => part === "" || part === "." || part === "..")
      ) {
        throw new OtaBundleError(`'${name}' escapes the bundle.`);
      }
      if (names.has(path)) {
        throw new OtaBundleError(`'${name}' appears twice.`);
      }
      names.add(path);
      if (directory) {
        continue;
      }

      files++;
      expandedSize += size;
      if (files > limits.maxFiles) {
        throw new OtaBundleError(
          `The bundle holds more than ${limits.maxFiles} files.`,
        );
      }
      if (expandedSize > limits.maxExpandedSize) {
        throw new OtaBundleError(
          `The bundle expands past ${limits.maxExpandedSize} bytes.`,
        );
      }

      if (
        localOffset + 30 > directoryOffset ||
        view.getUint32(localOffset, true) !== 0x04034b50
      ) {
        throw new OtaBundleError(`'${name}' has no local header.`);
      }
      // The device unpacks by the local header: it must agree.
      if (view.getUint16(localOffset + 8, true) !== method) {
        throw new OtaBundleError(`'${name}' declares two compression methods.`);
      }
      const dataStart =
        localOffset +
        30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true);
      if (dataStart + compressedSize > directoryOffset) {
        throw new OtaBundleError(`'${name}' is out of bounds.`);
      }
      const data = archive.subarray(dataStart, dataStart + compressedSize);
      await this.verifyEntry(name, method, data, size, crc);
    }

    if (!names.has("index.html")) {
      throw new OtaBundleError("The bundle has no index.html at its root.");
    }
    return { files, expandedSize };
  }

  /**
   * The plugin's key identity: the first 20 characters of the PKCS#1 public
   * key's base64 body.
   */
  public keyId(publicKey: string): string {
    return publicKey
      .replace(/-----(BEGIN|END) RSA PUBLIC KEY-----/g, "")
      .replace(/\s/g, "")
      .slice(0, 20);
  }

  /**
   * Whether a PEM is an RSA public key in PKCS#1, the form the plugin reads.
   */
  public isPublicKey(publicKey: string): boolean {
    try {
      this.parsePublicKey(publicKey);
      return true;
    } catch {
      return false;
    }
  }

  public async sha256(data: Uint8Array): Promise<string> {
    return this.toHex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", this.buffer(data))),
    );
  }

  /**
   * Inflate one entry with a hard cap at its declared size, and check its
   * CRC.
   */
  protected async verifyEntry(
    name: string,
    method: number,
    data: Uint8Array,
    size: number,
    crc: number,
  ): Promise<void> {
    let crcValue = 0xffffffff;
    let produced = 0;
    const feed = (chunk: Uint8Array) => {
      produced += chunk.length;
      if (produced > size) {
        throw new OtaBundleError(`'${name}' expands past its declared size.`);
      }
      for (const byte of chunk) {
        crcValue =
          OtaBundleInspector.CRC_TABLE[(crcValue ^ byte) & 0xff] ^
          (crcValue >>> 8);
      }
    };

    if (method === 0) {
      feed(data);
    } else {
      const stream = new Blob([this.buffer(data)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          feed(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof OtaBundleError) {
          throw error;
        }
        throw new OtaBundleError(`'${name}' does not inflate.`);
      }
    }

    if (produced !== size || (crcValue ^ 0xffffffff) >>> 0 !== crc) {
      throw new OtaBundleError(`'${name}' does not match its size or CRC.`);
    }
  }

  protected findEnd(view: DataView): number {
    const last = view.byteLength - 22;
    const first = Math.max(0, last - 0xffff);
    for (let offset = last; offset >= first; offset--) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        return offset;
      }
    }
    throw new OtaBundleError("The bundle is not a ZIP.");
  }

  /**
   * RSA with the public exponent, then PKCS#1 v1.5 type 1 unpadding: the
   * inverse of the publisher's `privateEncrypt`.
   */
  protected rsaPublicDecrypt(publicKey: string, data: Uint8Array): Uint8Array {
    const { n, e, length } = this.parsePublicKey(publicKey);
    if (data.length !== length) {
      throw new OtaBundleError(
        "A value encrypted for this bundle does not fit this app's public key.",
      );
    }
    const c = this.toBigInt(data);
    if (c >= n) {
      throw new OtaBundleError("A value encrypted for this bundle is invalid.");
    }
    const m = this.modPow(c, e, n);
    const block = this.fromBigInt(m, length);
    if (block[0] !== 0x00 || block[1] !== 0x01) {
      throw new OtaBundleError(
        "A value in this bundle was not encrypted with this app's key.",
      );
    }
    let index = 2;
    while (index < block.length && block[index] === 0xff) {
      index++;
    }
    if (index < 10 || block[index] !== 0x00) {
      throw new OtaBundleError(
        "A value in this bundle was not encrypted with this app's key.",
      );
    }
    return block.slice(index + 1);
  }

  /**
   * `RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }`.
   */
  protected parsePublicKey(pem: string): {
    n: bigint;
    e: bigint;
    length: number;
  } {
    if (!pem.includes("-----BEGIN RSA PUBLIC KEY-----")) {
      throw new OtaBundleError(
        "The app's public key is not a PKCS#1 RSA public key.",
      );
    }
    const der = this.fromBase64(
      pem
        .replace(/-----(BEGIN|END) RSA PUBLIC KEY-----/g, "")
        .replace(/\s/g, ""),
    );
    let offset = 0;
    // Reads a tag and its length, leaving `offset` on the content.
    const header = (tag: number): number => {
      if (der[offset] !== tag) {
        throw new OtaBundleError("The app's public key is malformed.");
      }
      offset++;
      let length = der[offset++];
      if (length & 0x80) {
        const bytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < bytes; i++) {
          length = (length << 8) | der[offset++];
        }
      }
      if (offset + length > der.length) {
        throw new OtaBundleError("The app's public key is malformed.");
      }
      return length;
    };
    const integer = (): bigint => {
      const length = header(0x02);
      const value = der.subarray(offset, offset + length);
      offset += length;
      return this.toBigInt(value);
    };
    header(0x30);
    const n = integer();
    const e = integer();
    const length = Math.ceil(n.toString(16).length / 2);
    if (length < 128) {
      throw new OtaBundleError("The app's public key is too short.");
    }
    return { n, e, length };
  }

  protected modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    let b = base % modulus;
    let e = exponent;
    while (e > 0n) {
      if (e & 1n) {
        result = (result * b) % modulus;
      }
      e >>= 1n;
      b = (b * b) % modulus;
    }
    return result;
  }

  protected toBigInt(bytes: Uint8Array): bigint {
    return bytes.length === 0 ? 0n : BigInt(`0x${this.toHex(bytes)}`);
  }

  protected fromBigInt(value: bigint, length: number): Uint8Array {
    const hex = value.toString(16).padStart(length * 2, "0");
    return this.fromHex(hex);
  }

  protected toHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  }

  protected fromHex(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
      throw new OtaBundleError("A hex value has an odd length.");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  protected fromBase64(value: string): Uint8Array {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      throw new OtaBundleError("A base64 value is malformed.");
    }
  }

  /**
   * A copy as a plain `ArrayBuffer`, what Web Crypto and `Blob` accept on
   * every runtime.
   */
  protected buffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.slice().buffer as ArrayBuffer;
  }
}

/**
 * A bundle refused by {@link OtaBundleInspector}: the message says what was
 * wrong with it, and never echoes a key.
 */
export class OtaBundleError extends AlephaError {
  public override readonly name = "OtaBundleError";
}
