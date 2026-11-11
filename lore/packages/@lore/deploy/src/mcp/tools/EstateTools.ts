import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { NotFoundError } from "alepha/server";

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

  estate_stats = $tool({
    title: "Read an estate's stats",
    description:
      "One of your estates' CPU and memory: the current reading, then one mean per day over a window (30 days by default). Only the estate's owner can read it. The daily series is recorded only while the owner has switched it on; `collecting` says which.",
    annotations: { readOnlyHint: true },
    schema: {
      params: estateStatsParamsSchema,
      result: estateStatsResultSchema,
    },
    handler: async ({ params }) => {
      const { items } = await this.estates.listMyEstates({});
      const estate = items.find((item) => item.slug === params.estate);
      if (!estate) {
        throw new NotFoundError(`You own no estate named ${params.estate}`);
      }
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
