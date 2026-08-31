import { AlephaError } from "alepha";

import type { AnalyticsEngineDataset } from "../providers/WaeAnalyticsProvider.ts";
import type { AnalyticsEngineRow } from "../services/AnalyticsEngineSql.ts";

interface Point {
  indexes: string[];
  blobs: Array<string | null>;
  doubles: number[];
}

/**
 * An in-process stand-in for a Workers Analytics Engine dataset **and** its
 * SQL API, shaped for `WaeAnalyticsProvider` — not a reuse of
 * `@alepha/lore`'s `FakeAnalyticsEngine`, which hard-codes the older
 * `WaeAnalyticsStore`'s SQL text, a different slot map and a different
 * discriminator.
 *
 * ## Why this has to exist
 *
 * `vitest` cannot bind a real Analytics Engine dataset, and `wrangler dev`
 * treats `writeDataPoint` as a no-op — so under the only local runtime that
 * has the binding, every write silently disappears and every read comes back
 * empty. This fake is the entire safety net for `WaeAnalyticsProvider`.
 *
 * ## Two ways to answer a query
 *
 * {@link execute} genuinely interprets the SQL text `WaeAnalyticsProvider`
 * generated and computes the answer from {@link points}, so a bug in the
 * generated WHERE / GROUP BY / SELECT clauses shows up as a wrong row, not
 * merely a missing one. {@link answer} instead queues a canned response for
 * the *next* call, which exists for exactly one thing genuine execution can
 * never produce: a `_sample_interval` other than 1 (see below).
 *
 * ## What it does NOT simulate
 *
 * Every point recorded through {@link writeDataPoint} carries an interval of
 * 1 — this fake never invents sampling. The design accepts that Analytics
 * Engine returns estimates, so a fake that fabricated a sampling rate would
 * make assertions about numbers production will not reproduce.
 * {@link answer} is the escape hatch for the one behaviour — the
 * `_sample_interval` correction math — that an interval of 1 can never
 * exercise on its own.
 *
 * ## Not a SQL parser
 *
 * {@link execute} understands exactly the expression shapes
 * `WaeAnalyticsProvider` emits (`blobN`, `substring(blobN, 1, 10)`,
 * `sum(_sample_interval)`, `sum(doubleN * _sample_interval)`,
 * `max(_sample_interval)`, `blobN = '…'` / `>= '…'` / `< '…'` / `IN (…)`)
 * and nothing else. That is the intended friction: a further expression shape
 * means this fake has to learn it too, the same closed-question design the
 * sigil original used.
 */
export class FakeAnalyticsEngine implements AnalyticsEngineDataset {
  readonly points: Point[] = [];

  /**
   * The most recent SQL statement executed — asserted on directly.
   */
  lastQuery: string | undefined;

  protected queued: AnalyticsEngineRow[] | undefined;

  writeDataPoint(point: {
    indexes?: string[];
    blobs?: Array<string | null>;
    doubles?: number[];
  }): void {
    this.points.push({
      indexes: point.indexes ?? [],
      blobs: point.blobs ?? [],
      doubles: point.doubles ?? [],
    });
  }

  /**
   * Queues a canned response for the next {@link query} call, consumed once.
   */
  answer(rows: AnalyticsEngineRow[]): void {
    this.queued = rows;
  }

