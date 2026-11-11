import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { EstateController } from "../../api/controllers/EstateController.ts";
import {
  estateStatsParamsSchema,
  estateStatsResultSchema,
} from "../schemas/estateSchemas.ts";

/**
 * An estate's CPU and memory over time, for agents (#Q3047), the twin of
 * `lore estate stats`.
 *
 * ⚠️ Read-only. It names an estate, which the deploy tools never do, because
 * nothing here can act on one: it goes through `getEstateStats`, gated on
 * `estate:read` in the estate's home project, so it reads nothing of an
 * estate whose project the caller is not in.
 */
export class EstateTools {
  protected readonly estates = $inject(EstateController);
  protected readonly projects = $inject(ProjectTools);

  estate_stats = $tool({
    title: "Read an estate's stats",
    description:
      "An estate's CPU and memory: the current reading, then one mean per day over a window (30 days by default). Readable by the members of its home project whose rank grants estate:read; with a project, the slug resolves among that project's own estates and the ones it borrows, and `home` picks between two of one slug. The daily series is recorded only while somebody switched it on; `collecting` says which.",
    annotations: { readOnlyHint: true },
    schema: {
      params: estateStatsParamsSchema,
      result: estateStatsResultSchema,
    },
    handler: async ({ params }) => {
      const projectId =
        params.project !== undefined || params.project_name !== undefined
          ? await this.projects.resolveProjectId(
              params.project,
              params.project_name,
            )
          : undefined;
      const { items } = await this.estates.listMyEstates({});
      const named = items.filter((item) => item.slug === params.estate);
      const inProject =
        projectId === undefined
          ? named
          : named.filter(
              (item) =>
                item.project?.id === projectId ||
                item.projects.some((loan) => loan.id === projectId),
            );
      const home = params.home?.toLowerCase();
      const candidates = (inProject.length ? inProject : named).filter(
        (item) =>
          !home ||
          item.project?.slug?.toLowerCase() === home ||
          item.project?.title.toLowerCase() === home,
      );
      if (candidates.length === 0) {
        throw new NotFoundError(
          `No estate named ${params.estate} that you can read${params.home ? ` in ${params.home}` : ""}`,
        );
      }
      if (candidates.length > 1) {
        throw new BadRequestError(
          `Several estates are named ${params.estate}: ${candidates
            .map(
              (item) =>
                `${params.estate} of ${item.project?.slug ?? item.project?.title ?? "no project"}`,
            )
            .join(", ")}. Pass home.`,
        );
      }
      const estate = candidates[0]!;
      const stats = await this.estates.getEstateStats({
        params: { estateId: estate.id },
        query: params.since ? { since: params.since } : {},
      });
      return {
        estate: estate.slug,
        current: {
          cpuPercent: estate.cpuPercent,
          memoryPercent: estate.memoryPercent,
          statsAt: estate.statsAt,
        },
        ...stats,
      };
    },
  });
}
