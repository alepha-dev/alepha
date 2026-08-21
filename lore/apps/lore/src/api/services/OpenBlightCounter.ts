import { $repository } from "alepha/orm";

import { blights } from "../entities/blights.ts";
import { sigilErrorGroups } from "../entities/sigilErrorGroups.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";

/** What a scoped blight count answers, headline first. */
export interface OpenBlightCount {
  /**
   * Distinct bugs. One counted unit is one `blights` row, i.e. one
   * `(projectId, fingerprint)` — so a bug present in two of the selected
   * apps counts **once**.
   */
  count: number;
  /**
   * Occurrences behind those bugs. A far larger and more volatile number
   * than `count`; it belongs in a footer, never in the headline.
   */
  occurrences: number;
  /** How many of the scoped apps contributed at least one counted bug. */
  apps: number;
  /** The project contributing the most counted bugs, for the drill-through. */
  topProjectId?: number;
}

/** What to count. */
export interface OpenBlightQuery {
  /** Projects in scope. Already proven against the caller's memberships. */
  projectIds: number[];
  /**
   * Apps in scope, when the card names a list of them. Absent means "every
   * bug in those projects" — see the class doc for why the two are counted
   * differently rather than by the same query with a wider list.
   */
  sigilIds?: string[];
  /** `open` excludes `resolved` and `quest:<id>`. */
  status: "open" | "all";
}

/** The identity of one blight row, which is the unit this service counts. */
export interface BlightKey {
  projectId: number;
  fingerprint: string;
}

/**
 * "How many open blights do these apps have" — the question `blights` alone
 * cannot answer, and `sigil_error_groups` alone cannot answer either.
 *
 * ## Why the obvious implementation is wrong
 *
 * `blights.sigilId` looks like the answer and is not. Its own docstring says
 * so: it is **which sigil reported it most recently**, overwritten on every
 * ingest, and a row is keyed `(projectId, fingerprint)` — so one bug present
 * in two enrolled apps is one row and that column attributes it to whichever
 * app happened to report last. A count filtered on it moves when an
 * unrelated app reports the same bug. That is unstable, not merely
 * imprecise. It is also `ON DELETE SET NULL`, so revoking a token orphans
 * the attribution while the bug lives on.
 *
 * The lossless per-app split is `sigil_error_groups`, keyed
 * `(sigilId, fingerprint)` — but it carries **no status column**, because a
 * triage decision must not fork per app. So neither table answers alone:
 * "open blights for apps [A, B]" is error groups in those apps, joined back
 * to `blights` for triage status, counted as blight rows.
 *
 * ## Two scopes, two counts, on purpose
 *
 * - **An app list** counts only bugs attributable to those apps, through the
 *   join above.
 * - **A project** counts every blight in it, straight off the inbox's own
 *   table. Not the same query with a wider app list: rows written before the
 *   per-app split existed have no error group, so joining would silently
 *   drop them and disagree with the inbox and the sidebar badge, which both
 *   read `blights` directly.
 *
 * ## Retention
 *
 * The two tables age out on different clocks. `BlightJobs.purgeStaleBlights`
 * deletes `open` blights past the project's `retentionDays`; nothing purges
 * `sigil_error_groups`, which lives until its sigil is deleted. So a group
 * routinely outlives its blight row — and when it does the bug must not
 * count, because the triage decision it would be counted under no longer
 * exists. The join gives that for free: no blight row, no count. Stated
 * rather than left merely true, because "why did the number drop" has
 * exactly one right answer here.
 *
 * ## Indexes
 *
 * Both join ends are already served: `sigil_error_groups` is unique on
 * `(sigilId, fingerprint)` and `blights` is unique on
 * `(projectId, fingerprint)`. No new index is needed.
 */
export class OpenBlightCounter {
  protected readonly blights = $repository(blights);
  protected readonly errorGroups = $repository(sigilErrorGroups);
  protected readonly sigils = $repository(sigils);

  async count(query: OpenBlightQuery): Promise<OpenBlightCount> {
    if (query.projectIds.length === 0) {
      return { count: 0, occurrences: 0, apps: 0 };
    }

    const scopedSigils = await this.scopedSigils(query);
    const projectOf = new Map(scopedSigils.map((it) => [it.id, it.projectId]));

    const counted = query.sigilIds
      ? await this.countedThroughApps(query, projectOf)
      : await this.countedAcrossProjects(query);

    if (counted.rows.length === 0) {
      return { count: 0, occurrences: 0, apps: 0 };
    }

    const pairs = new Set(
      counted.rows.map((row) => this.pair(row.projectId, row.fingerprint)),
    );

    // The app figure comes from the split table in BOTH paths. It is the only
    // lossless source, and reading `blights.sigilId` for it would put the
    // unstable column back into the answer through the footer.
    const attributions = await this.errorGroups.findMany({
      where: {
        sigilId: { inArray: scopedSigils.map((it) => it.id) },
        fingerprint: {
          inArray: [...new Set(counted.rows.map((row) => row.fingerprint))],
        },
      },
      columns: ["sigilId", "fingerprint"],
    });
    const contributing = new Set(
      attributions
        .filter((group) =>
          pairs.has(
            this.pair(projectOf.get(group.sigilId) ?? -1, group.fingerprint),
          ),
        )
        .map((group) => group.sigilId),
    );

    return {
      count: counted.rows.length,
      occurrences: counted.occurrences,
      apps: contributing.size,
      topProjectId: this.topProject(counted.rows),
    };
  }

