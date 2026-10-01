import { $inject, z } from "alepha";
import { permissionCatalogueSchema, SecurityProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { organizationRankResourceSchema } from "../schemas/organizationRankResourceSchema.ts";
import { $ownsOrganization } from "../security/$ownsOrganization.ts";
import { RankService } from "../services/RankService.ts";

export class OrganizationRankController {
  protected readonly ranks = $inject(RankService);
  protected readonly security = $inject(SecurityProvider);

  public readonly getOrganizationRankCatalogue = $action({
    path: "/organizations/:organizationId/ranks/catalogue",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "rank:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: permissionCatalogueSchema,
    },
    handler: () => this.security.permissionCatalogueFor(),
  });

  public readonly getOrganizationRanks = $action({
    path: "/organizations/:organizationId/ranks",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "rank:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid() }),
      response: z.object({ items: z.array(organizationRankResourceSchema) }),
    },
    handler: async ({ params }) => ({
      items: await this.ranks.ranksOf(params.organizationId),
    }),
  });

  public readonly saveOrganizationRank = $action({
    method: "PUT",
    path: "/organizations/:organizationId/ranks/:key",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "rank:manage",
      }),
    ],
    schema: {
      params: z.object({
        organizationId: z.uuid(),
        key: z.text({ minLength: 1, maxLength: 64 }),
      }),
      body: z.object({
        name: z.text({ minLength: 1, maxLength: 100 }),
        permissions: z.array(z.text()),
      }),
      response: organizationRankResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.ranks.save(
        params.organizationId,
        { key: params.key, ...body },
        user,
      ),
  });

  public readonly deleteOrganizationRank = $action({
    method: "DELETE",
    path: "/organizations/:organizationId/ranks/:key",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "rank:manage",
      }),
    ],
    schema: {
      params: z.object({ organizationId: z.uuid(), key: z.text() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ranks.delete(params.organizationId, params.key, user);
      return { ok: true };
    },
  });

  public readonly assignOrganizationRank = $action({
    method: "PUT",
    path: "/organizations/:organizationId/ranks/assignments/:userId",
    use: [
      $ownsOrganization({
        param: "organizationId",
        requires: "member:manage",
      }),
    ],
    schema: {
      params: z.object({
        organizationId: z.uuid(),
        userId: z.uuid(),
      }),
      body: z.object({ key: z.text({ minLength: 1, maxLength: 64 }) }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.ranks.assign(
        params.organizationId,
        params.userId,
        body.key,
        user,
      );
      return { ok: true };
    },
  });
}