  /**
   * Drop-in for `AnalyticsEngineSql`'s own `query` method — assign
   * `sql.query = engine.query` so a real `AnalyticsEngineSql` instance
   * (whose `quote` / `num` / `str` statics stay in play) routes its reads
   * through this fake instead of `fetch`.
   */
  query = async (sql: string): Promise<AnalyticsEngineRow[]> => {
    this.lastQuery = sql;
    if (this.queued) {
      const rows = this.queued;
      this.queued = undefined;
      return rows;
    }
    return this.execute(sql);
  };

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The handful of dialect rules this fake reproduces because getting them
   * wrong is a 422 from the real endpoint and nothing else catches it.
   *
   * ⚠️ Added after a production outage (2026-08-11) in which the provider
   * emitted `HAVING COUNT(*) > 0` — valid on every relational database,
   * rejected by Analytics Engine with *"COUNT() function must have 0
   * arguments: 1"*. This fake previously modelled that clause explicitly and
   * so agreed with the bug: every test passed against SQL the real parser
   * refuses.
   *
   * Same lesson as `AnalyticsEngineSql.quoteIdentifier`'s hyphen note ("no
   * fake can catch this: it is the real endpoint's parser that rejects it"),
   * which is precisely why the answer is to teach the fake each rule as it is
   * learned, rather than to accept that class of bug as undetectable.
   */
  protected assertDialect(sql: string): void {
    // `count()` takes no arguments in this dialect. `count(*)`, `count(1)`
    // and `count(col)` are all the same 422.
    const badCount = /\bcount\s*\(\s*[^)\s]/i.exec(sql);
    if (badCount) {
      throw new AlephaError(
        "Analytics Engine SQL failed (422): Input was invalid: COUNT() function must have 0 arguments: 1",
      );
    }

    // GROUP BY takes column names — or a SELECT alias — and nothing else. An
    // expression there is a 422, which is how `GROUP BY substring(blob2, 1,
    // 10)` (the `day` pseudo-dimension) reached production and broke every
    // grouped read. Found only after the `count()` fix above unblocked the
    // query far enough for the parser to reach this clause: these two shipped
    // one deploy apart for no reason other than that the first error masked
    // the second.
    const groupBy = /GROUP BY\s+([\s\S]+?)(?:\s+HAVING|$)/i.exec(sql)?.[1];
    for (const term of this.splitTopLevel(groupBy ?? "", ", ")) {
      if (term.trim() && !/^\w+$/.test(term.trim())) {
        throw new AlephaError(
          `Analytics Engine SQL failed (422): Input was invalid: in the GROUP BY clause you may only provide column names: ${term.trim()}`,
        );
      }
    }
  }

  protected execute(sql: string): AnalyticsEngineRow[] {
    this.assertDialect(sql);
    const select = /SELECT\s+([\s\S]+?)\s+FROM/.exec(sql)?.[1] ?? "";
    const where =
      /WHERE\s+([\s\S]+?)(?:\s+GROUP BY|\s+HAVING|$)/.exec(sql)?.[1] ?? "";
    const groupBy = /GROUP BY\s+([\s\S]+?)(?:\s+HAVING|$)/.exec(sql)?.[1];

    const matched = this.points.filter((point) =>
      this.splitTopLevel(where, " AND ")
        .map((condition) => condition.trim())
        .every((condition) => this.matchesCondition(point, condition)),
    );

    const projections = this.splitTopLevel(select, ", ").map((p) => p.trim());

    // GROUP BY names SELECT aliases (the dialect allows nothing else — see
    // `assertDialect`), so each term has to be resolved back to the
    // expression it aliases before it can be evaluated against a point.
    const aliased = new Map<string, string>();
    for (const projection of projections) {
      const match = /^(.*)\s+AS\s+(\w+)$/i.exec(projection);
      if (match) aliased.set(match[2], match[1].trim());
    }
    const groupExpressions = groupBy
      ? this.splitTopLevel(groupBy, ", ").map((term) => {
          const name = term.trim();
          const expression = aliased.get(name);
          if (!expression) {
            throw new AlephaError(
              `FakeAnalyticsEngine: GROUP BY '${name}' names no SELECT alias.`,
            );
          }
          return expression;
        })
      : [];

    const groups = new Map<string, Point[]>();
    for (const point of matched) {
      const key = groupExpressions
        .map((expr) => this.evaluate(expr, point))
        .join(" ");
      const bucket = groups.get(key);
      if (bucket) bucket.push(point);
      else groups.set(key, [point]);
    }

    // No GROUP BY at all: the whole match is one implicit group — but only
    // when something matched. Plain aggregate SQL over zero matching rows
    // still returns one row with a NULL/0 total; `WaeAnalyticsProvider`
    // guards against that with `HAVING count() > 0`, which this fake
    // honours by never inventing a group when nothing fed it.
    if (groupExpressions.length === 0 && matched.length > 0) {
      groups.set("", matched);
    }

    const rows: AnalyticsEngineRow[] = [];
    for (const groupPoints of groups.values()) {
      const row: AnalyticsEngineRow = {};
      for (const projection of projections) {
        const match = /^(.*)\s+AS\s+(\w+)$/i.exec(projection);
        if (!match) {
          throw new AlephaError(
            `FakeAnalyticsEngine cannot interpret projection '${projection}'.`,
          );
        }
        const [, expr, alias] = match;
        row[alias] = this.aggregate(expr.trim(), groupPoints);
      }
      rows.push(row);
    }

    return rows;
  }

