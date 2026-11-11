import { AlephaError } from "alepha";

/**
 * A value {@link CborEncoder} writes. A `Map` keeps its insertion order,
 * which is how a COSE key is written: `kty` first.
 */
export type CborInput =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | CborInput[]
  | Map<number | string, CborInput>;

/**
 * Encodes the CBOR subset WebAuthn uses, the mirror of `CborDecoder` in
 * `alepha/security`: integers, byte and text strings, arrays, maps and the
 * simple values, always with definite, shortest lengths.
 *
 * Test-side only. Production code decodes and never encodes, so this lives
 * with the software authenticator that needs it.
 */
export class CborEncoder {
  public encode(value: CborInput): Uint8Array {
    const chunks: number[] = [];
    this.write(value, chunks);
    return new Uint8Array(chunks);
  }

  protected write(value: CborInput, out: number[]): void {
    if (value === false) {
      out.push(0xf4);
    } else if (value === true) {
      out.push(0xf5);
    } else if (value === null) {
      out.push(0xf6);
    } else if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new AlephaError("CborEncoder writes integers only");
      }
      if (value >= 0) {
        this.head(0, value, out);
      } else {
        this.head(1, -1 - value, out);
      }
    } else if (typeof value === "string") {
      const bytes = new TextEncoder().encode(value);
      this.head(3, bytes.length, out);
      for (const b of bytes) out.push(b);
    } else if (value instanceof Uint8Array) {
      this.head(2, value.length, out);
      for (const b of value) out.push(b);
    } else if (Array.isArray(value)) {
      this.head(4, value.length, out);
      for (const item of value) this.write(item, out);
    } else {
      this.head(5, value.size, out);
      for (const [key, item] of value) {
        this.write(key, out);
        this.write(item, out);
      }
    }
  }

  protected head(major: number, length: number, out: number[]): void {
    const type = major << 5;
    if (length < 24) {
      out.push(type | length);
    } else if (length < 0x100) {
      out.push(type | 24, length);
    } else if (length < 0x10000) {
      out.push(type | 25, length >> 8, length & 0xff);
    } else if (length < 0x1_0000_0000) {
      out.push(
        type | 26,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    } else {
      const high = Math.floor(length / 0x1_0000_0000);
      const low = length >>> 0;
      out.push(type | 27);
      for (const word of [high, low]) {
        out.push(
          (word >>> 24) & 0xff,
          (word >>> 16) & 0xff,
          (word >>> 8) & 0xff,
          word & 0xff,
        );
      }
    }
  }
}
