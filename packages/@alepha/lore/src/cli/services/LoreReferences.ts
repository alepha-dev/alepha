import { UsageError } from "alepha/command";

/**
 * How a `lore` command reads a reference: `12`, `Q12` or `#Q12` for a quest,
 * `F12` for a folio, `45` or `E45` for an epic. Case does not matter.
 *
 * One parser, so `lore quest get`, `lore quest complete` and `--epic` cannot
 * disagree about what a reference is.
 *
 * ⚠️ `#Q12` has to be quoted in a shell. Unquoted, `#` starts a comment, the
 * reference never reaches the command, and what arrives is a command missing
 * its argument. The refusal says so, because that is the likeliest way to get
 * here.
 */
export class LoreReferences {
  public quest(ref: string): number {
    return this.parse(ref, "Q", "quest");
  }

  public folio(ref: string): number {
    return this.parse(ref, "F", "folio");
  }

  public epic(ref: string): number {
    return this.parse(ref, "E", "epic");
  }

  protected parse(ref: string, letter: string, kind: string): number {
    const match = new RegExp(`^#?${letter}?(\\d+)$`, "i").exec(ref.trim());
    const number = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new UsageError(
        `'${ref}' is not a ${kind} reference. Pass 12, ${letter}12 or '#${letter}12' (quoted: unquoted, a shell reads # as a comment).`,
      );
    }
    return number;
  }
}
