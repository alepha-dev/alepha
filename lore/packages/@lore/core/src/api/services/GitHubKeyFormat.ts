import { AlephaError } from "alepha";

/**
 * Converts the private key GitHub hands over into the one format WebCrypto
 * imports (#Q4360, #Q4363).
 *
 * GitHub gives an App's private key as PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`),
 * and `crypto.subtle.importKey` takes PKCS#8 only (`BEGIN PRIVATE KEY`), on
 * Node and workerd alike. PKCS#8 is the PKCS#1 key wrapped in one more
 * structure that names its algorithm, so the conversion is a few bytes of
 * DER around the original, with no dependency and no `node:crypto`:
 *
 * ```
 * SEQUENCE {
 *   INTEGER 0
 *   SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
 *   OCTET STRING { <the PKCS#1 key> }
 * }
 * ```
 *
 * The key is converted once, when it is stored or read from the
 * environment, so the signer imports PKCS#8 and nothing else.
 */
export class GitHubKeyFormat {
  /**
   * `AlgorithmIdentifier { rsaEncryption, NULL }`, as DER.
   */
  protected static readonly RSA_ALGORITHM = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];

  /**
   * The key as PKCS#8 PEM, whether it came as PKCS#1 or PKCS#8.
   *
   * Tolerates what an environment variable does to a PEM: literal `\n`
   * escapes, surrounding quotes or whitespace. Throws on anything else, and
   * the message never quotes the key.
   */
  toPkcs8Pem(input: string): string {
    const pem = this.normalize(input);
    const block = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(
      pem,
    );
    if (!block) {
      throw new AlephaError(
        "The GitHub App private key is not a PEM block (BEGIN RSA PRIVATE KEY or BEGIN PRIVATE KEY)",
      );
    }
    const label = block[1];
    const der = this.fromBase64(block[2].replace(/\s+/g, ""));
    if (label === "PRIVATE KEY") {
      return this.pem("PRIVATE KEY", der);
    }
    if (label === "RSA PRIVATE KEY") {
      return this.pem("PRIVATE KEY", this.wrapPkcs1(der));
    }
    throw new AlephaError(
      `The GitHub App private key is a ${label}, not an RSA private key`,
    );
  }

  /**
   * The DER bytes of a PKCS#8 PEM, for `importKey("pkcs8", ...)`.
   */
  pkcs8Der(pem: string): Uint8Array<ArrayBuffer> {
    const block =
      /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(
        pem,
      );
    if (!block) {
      throw new AlephaError("The GitHub App private key is not PKCS#8");
    }
    return this.fromBase64(block[1].replace(/\s+/g, ""));
  }

  protected normalize(input: string): string {
    return input
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n");
  }

  protected wrapPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
    const version = [0x02, 0x01, 0x00];
    const octets = [0x04, ...this.length(pkcs1.length)];
    const bodyLength =
      version.length +
      GitHubKeyFormat.RSA_ALGORITHM.length +
      octets.length +
      pkcs1.length;
    const header = [0x30, ...this.length(bodyLength)];
    const out = new Uint8Array(header.length + bodyLength);
    let offset = 0;
    for (const part of [
      header,
      version,
      GitHubKeyFormat.RSA_ALGORITHM,
      octets,
    ]) {
      out.set(part, offset);
      offset += part.length;
    }
    out.set(pkcs1, offset);
    return out;
  }

  /**
   * A DER length: short form under 128, else `0x80 | n` then n bytes.
   */
  protected length(n: number): number[] {
    if (n < 0x80) return [n];
    const bytes: number[] = [];
    let rest = n;
    while (rest > 0) {
      bytes.unshift(rest & 0xff);
      rest = Math.floor(rest / 256);
    }
    return [0x80 | bytes.length, ...bytes];
  }

  protected pem(label: string, der: Uint8Array): string {
    const base64 = this.toBase64(der);
    const lines = base64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
  }

  protected fromBase64(base64: string): Uint8Array<ArrayBuffer> {
    let binary: string;
    try {
      binary = atob(base64);
    } catch {
      throw new AlephaError("The GitHub App private key is not valid base64");
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  protected toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
}