  /**
   * Bugs attributable to a named list of apps.
   *
   * The join is the point: error groups say which app has the bug, `blights`
   * says whether anyone has triaged it, and the result is counted as blight
   * rows so two selected apps sharing a fingerprint contribute one.
   *
   * Occurrences are summed off the **groups**, not off the blight rows: the
   * blight's own `count` includes occurrences reported by apps the card did
   * not select, which would make the footer describe a wider scope than the
   * headline it sits under.
   */
  protected async countedThroughApps(
    query: OpenBlightQuery,
    projectOf: Map<string, number>,
  ): Promise<{ rows: BlightKey[]; occurrences: number }> {
    const groups = await this.errorGroups.findMany({
      where: { sigilId: { inArray: query.sigilIds ?? [] } },
      columns: ["sigilId", "fingerprint", "count"],
    });
    if (groups.length === 0) {
      return { rows: [], occurrences: 0 };
    }

    const rows = await this.blights.findMany({
      where: {
        projectId: { inArray: query.projectIds },
        fingerprint: {
          inArray: [...new Set(groups.map((it) => it.fingerprint))],
        },
        ...(query.status === "open" ? { status: { eq: "open" } } : {}),
      },
      columns: ["projectId", "fingerprint"],
    });

    // A fingerprint can exist in two projects at once, and the `inArray`
    // above cannot express "this fingerprint, but only in the project the
    // reporting app belongs to". This is where that is enforced.
    const reachable = new Set(
      groups.map((group) =>
        this.pair(projectOf.get(group.sigilId) ?? -1, group.fingerprint),
      ),
    );
    const kept = rows.filter((row) =>
      reachable.has(this.pair(row.projectId, row.fingerprint)),
    );
    const keptPairs = new Set(
      kept.map((row) => this.pair(row.projectId, row.fingerprint)),
    );

    const occurrences = groups
      .filter((group) =>
        keptPairs.has(
          this.pair(projectOf.get(group.sigilId) ?? -1, group.fingerprint),
        ),
      )
      .reduce((sum, group) => sum + (group.count ?? 1), 0);

    return { rows: kept, occurrences };
  }

  /** Every blight in the scoped projects, exactly as the inbox reads them. */
  protected async countedAcrossProjects(
    query: OpenBlightQuery,
  ): Promise<{ rows: BlightKey[]; occurrences: number }> {
    const rows = await this.blights.findMany({
      where: {
        projectId: { inArray: query.projectIds },
        ...(query.status === "open" ? { status: { eq: "open" } } : {}),
      },
      columns: ["projectId", "fingerprint", "count"],
    });

    return {
      rows,
      occurrences: rows.reduce((sum, row) => sum + (row.count ?? 1), 0),
    };
  }

  /**
   * The apps the count is allowed to see.
   *
   * An `apps` scope names them; a project scope means every app enrolled in
   * it. Either way the ids came from `DashboardScopeService`, which already
   * proved them against the caller's memberships.
   */
  protected async scopedSigils(query: OpenBlightQuery): Promise<Sigil[]> {
    if (query.sigilIds) {
      return this.sigils.findMany({
        where: { id: { inArray: query.sigilIds } },
      });
    }
    return this.sigils.findMany({
      where: { projectId: { inArray: query.projectIds } },
    });
  }

  /** Which project holds the most counted bugs. Drives the drill-through. */
  protected topProject(rows: BlightKey[]): number | undefined {
    const tally = new Map<number, number>();
    for (const row of rows) {
      tally.set(row.projectId, (tally.get(row.projectId) ?? 0) + 1);
    }
    let best: number | undefined;
    let bestCount = -1;
    for (const [projectId, count] of tally) {
      if (count > bestCount) {
        best = projectId;
        bestCount = count;
      }
    }
    return best;
  }

  /** `(projectId, fingerprint)` as one comparable key. */
  protected pair(projectId: number, fingerprint: string): string {
    return `${projectId} ${fingerprint}`;
  }
}
