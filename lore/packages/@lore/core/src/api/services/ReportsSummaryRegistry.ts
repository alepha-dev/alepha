import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { CapabilityKey } from "../schemas/capabilityKeySchema.ts";
import type { ReportsQuery } from "../schemas/reportsQuerySchema.ts";
import type { ReportsSummaryLine } from "../schemas/reportsSummarySchema.ts";
import { ProjectSecurityService } from "./ProjectSecurityService.ts";

/**
 * The Summary tab's lines (#Q2999), as each module registers them: core reads
 * no module's table, so it asks.
 *
 * A source reads one period. The registry calls it for the period and for the
 * one before, and pairs the lines by key, so no module writes a comparison.
 * A capability that is off never reaches its source.
 */
export class ReportsSummaryRegistry {
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly sources: ReportsSummarySource[] = [];

  public register(source: ReportsSummarySource): void {
    if (this.sources.some((it) => it.capability === source.capability)) {
      throw new AlephaError(
        `Reports summary of '${source.capability}' is registered twice`,
      );
    }
    this.sources.push(source);
  }

  public async lines(
    projectId: number,
    query: ReportsQuery,
  ): Promise<ReportsSummaryLine[]> {
    const capabilities = await this.security.capabilitiesOf(projectId);
    const enabled = this.sources.filter((it) => !!capabilities[it.capability]);
    const previous = this.previous(query);

    const lines = await Promise.all(
      enabled.map(async (source) => {
        const [now, before] = await Promise.all([
          source.read(projectId, query),
          previous
            ? source.read(projectId, { ...query, ...previous })
            : Promise.resolve([]),
        ]);
        const earlier = new Map(before.map((line) => [line.key, line.value]));
        return now.map(({ snapshot, ...line }) => ({
          ...line,
          capability: source.capability,
          ...(snapshot ? {} : { previous: earlier.get(line.key) }),
        }));
      }),
    );
    return lines.flat();
  }

  protected previous(query: ReportsQuery) {
    if (!query.from) {
      return undefined;
    }
    const from = this.dt.of(query.from).valueOf();
    const to = query.to ? this.dt.of(query.to).valueOf() : this.dt.nowMillis();
    return {
      from: new Date(from - (to - from)).toISOString(),
      to: new Date(from - 1).toISOString(),
    };
  }
}

export interface ReportsSummarySource {
  capability: CapabilityKey;
  read: (
    projectId: number,
    query: ReportsQuery,
  ) => Promise<ReportsSummarySourceLine[]>;
}

export type ReportsSummarySourceLine = Omit<
  ReportsSummaryLine,
  "capability" | "previous"
> & {
  /**
   * The figure is the state now, whatever the period: it has no previous one.
   */
  snapshot?: boolean;
};
