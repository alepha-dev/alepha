import { AlephaError } from "alepha";

/**
 * A set of quest numbers as a base64 bitmap, bit `n` meaning `#Q<n>` (#E154):
 * the storage format of `commit_quest_sets.quests`.
 *
 * Byte `n >> 3`, bit `n & 7`, least significant first, trailing zero bytes
 * trimmed so that two equal sets encode to one string. About 630 bytes for a
 * project of 5,000 quests, against 8 KB for a JSON array.
 */
export class QuestBitmap {
  /**
   * The highest number a set may hold: the column's 65,536 characters of
   * base64 carry 49,152 bytes, eight numbers each.
   */
  public static readonly MAX_NUMBER = 49_152 * 8 - 1;

  public static encode(numbers: Iterable<number>): string {
    let highest = -1;
    const valid: number[] = [];
    for (const n of numbers) {
      if (!Number.isInteger(n) || n < 1 || n > QuestBitmap.MAX_NUMBER) {
        throw new AlephaError(`Quest number out of range: ${n}`);
      }
      valid.push(n);
      if (n > highest) {
        highest = n;
      }
    }
    if (highest < 0) {
      return "";
    }
    const bytes = new Uint8Array((highest >> 3) + 1);
    for (const n of valid) {
      bytes[n >> 3] = (bytes[n >> 3] ?? 0) | (1 << (n & 7));
    }
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  public static decode(encoded: string): Set<number> {
    const numbers = new Set<number>();
    if (!encoded) {
      return numbers;
    }
    const binary = atob(encoded);
    for (let i = 0; i < binary.length; i++) {
      const byte = binary.charCodeAt(i);
      if (byte === 0) {
        continue;
      }
      for (let bit = 0; bit < 8; bit++) {
        if (byte & (1 << bit)) {
          numbers.add(i * 8 + bit);
        }
      }
    }
    return numbers;
  }
}
