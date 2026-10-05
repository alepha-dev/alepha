import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";

import { EpicController } from "../controllers/EpicController.ts";
import { epics } from "../entities/epics.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import { ResourceRegistry } from "./ResourceRegistry.ts";

/**
 * The `epic` resource (`#E`), registered by Work. An epic is addressed by its
 * per-project `number`, which rides under a ref's `shortId`, and its status
 * comes along: a folio filed under an epic reports `{ number, title, status }`.
 */
export class EpicResourceKind {
  protected readonly resources = $inject(ResourceRegistry);
  protected readonly epics = $repository(epics);
  protected readonly bound = $inject(BoundParameters);
  protected readonly alepha = $inject(Alepha);

  /**
   * Resolved on use rather than injected: `EpicController` injects the
   * registry this kind registers on.
   */
  protected epicController(): EpicController {
    return this.alepha.inject(EpicController);
  }

  constructor() {
    this.resources.register({
      kind: "epic",
      letter: "E",
      order: 40,
      permission: "epic:read",
      page: {
        name: "projectEpic",
        params: (ref) => ({ epicNumber: ref.shortId }),
      },
      // Epics and releases are addressed by their per-project `number`, NOT
      // a `shortId`: that is the column they carry, and what
      // `/epics/:epicNumber` and `#E12` both mean.
      resolveNumbers: async (projectId) => {
        const rows = await this.epics.findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "number"],
        });
        return new Map(rows.map((r) => [r.number, String(r.id)]));
      },
      describe: async (_projectId, ids) => {
        const rows = await this.bound.collect(
          ids
            .map((id) => Number.parseInt(id, 10))
            .filter((n) => Number.isFinite(n)),
          (batch) =>
            this.epics.findMany({
              where: { id: { inArray: batch } },
              columns: ["id", "number", "title", "status"],
            }),
        );
        return rows.map((r) => ({
          id: String(r.id),
          shortId: r.number,
          title: r.title,
          status: r.status,
        }));
      },
      // Filing goes through the controller, so it keeps its gate (`epic:write`
      // on the epic) and its audit row (#E75, #Q2623): a module filing a
      // folio never reaches the epic's code.
      attach: async (parentId, child) => {
        await this.epicController().attachFolio({
          params: { id: parentId },
          body: { folioId: child.id },
        });
      },
      detach: async (parentId, child) => {
        await this.epicController().detachFolio({
          params: { id: parentId, folioId: child.id },
        });
      },
      search: {
        numberOnly: true,
        find: async ({ projectId, number }) => {
          if (number === undefined) return [];
          const rows = await this.epics.findMany({
            where: { projectId: { eq: projectId }, number: { eq: number } },
            limit: 1,
          });
          return rows.map((e) => ({
            kind: "epic" as const,
            id: String(e.id),
            shortId: e.number,
            title: e.title,
          }));
        },
      },
    });
  }
}