  protected matchesCondition(point: Point, condition: string): boolean {
    const gte = /^blob(\d+)\s*>=\s*'((?:[^'\\]|\\.)*)'$/.exec(condition);
    if (gte) {
      const [, slot, raw] = gte;
      return String(point.blobs[Number(slot) - 1] ?? "") >= this.unquote(raw);
    }

    // Strict, never `<=`: an inclusive day bound on an hour-granular column
    // is emitted as "before the next day", which is the only shape
    // `WaeAnalyticsProvider` produces here.
    const lt = /^blob(\d+)\s*<\s*'((?:[^'\\]|\\.)*)'$/.exec(condition);
    if (lt) {
      const [, slot, raw] = lt;
      return String(point.blobs[Number(slot) - 1] ?? "") < this.unquote(raw);
    }

    const inList = /^blob(\d+)\s+IN\s+\((.*)\)$/.exec(condition);
    if (inList) {
      const [, slot, list] = inList;
      const values = [...list.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) =>
        this.unquote(m[1]),
      );
      return values.includes(String(point.blobs[Number(slot) - 1] ?? ""));
    }

    const eq = /^blob(\d+)\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(condition);
    if (eq) {
      const [, slot, raw] = eq;
      return (point.blobs[Number(slot) - 1] ?? "") === this.unquote(raw);
    }

    throw new AlephaError(
      `FakeAnalyticsEngine cannot interpret WHERE condition '${condition}'.`,
    );
  }

  /**
   * Evaluates a non-aggregate expression (a group column) against one point:
   * `blobN` verbatim, or `substring(blobN, 1, 10)` for the day fold.
   */
  protected evaluate(expr: string, point: Point): string {
    const substring = /^substring\(blob(\d+),\s*1,\s*10\)$/.exec(expr);
    if (substring) {
      return String(point.blobs[Number(substring[1]) - 1] ?? "").slice(0, 10);
    }
    const blob = /^blob(\d+)$/.exec(expr);
    if (blob) {
      return String(point.blobs[Number(blob[1]) - 1] ?? "");
    }
    throw new AlephaError(
      `FakeAnalyticsEngine cannot interpret expression '${expr}'.`,
    );
  }

  /**
   * Evaluates one SELECT expression over a whole group: the sample-corrected
   * aggregates `WaeAnalyticsProvider` emits, or a plain group column (every
   * point in the group shares the same value by construction, so the first
   * is representative).
   */
  protected aggregate(expr: string, points: Point[]): number | string {
    if (expr === "sum(_sample_interval)") {
      return points.reduce((sum, p) => sum + this.sampleInterval(p), 0);
    }

    const sumDouble = /^sum\(double(\d+) \* _sample_interval\)$/.exec(expr);
    if (sumDouble) {
      const slot = Number(sumDouble[1]) - 1;
      return points.reduce(
        (sum, p) => sum + (p.doubles[slot] ?? 0) * this.sampleInterval(p),
        0,
      );
    }

    if (expr === "max(_sample_interval)") {
      return points.reduce(
        (max, p) => Math.max(max, this.sampleInterval(p)),
        1,
      );
    }

    return this.evaluate(expr, points[0]);
  }

  /**
   * This fake never simulates sampling — see the class doc. Every point
   * written through {@link writeDataPoint} stands for exactly one real
   * event.
   */
  protected sampleInterval(point: Point): number {
    return 1;
  }

  protected unquote(raw: string): string {
    return raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }

  /**
   * Splits `text` on `separator`, ignoring any separator that occurs inside
   * parentheses — so `substring(blob2, 1, 10) AS day, blob3 AS app` splits
   * into two projections rather than four, the commas inside `substring(...)`
   * left alone.
   */
  protected splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "(") depth++;
      if (char === ")") depth--;
      if (depth === 0 && text.startsWith(separator, i)) {
        parts.push(current);
        current = "";
        i += separator.length - 1;
        continue;
      }
      current += char;
    }
    if (current.trim().length > 0) parts.push(current);
    return parts;
  }
}
