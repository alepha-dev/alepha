import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { areas } from "../entities/areas.ts";
import { quests } from "../entities/quests.ts";
import {
  type AreaResource,
  areaDetailSchema,
  areaResourceSchema,
} from "../schemas/areaResourceSchema.ts";
import { AreaService } from "../services/AreaService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The Area management surface, split out of `ProjectController` (901
 * lines) the way `EpicController` was.
 *
 * Same `$secure` permission strings as `EpicController`: `quest:read` to
 * read, `quest:create` to mutate, `quest:delete` on `deleteArea`. Same
 * `assertMember` (read) / `assertOwner` (mutate) split.
 *
 * The merge algorithm is NOT here — `renameArea` and `mergeAreas` are two
 * doors onto `AreaService.merge`, so the "rename onto an existing name
 * merges" rule cannot drift between them.
 */
export class AreaController {
  log = $logger();
  areas = $repository(areas);
  quests = $repository(quests);
  service = $inject(AreaService);
  security = $inject(ProjectSecurityService);

  getAreas = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(areaResourceSchema),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      return await this.service.listWithStats(params.projectId);
    },
  });

  getArea = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    path: "/areas/:id",
    schema: {
      params: z.object({ id: z.integer() }),
      response: areaDetailSchema,
    },
    handler: async ({ params, user }) => {
      const area = await this.areas.getById(params.id);
      await this.security.assertMember(area.projectId, user);

      const resource = await this.resource(area.projectId, area.id);

      const recent = await this.quests.findMany({
        where: {
          projectId: { eq: area.projectId },
          area: { eq: area.name },
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 10,
      });

      return {
        ...resource,
        recentQuests: recent.map((quest) => ({
          shortId: quest.shortId,
          title: quest.title,
          completedAt: quest.completedAt ?? undefined,
        })),
      };
    },
  });

  updateArea = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        description: z.string().meta({ size: "rich" }).optional(),
        // The palette is restated here rather than imported from the
        // entity because `areas.schema` carries the `mode: "text"` meta,
        // which belongs to the column and not to a request body. If a
        // ninth colour is ever added, BOTH lists change — there is no
        // type link between them. Keep them adjacent in review.
        color: z
          .enum([
            "slate",
            "blue",
            "green",
            "amber",
            "red",
            "violet",
            "cyan",
            "pink",
          ])
          .optional(),
      }),
      response: areaResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const area = await this.areas.getById(params.id);
      await this.security.assertOwner(area.projectId, user);

      await this.areas.updateById(params.id, {
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      });

      return await this.resource(area.projectId, area.id);
    },
  });

  /**
   * Rename, or merge when the name is taken. `merged` and `movedQuests`
   * are returned so the client can word its confirmation honestly —
   * "renamed" and "29 quests moved into Folio" are different claims.
   *
   * `areaId` in the response is the SURVIVING area, which after a merge
   * is the target, not the one addressed in the path. The detail page
   * navigates to it.
   */
  renameArea = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ name: z.string().min(1).max(48) }),
      response: z.object({
        ok: z.boolean(),
        merged: z.boolean(),
        movedQuests: z.integer(),
        areaId: z.integer(),
      }),
    },
    handler: async ({ params, body, user }) => {
      const area = await this.areas.getById(params.id);
      await this.security.assertOwner(area.projectId, user);

      const result = await this.service.rename(params.id, body.name);

      return {
        ok: true,
        merged: result.merged,
        movedQuests: result.movedQuests,
        areaId: result.area.id,
      };
    },
  });

  mergeAreas = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        sourceIds: z.array(z.integer()).min(1),
        targetId: z.integer(),
      }),
      response: z.object({ ok: z.boolean(), movedQuests: z.integer() }),
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);

      const { movedQuests } = await this.service.merge(
        params.projectId,
        body.sourceIds,
        body.targetId,
      );

      return { ok: true, movedQuests };
    },
  });

  /**
   * Only ever allowed on an empty area. A non-empty one is merged, not
   * deleted — deleting it would leave its quests pointing at a name with
   * no row, breaking `AreaService`'s invariant. Jira makes the same call
   * (its component delete forces a reassignment).
   */
  deleteArea = $action({
    use: [$secure({ permissions: ["quest:delete"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const area = await this.areas.getById(params.id);
      await this.security.assertOwner(area.projectId, user);

      // A direct count, not `listWithStats(area.projectId)` — that rolls
      // up every area of the project just to read one integer for this
      // one. `deleteArea` only cares whether THIS area is empty.
      const questCount = await this.quests.count({
        projectId: { eq: area.projectId },
        area: { eq: area.name },
      });
      if (questCount > 0) {
        throw new BadRequestError(
          "This area still holds quests. Merge it into another area instead.",
        );
      }

      // `force: true` is load-bearing. `areas` carries `deletedAt`, so a
      // plain `deleteById` only stamps the row (`Repository.deleteMany`
      // soft-deletes unless forced), and the unique index on
      // `(projectId, name)` has no `WHERE deleted_at IS NULL` — the name
      // would stay permanently occupied, and re-declaring it would throw
      // an unhandled unique-constraint error from `ensureArea`. Same
      // pitfall, same fix, as `EpicController.deleteEpic`.
      await this.areas.deleteById(params.id, { force: true });

      return { ok: true };
    },
  });

  protected async resource(
    projectId: number,
    areaId: number,
  ): Promise<AreaResource> {
    const all = await this.service.listWithStats(projectId);
    const found = all.find((a) => a.id === areaId);
    if (!found) {
      throw new BadRequestError("Area not found");
    }
    return found;
  }
}
