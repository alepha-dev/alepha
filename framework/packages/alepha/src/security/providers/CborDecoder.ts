import { CborDecodeError } from "../errors/WebAuthnError.ts";

/**
 * A decoded CBOR value. Maps decode to a `Map`, since WebAuthn keys them by
 * integer (COSE) as often as by text (the attestation object).
 */
export type CborValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CborValue[]
  | Map<number | string, CborValue>;

/**
 * Decodes the CBOR subset WebAuthn uses (RFC 8949): unsigned and negative
 * integers, byte and text strings, arrays, maps, and the simple values
 * `false`, `true`, `null` and `undefined`.
 *
 * Everything else is refused with {@link CborDecodeError}: indefinite
 * lengths, tags, floats, map keys that are neither integers nor text,
 * duplicate map keys, integers past `Number.MAX_SAFE_INTEGER`, a truncated
 * item, and (in {@link decode}) trailing bytes. Nothing WebAuthn sends needs
 * any of them, and each is a way for two parsers to read the same bytes
 * differently.
 */
export class CborDecoder {
  /**
   * How deep arrays and maps may nest. An attestation statement is three
   * levels deep; this only stops a crafted input from exhausting the stack.
   */
  public maxDepth = 16;

  /**
   * Decode one item that spans the whole input.
   */
  public decode(bytes: Uint8Array): CborValue {
    const { value, end } = this.decodeFirst(bytes, 0);
    if (end !== bytes.length) {
      throw this.fail("Trailing bytes after CBOR item");
    }
    return value;
  }

  /**
   * Decode the item that starts at `offset`, and say where it ends. The
   * authenticator data needs this: the credential public key is followed by
   * the extensions, with no length in front of either.
   */
  public decodeFirst(
    bytes: Uint8Array,
    offset: number,
  ): { value: CborValue; end: number } {
    const cursor = { bytes, offset };
    const value = this.readItem(cursor, 0);
    return { value, end: cursor.offset };
  }

  protected readItem(
    cursor: { bytes: Uint8Array; offset: number },
    depth: number,
  ): CborValue {
    if (depth > this.maxDepth) {
      throw this.fail("CBOR nested too deeply");
    }
    const initial = this.readByte(cursor);
    const major = initial >> 5;
    const info = initial & 0x1f;

    if (major === 7) {
      switch (info) {
        case 20:
          return false;
        case 21:
          return true;
        case 22:
          return null;
        case 23:
          return undefined;
        default:
          throw this.fail("Unsupported CBOR simple value or float");
      }
    }

    const length = this.readArgument(cursor, info);

    switch (major) {
      case 0:
        return length;
      case 1:
        return -1 - length;
      case 2:
        return this.readBytes(cursor, length).slice();
      case 3: {
        const raw = this.readBytes(cursor, length);
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(raw);
        } catch {
          throw this.fail("Invalid UTF-8 in CBOR text string");
        }
      }
      case 4: {
        const items: CborValue[] = [];
        for (let i = 0; i < length; i++) {
          items.push(this.readItem(cursor, depth + 1));
        }
        return items;
      }
      case 5: {
        const map = new Map<number | string, CborValue>();
        for (let i = 0; i < length; i++) {
          const key = this.readItem(cursor, depth + 1);
          if (typeof key !== "number" && typeof key !== "string") {
            throw this.fail("CBOR map key is neither an integer nor text");
          }
          if (map.has(key)) {
            throw this.fail("Duplicate CBOR map key");
          }
          map.set(key, this.readItem(cursor, depth + 1));
        }
        return map;
      }
      default:
        throw this.fail("CBOR tags are not supported");
    }
  }

  protected readArgument(
    cursor: { bytes: Uint8Array; offset: number },
    info: number,
  ): number {
    if (info < 24) {
      return info;
    }
    if (info === 24) {
      return this.readByte(cursor);
    }
    if (info === 25) {
      return this.readUint(cursor, 2);
    }
    if (info === 26) {
      return this.readUint(cursor, 4);
    }
    if (info === 27) {
      const high = this.readUint(cursor, 4);
      const low = this.readUint(cursor, 4);
      const value = high * 0x1_0000_0000 + low;
      if (!Number.isSafeInteger(value)) {
        throw this.fail("CBOR integer too large");
      }
      return value;
    }
    if (info === 31) {
      throw this.fail("Indefinite-length CBOR is not supported");
    }
    throw this.fail("Reserved CBOR additional information");
  }

  protected readUint(
    cursor: { bytes: Uint8Array; offset: number },
    size: number,
  ): number {
    let value = 0;
    for (let i = 0; i < size; i++) {
      value = value * 256 + this.readByte(cursor);
    }
    return value;
  }

  protected readByte(cursor: { bytes: Uint8Array; offset: number }): number {
    if (cursor.offset >= cursor.bytes.length) {
      throw this.fail("Truncated CBOR");
    }
    return cursor.bytes[cursor.offset++];
  }

  protected readBytes(
    cursor: { bytes: Uint8Array; offset: number },
    length: number,
  ): Uint8Array {
    if (cursor.offset + length > cursor.bytes.length) {
      throw this.fail("Truncated CBOR");
    }
    const out = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
    cursor.offset += length;
    return out;
  }

  protected fail(message: string): CborDecodeError {
    return new CborDecodeError({ reason: "cbor" }, { message });
  }
}
