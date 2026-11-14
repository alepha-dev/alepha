import type { FolioColumn } from "../entities/folioColumns.ts";
import type { FolioCellValue } from "../schemas/folioCellValueSchema.ts";
import type { FolioColumnOptions } from "../schemas/folioColumnOptionsSchema.ts";
import {
  type FolioColumnType,
  folioColumnTypeSchema,
} from "../schemas/folioColumnTypeSchema.ts";

/**
 * The column a codec method reads: its type and its options, nothing else.
 */
export type FolioCodecColumn = Pick<FolioColumn, "type" | "options">;

/**
 * What {@link FolioCellCodec.coerce} answers: the value to store, `null` to
 * clear the cell, or the reason it cannot be stored.
 */
export type FolioCoercion =
  | { ok: true; value: FolioCellValue }
  | { ok: false; expected: string };

/**
 * How a cell value is written, read, shown and compared, per column type
 * (#E144, #Q3511). No database: `FolioTableService` holds the rows and this
 * decides what a value means.
 *
 * Writes are strict and reads are lenient, through ONE function:
 * {@link coerce} is what a write stores, and {@link read} is the same
 * coercion answering `null` where a write would refuse. So a retyped column
 * reads every stored value that still makes sense under its new type (a
 * number column reads `"12"`, a text column reads `12`), and an option that
 * was removed reads as empty, without a sweep over the rows.
 */
export class FolioCellCodec {
  /**
   * A text cell's length cap, in characters.
   */
  static readonly MAX_TEXT = 2000;

