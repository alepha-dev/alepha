import { $inject } from "alepha";
import { DatabaseProvider, sql, type SQL, type SQLLike } from "alepha/orm";

import { splitMarkdownCode } from "../../web/app/components/shared/element/markdownCodeSegments.ts";
import type { ProjectMergeRenumber } from "./ProjectMergeService.ts";

/**
 * Keeps the references inside moved text pointing at what they meant
 * (#E94, #Q2783, folio #F1401).
 *
 * A source quest whose description says `[[#Q2683]]` meant the source's
 * Q2683. Once that quest is renumbered to Q2790 in the target, the same
 * text would read as the TARGET's own Q2683, a different quest. So every
 * typed reference to a renumbered item of the same source is rewritten to
 * the new number, and every Lore URL naming the source project
 * (`https://<host>/<source slug>/quests/2683`) is rewritten to the target's
 * slug and the new number.
 *
 * A reference to an item that kept its number is left alone: it already
 * means the same item in the target. Code spans and fences are left alone
 * too, as the reader leaves them: a token quoted in backticks is not a link.
 */
export class ProjectMergeReferences {
  protected readonly database = $inject(DatabaseProvider);

  /**
   * The letter each renumbered kind is written with, as the resource kinds
   * register them. A kind without one (a directory, an attachment) has no
   * typed reference to rewrite.
   */
  protected static readonly letters: Record<string, string> = {
    quest: "Q",
    epic: "E",
    folio: "F",
    feedback: "P",
    release: "R",
  };

  /**
   * The path segment a kind's page sits under, for the URL half.
   */
  protected static readonly paths: Record<string, string> = {
    quests: "Q",
    epics: "E",
    folios: "F",
  };

  public rewriter(input: {
    renumbered: ProjectMergeRenumber[];
    sourceSlug?: string;
    targetSlug?: string;
  }): ProjectMergeRewriter {
    const numbers = new Map<string, number>();
    for (const row of input.renumbered) {
      const letter = ProjectMergeReferences.letters[row.kind];
      if (letter) {
        numbers.set(`${letter}:${row.from}`, row.to);
      }
    }
    return new ProjectMergeRewriter(
      numbers,
      ProjectMergeReferences.paths,
      input.sourceSlug,
      input.targetSlug,
    );
  }

  /**
   * Reads `columns` of every row `where` selects, rewrites them, and answers
   * one UPDATE per row whose text changed. `id` is the table's primary key.
   */
  public async rewrite(
    rewriter: ProjectMergeRewriter,
    input: { table: string; columns: string[]; where: SQL },
  ): Promise<{ rewritten: number; statements: SQLLike[] }> {
    const rows = await this.database.execute(
      sql`SELECT id, ${sql.join(
        input.columns.map((column) => sql.identifier(column)),
        sql`, `,
      )} FROM ${sql.identifier(input.table)} WHERE ${input.where}`,
    );
    const statements: SQLLike[] = [];
    for (const row of rows) {
      const sets: SQL[] = [];
      for (const column of input.columns) {
        const value = row[column];
        if (typeof value !== "string") {
          continue;
        }
        const next = rewriter.text(value);
        if (next !== value) {
          sets.push(sql`${sql.identifier(column)} = ${next}`);
        }
      }
      if (sets.length) {
        statements.push(
          sql`UPDATE ${sql.identifier(input.table)} SET ${sql.join(sets, sql`, `)} WHERE id = ${row.id}`,
        );
      }
    }
    return { rewritten: statements.length, statements };
  }
}

/**
 * Rewrites one text: typed references and Lore URLs, outside code.
 */
export class ProjectMergeRewriter {
  protected readonly numbers: Map<string, number>;
  protected readonly paths: Record<string, string>;
  protected readonly sourceSlug?: string;
  protected readonly targetSlug?: string;

  constructor(
    numbers: Map<string, number>,
    paths: Record<string, string>,
    sourceSlug?: string,
    targetSlug?: string,
  ) {
    this.numbers = numbers;
    this.paths = paths;
    this.sourceSlug = sourceSlug;
    this.targetSlug = targetSlug;
  }

  /**
   * Whether this rewriter can change anything at all, so a step can skip
   * reading its tables when nothing was renumbered and no slug changes.
   */
  public get empty(): boolean {
    return (
      this.numbers.size === 0 &&
      (!this.sourceSlug || this.sourceSlug === this.targetSlug)
    );
  }

  public text(value: string): string {
    if (this.empty || !value) {
      return value;
    }
    return splitMarkdownCode(value)
      .map((segment) =>
        segment.code ? segment.text : this.prose(segment.text),
      )
      .join("");
  }

  protected prose(text: string): string {
    let out = text.replace(
      /\[\[(\s*)#([A-Za-z])(\d+)(\s*)\]\]/g,
      (
        match,
        before: string,
        letter: string,
        number: string,
        after: string,
      ) => {
        const to = this.numbers.get(`${letter.toUpperCase()}:${number}`);
        return to === undefined
          ? match
          : `[[${before}#${letter}${to}${after}]]`;
      },
    );
    if (
      this.sourceSlug &&
      this.targetSlug &&
      this.sourceSlug !== this.targetSlug
    ) {
      const slug = this.sourceSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(
        new RegExp(
          `(https?://[^/\\s)]+/)${slug}(/(\\w+)/(\\d+)(?!\\d)|(?=[/\\s)\\]>]|$))`,
          "g",
        ),
        (
          _match,
          host: string,
          _rest: string,
          path?: string,
          number?: string,
        ) => {
          if (path && number) {
            const letter = this.paths[path];
            const to = letter
              ? this.numbers.get(`${letter}:${number}`)
              : undefined;
            return `${host}${this.targetSlug}/${path}/${to ?? number}`;
          }
          return `${host}${this.targetSlug}`;
        },
      );
    }
    return out;
  }
}
