import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

import type { DashboardCardResource } from "../schemas/dashboardCardResourceSchema.ts";
import { DashboardMetricCatalog } from "../schemas/DashboardMetricCatalog.ts";
import { DashboardPresetCatalog } from "../schemas/DashboardPresetCatalog.ts";
import type { DashboardPresetKey } from "../schemas/dashboardPresetKeySchema.ts";
import { DashboardMetricRegistry } from "./DashboardMetricRegistry.ts";
import { ProjectDashboardCardService } from "./ProjectDashboardCardService.ts";

/**
 * Applies a ready-made layout to one dashboard (#Q3831): its stored cards
 * are replaced by the preset's, each scoped to the project and with its
 * metric's default filters, as the computed board builds them.
 *
 * Refused, naming what to turn on, when the project lacks what the preset
 * needs. A card whose own metric the project does not answer is left out
 * rather than stored as a card that could only say "unavailable".
 */
export class ProjectDashboardPresets {
  protected readonly cards = $inject(ProjectDashboardCardService);
  protected readonly catalog = $inject(DashboardMetricCatalog);
  protected readonly metrics = $inject(DashboardMetricRegistry);

  async apply(
    projectId: number,
    dashboardId: number | undefined,
    key: DashboardPresetKey,
  ): Promise<DashboardCardResource[]> {
    const preset = DashboardPresetCatalog.find(key);
    if (!preset) {
      throw new BadRequestError(`Unknown dashboard preset: ${key}`);
    }
    const capabilities = await this.metrics.capabilitiesOf([projectId]);
    const needed = { needs: preset.needs } as Parameters<
      DashboardMetricRegistry["answers"]
    >[0];
    if (!this.metrics.answers(needed, projectId, capabilities)) {
      throw new BadRequestError(
        preset.needs.option
          ? `This preset needs the ${preset.needs.option} option of ${preset.needs.capability}: turn it on in Settings > Capabilities`
          : `This preset needs the ${preset.needs.capability} capability: turn it on in Settings > Capabilities`,
      );
    }

    const cards = preset.cards.flatMap((card) => {
      const descriptor = this.catalog.find(card.metric);
      if (
        !descriptor ||
        !this.catalog.offers(card.metric, "project") ||
        !this.metrics.answers(descriptor, projectId, capabilities)
      ) {
        return [];
      }
      // The project itself, or the reader for a metric about them. A metric
      // that needs a subject picked (an epic, a release) has no place in a
      // preset, which picks nothing.
      const scope =
        this.catalog.forcedScope(card.metric, "project", projectId) ??
        (this.catalog.accepts(card.metric, "projects", "project")
          ? { kind: "projects" as const, projectIds: [projectId] }
          : undefined);
      if (!scope) {
        return [];
      }
      return [
        {
          metric: card.metric,
          scope,
          filters: this.catalog.parseFilters(card.metric, {}),
          size: card.size ?? 1,
          height: card.height ?? 1,
        },
      ];
    });

    // Replace, as Reset then a copy: the cards go first, so a copy refused
    // half-way leaves an empty board rather than a mixed one.
    await this.cards.reset(projectId, dashboardId);
    return this.cards.copy(projectId, dashboardId, cards);
  }
}