  protected readonly DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  protected readonly DATETIME =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
  protected readonly REFERENCE = /^(?:\[\[)?\s*#([A-Za-z])(\d+)\s*(?:\]\])?$/;

  /**
   * The column's type, `text` for one this build does not know.
   */
  public typeOf(column: Pick<FolioColumn, "type">): FolioColumnType {
    const parsed = folioColumnTypeSchema.safeParse(column.type);
    return parsed.success ? parsed.data : "text";
  }

  /**
   * The column's options, keeping only what is recognised and well formed.
   */
  public optionsOf(column: Pick<FolioColumn, "options">): FolioColumnOptions {
    const raw = (column.options ?? {}) as Record<string, unknown>;
    const options: FolioColumnOptions = {};
    if (Array.isArray(raw.choices)) {
      options.choices = raw.choices.flatMap((choice) =>
        choice &&
        typeof choice === "object" &&
        typeof (choice as { id?: unknown }).id === "string" &&
        typeof (choice as { label?: unknown }).label === "string"
          ? [
              {
                id: (choice as { id: string }).id,
                label: (choice as { label: string }).label,
              },
            ]
          : [],
      );
    }
    if (raw.withTime === true) options.withTime = true;
    return options;
  }

  /**
   * The value a write stores for `raw`, or why it cannot. `null`,
   * `undefined` and a blank string clear the cell, whatever the type.
   *
   * A reference is checked for its grammar here and for its target by the
   * service, which knows the project.
   */
  public coerce(column: FolioCodecColumn, raw: unknown): FolioCoercion {
    if (raw === null || raw === undefined) return { ok: true, value: null };
    if (typeof raw === "string" && raw.trim() === "") {
      return { ok: true, value: null };
    }
    const type = this.typeOf(column);
    switch (type) {
      case "text": {
        if (
          typeof raw !== "string" &&
          typeof raw !== "number" &&
          typeof raw !== "boolean"
        ) {
          return { ok: false, expected: "text" };
        }
        const text = String(raw);
        if (text.length > FolioCellCodec.MAX_TEXT) {
          return {
            ok: false,
            expected: `text of at most ${FolioCellCodec.MAX_TEXT} characters (got ${text.length})`,
          };
        }
        return { ok: true, value: text };
      }
      case "number": {
        const value =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number(raw.trim())
              : Number.NaN;
        return Number.isFinite(value)
          ? { ok: true, value }
          : { ok: false, expected: "a number" };
      }
      case "checkbox": {
        if (typeof raw === "boolean") return { ok: true, value: raw };
        if (typeof raw === "string") {
          const word = raw.trim().toLowerCase();
          if (word === "true") return { ok: true, value: true };
          if (word === "false") return { ok: true, value: false };
        }
        return { ok: false, expected: "a checkbox (true or false)" };
      }
      case "date":
        return this.coerceDate(column, raw);
      case "select": {
        const choices = this.optionsOf(column).choices ?? [];
        if (typeof raw === "string") {
          const wanted = raw.trim();
          const byId = choices.find((choice) => choice.id === wanted);
          if (byId) return { ok: true, value: byId.id };
          const lower = wanted.toLowerCase();
          const byLabel = choices.find(
            (choice) => choice.label.toLowerCase() === lower,
          );
          if (byLabel) return { ok: true, value: byLabel.id };
        }
        return {
          ok: false,
          expected:
            choices.length === 0
              ? "one of the column's options (it has none)"
              : `one of ${choices.map((choice) => JSON.stringify(choice.label)).join(", ")}`,
        };
      }
      case "reference": {
        const code = typeof raw === "string" ? this.referenceCode(raw) : null;
        return code
          ? { ok: true, value: code }
          : { ok: false, expected: "a reference such as #Q12 or [[#F12]]" };
      }
    }
  }

  /**
   * A stored value as a reader sees it: what {@link coerce} makes of it, or
   * `null` when it no longer fits the column. Never throws.
   */
  public read(column: FolioCodecColumn, raw: unknown): FolioCellValue {
    const coerced = this.coerce(column, raw);
    return coerced.ok ? coerced.value : null;
  }

  /**
   * The canonical code of a reference written as `#q12`, `#Q12` or
   * `[[#Q12]]`: `#Q12`. `null` for anything else.
   */
  public referenceCode(raw: string): string | null {
    const match = this.REFERENCE.exec(raw.trim());
    if (!match) return null;
    return `#${match[1].toUpperCase()}${Number.parseInt(match[2], 10)}`;
  }

  /**
   * A read value as text: what search indexes and `contains` matches. A
   * select reads as its label, a reference as its code, a checkbox as
   * nothing (search has no use for "true").
   */
  public displayText(column: FolioCodecColumn, value: FolioCellValue): string {
    if (value === null) return "";
    const type = this.typeOf(column);
    if (type === "checkbox") return "";
    if (type === "select") {
      const choice = (this.optionsOf(column).choices ?? []).find(
        (it) => it.id === value,
      );
      return choice?.label ?? "";
    }
    return String(value);
  }

  /**
   * Order two non-empty read values of one column, ascending. Empty cells
   * are the caller's: they sort last in either direction.
   */
  public compare(
    column: FolioCodecColumn,
    a: FolioCellValue,
    b: FolioCellValue,
  ): number {
    const type = this.typeOf(column);
    if (type === "number") return Number(a) - Number(b);
    if (type === "checkbox") return Number(a) - Number(b);
    if (type === "select") {
      const choices = this.optionsOf(column).choices ?? [];
      const index = (value: FolioCellValue) =>
        choices.findIndex((choice) => choice.id === value);
      return index(a) - index(b);
    }
    if (type === "reference") {
      const parse = (value: FolioCellValue) => {
        const text = String(value);
        return { letter: text.slice(1, 2), n: Number(text.slice(2)) };
      };
      const left = parse(a);
      const right = parse(b);
      return left.letter === right.letter
        ? left.n - right.n
        : left.letter < right.letter
          ? -1
          : 1;
    }
    // Text and dates: ISO dates order as strings, and a day sorts before the
    // times of that day.
    const left = String(a);
    const right = String(b);
    return type === "text"
      ? left.localeCompare(right, undefined, { sensitivity: "base" })
      : left < right
        ? -1
        : left > right
          ? 1
          : 0;
  }

  /**
   * A day (`YYYY-MM-DD`) in any date column; an ISO datetime, stored in UTC,
   * only in one `withTime`. A day never carries a zone, so it never shifts
   * with the reader's.
   */
  protected coerceDate(column: FolioCodecColumn, raw: unknown): FolioCoercion {
    const withTime = this.optionsOf(column).withTime === true;
    const expected = withTime
      ? "a date (YYYY-MM-DD) or an ISO datetime with its zone"
      : "a date (YYYY-MM-DD)";
    if (typeof raw !== "string") return { ok: false, expected };
    const text = raw.trim();
    const day = this.DAY.exec(text);
    if (day) {
      const [, y, m, d] = day;
      const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      return probe.getUTCFullYear() === Number(y) &&
        probe.getUTCMonth() === Number(m) - 1 &&
        probe.getUTCDate() === Number(d)
        ? { ok: true, value: text }
        : { ok: false, expected };
    }
    if (withTime && this.DATETIME.test(text)) {
      const at = new Date(text);
      return Number.isNaN(at.getTime())
        ? { ok: false, expected }
        : { ok: true, value: at.toISOString() };
    }
    return { ok: false, expected };
  }
}
