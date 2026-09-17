import { $inject, z } from "alepha";
import { ConsoleColorProvider } from "alepha/logger";

/**
 * Where a result goes: the handler's own `print`, which writes stdout and
 * strips colour when stdout is not a terminal.
 */
export type LorePrint = (message?: string) => void;

export type LoreOutputFormat = "human" | "json";

/**
 * One row of a list: the handle a command takes back (`Q12`, `F12`, a
 * project's slug), its title, and at most two more fields.
 */
export interface LoreListRow {
  handle: string;
  title: string;
  fields?: Array<string | undefined>;
}

/**
 * Where a list page sits in the whole result, so a page that is not all of it
 * says so.
 */
export interface LoreListPage {
  offset: number;
  limit: number;
  /**
   * The size of the whole result, when the action returns one. A list action
   * that does not (folios) is judged by whether the page came back full.
   */
  total?: number;
}

/**
 * One entity: its fields one per line, then its Markdown body verbatim, then
 * titled sections (a quest's objectives, its discussion, a folio's links).
 */
export interface LoreEntity {
  fields: Array<[label: string, value: string | number | undefined]>;
  body?: string;
  /**
   * The body is a client-side encrypted envelope: say so, never print it.
   */
  protected?: boolean;
  sections?: Array<{ title: string; lines: string[] }>;
}

/**
 * An objective as `lore quest get` lists it.
 */
export interface LoreObjective {
  id: number;
  title: string;
  completed: boolean;
  waivedReason?: string;
}

/**
 * How the `project`, `quest` and `folio` commands print a result.
 *
 * ## Human by default, everywhere: decided 2026-09-13
 *
 * No TTY detection. An agent's shell tool is a pipe, and a switch that gave
 * pipes JSON would have handed agents the largest payload a command can
 * produce: `questResourceSchema` is the whole quest (description, history,
 * commits) ten to a page. The terse render is where the saving is, so every
 * caller gets it without a flag, and a script asks for `--output json`.
 *
 * ## One rule per shape, never one per command
 *
 * - **a list**: one line per row, the handle first, then the title, then at
 *   most two fields; a page that is not the whole result ends with a line
 *   saying so.
 * - **an entity**: its fields, a blank line, its body verbatim, then its
 *   sections.
 * - **a write**: the identity and what changed, on one line.
 * - **json**: one JSON document. For a command that makes one call, that
 *   action's response; for one that makes more, the response of the action
 *   that returns the command's subject, with a second read under one named
 *   key. Never reshaped, never renamed: the command builds the value, this
 *   only prints it.
 *
 * ## Everything goes through `print`
 *
 * Never the logger. Since #Q2299 a CLI's log lines are on stderr, so what is
 * printed here is the whole of stdout: `--output json` is exactly one JSON
 * document, a partial write's refusal included, which lands on stderr.
 *
 * ⚠️ Not re-exported from `index.ts`: how the `lore` binary renders is its
 * behaviour, not an API.
 */
export class LoreOutput {
  /**
   * The one `--output` flag, spread into every command that prints a
   * result. Not a global flag: `CliProvider.globalFlags` is shared by every
   * Alepha CLI, and `alepha build --output json` means nothing.
   */
  public static readonly FLAGS = {
    output: z
      .enum(["human", "json"])
      .describe(
        "How to print the result: human, a terse render (the default, in a terminal and in a pipe alike), or json, the action's response as one JSON document.",
      )
      .default("human"),
  };

  protected readonly color = $inject(ConsoleColorProvider);

  /**
   * One JSON document.
   */
  public json(print: LorePrint, value: unknown): void {
    print(JSON.stringify(value, null, 2));
  }

  /**
   * One line per row, handles aligned, and a last line when the page is not
   * the whole result.
   */
  public list(
    print: LorePrint,
    rows: LoreListRow[],
    page?: LoreListPage,
    empty = "Nothing found.",
  ): void {
    if (rows.length === 0) {
      print(empty);
      return;
    }

    const width = Math.max(...rows.map((row) => row.handle.length));
    for (const row of rows) {
      const fields = (row.fields ?? [])
        .filter((field): field is string => !!field)
        .slice(0, 2);
      const tail = fields.length
        ? `  ${this.color.set("GREY_DARK", fields.join("  "))}`
        : "";
      print(
        `${this.color.set("CYAN", row.handle.padEnd(width))}  ${row.title}${tail}`,
      );
    }

    const more = page ? this.pageLine(rows.length, page) : undefined;
    if (more) {
      print(this.color.set("GREY_DARK", more));
    }
  }

  /**
   * Fields, a blank line, the body verbatim, then each section.
   */
  public entity(print: LorePrint, entity: LoreEntity): void {
    const fields = entity.fields.filter(
      ([, value]) => value !== undefined && value !== "",
    );
    const width = Math.max(0, ...fields.map(([label]) => label.length + 1));
    for (const [label, value] of fields) {
      print(
        `${this.color.set("GREY_DARK", `${label}:`.padEnd(width))}  ${value}`,
      );
    }

    if (entity.protected) {
      print("");
      print(
        "This folio is protected: its content is encrypted in the browser, and only Lore's web app can decrypt it.",
      );
    } else if (entity.body) {
      print("");
      print(entity.body);
    }

    for (const section of entity.sections ?? []) {
      print("");
      print(this.color.set("WHITE_BOLD", `${section.title}:`));
      for (const line of section.lines) {
        print(line);
      }
    }
  }

  /**
   * A write, on one line.
   */
  public write(print: LorePrint, line: string): void {
    print(line);
  }

  /**
   * An objective with the id `lore quest objective set` and `--waive` take:
   * `[x] 0  Title`, `[ ] 1  Title`, `[-] 2  Title (waived: reason)`.
   */
  public objective(objective: LoreObjective): string {
    const mark = objective.completed
      ? "[x]"
      : objective.waivedReason
        ? "[-]"
        : "[ ]";
    const waived = objective.waivedReason
      ? this.color.set("GREY_DARK", ` (waived: ${objective.waivedReason})`)
      : "";
    return `${mark} ${this.color.set("CYAN", String(objective.id))}  ${objective.title}${waived}`;
  }

  /**
   * The line under a page that is not the whole result, or `undefined` when
   * it is.
   */
  protected pageLine(shown: number, page: LoreListPage): string | undefined {
    const next = page.offset + shown;
    if (page.total !== undefined) {
      if (page.offset === 0 && shown >= page.total) return undefined;
      const range = page.offset > 0 ? `${page.offset + 1}-${next}` : `${shown}`;
      return next < page.total
        ? `${range} of ${page.total}. Next page: --offset ${next}`
        : `${range} of ${page.total}`;
    }
    return shown >= page.limit
      ? `${shown} shown, there may be more. Next page: --offset ${next}`
      : undefined;
  }
}
