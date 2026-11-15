/**
 * CSV in and out of a table folio, shared by Lore, its browser pages and
 * the `lore` CLI, so a file exported by one imports unchanged by another.
 *
 * ```ts
 * import { FolioCsv } from "@alepha/lore/csv";
 *
 * const csv = new FolioCsv();
 * const { rows } = csv.parse(text);
 * const type = csv.guessType(rows.slice(1).map((row) => row[0]));
 * ```
 *
 * @module
 */
export {
  FolioCsv,
  type FolioCsvColumn,
  type FolioCsvGuess,
} from "./FolioCsv.ts";
