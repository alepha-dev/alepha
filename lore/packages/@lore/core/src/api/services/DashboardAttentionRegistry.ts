import { $inject, AlephaError } from "alepha";

import type { ProjectCapability } from "../entities/projectCapabilities.ts";
import type { Project } from "../entities/projects.ts";
import { CapabilityRegistry } from "../schemas/CapabilityRegistry.ts";
import type { DashboardCardValue } from "../schemas/dashboardCardValueSchema.ts";
import type {
  DashboardCardLink,
  DashboardMetricRequirement,
} from "../schemas/DashboardMetricCatalog.ts";

/**
 * One thing that needs somebody, as a source offers it.
 */
export interface DashboardAttentionItem {
  /**
   * How much it needs somebody: the merged list sorts on it, highest first.
   * Overdue work outranks a crash outranks a hold outranks stale work.
   */
  weight: number;
  row: NonNullable<DashboardCardValue["rows"]>[number];
}

/**
 * What one source has for one project.
 */
export interface DashboardAttentionItems {
  items: DashboardAttentionItem[];
  /**
   * How many there are in all, which may exceed `items`: the merged list
   * says "N more" with this.
   */
  total: number;
  /**
   * Where the whole list of this source lives.
   */
  link?: DashboardCardLink;
}

/**
 * One module's contribution to "needs you" (#Q2656).
 */
export interface DashboardAttentionSource {
  /**
   * A code the locale names (`dashboard.source.<key>`), for its "N more".
   */
  key: string;
  /**
   * The capability, and option, the source needs: it is not asked at all in
   * a project without it.
   */
  needs?: DashboardMetricRequirement;
  read(
    project: Project,
    context: { viewerId?: string; windowDays: number },
  ): Promise<DashboardAttentionItems>;
}

/**
 * The sources of the "needs you" list (#E77, #Q2656): held, stale, overdue
 * and unassigned quests from Work, open blights from Deploy, untriaged
 * feedback from Work's Support side. Core reads none of their tables; each
 * module registers a source that does.
 */
export class DashboardAttentionRegistry {
  protected readonly capabilities = $inject(CapabilityRegistry);
  protected readonly sources: DashboardAttentionSource[] = [];

  register(source: DashboardAttentionSource): void {
    if (this.sources.some((it) => it.key === source.key)) {
      throw new AlephaError(
        `Attention source '${source.key}' is registered twice`,
      );
    }
    this.sources.push(source);
  }

  /**
   * The sources a project's capabilities allow, by its capability rows.
   */
  for(rows: ProjectCapability[]): DashboardAttentionSource[] {
    return this.sources.filter((source) => {
      const needs = source.needs;
      if (!needs) return true;
      const row = rows.find((it) => it.key === needs.capability);
      if (!row) return false;
      if (!needs.option) return true;
      return (
        this.capabilities.optionsOf(needs.capability, row.options)[
          needs.option
        ] === true
      );
    });
  }
}
