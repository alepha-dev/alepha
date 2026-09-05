import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { ESTATE_TYPES, estates } from "../entities/estates.ts";
import {
  type EstateResource,
  estateResourceSchema,
  type MintedEstate,
  mintedEstateSchema,
} from "../schemas/estateResourceSchema.ts";
import { estateSlugSchema } from "../schemas/estateSlugSchema.ts";
import {
  type OwnedEstateResource,
  ownedEstateResourceSchema,
} from "../schemas/ownedEstateResourceSchema.ts";
import { EstateCommandTransport } from "../services/EstateCommandTransport.ts";
import { EstateService } from "../services/EstateService.ts";
import { EstateTokenService } from "../services/EstateTokenService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";

export type { EstateResource, MintedEstate, OwnedEstateResource };

/**
 * Owner-facing CRUD for estates: the deploy destinations a user owns, across
 * every project, managed from `/account/estates`.
 *
 * Every route here is scoped to the caller's own rows. There is no member
 * view and no project in the path: what a project may do with an estate it
 * has been lent is the lending's business (#1837), and the instance-wide
 * backstop is the admin's (#1838). Both read the same masked resource, and
 * neither can read a secret, the owner included.
 *
 * `bay` is the only type this controller can create or rotate. The
 * `cloudflare` variant arrives with epic #22 and is refused by name until
 * then, so the discriminator is live without the row ever holding a
 * credential this code does not know how to seal.
 */
export class EstateController {
  protected readonly estates = $repository(estates);
  protected readonly service = $inject(EstateService);
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly transport = $inject(EstateCommandTransport);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Every estate the caller owns, newest first, each with the projects it
   * is lent to: the one fact the owner's page needs that the row does not
   * hold (#1838).
   */
  listMyEstates = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates",
    schema: {
      response: z.object({ items: z.array(ownedEstateResourceSchema) }),
    },
    handler: async ({ user }) => {
      const items = await this.estates.findMany({
        where: { ownerUserId: { eq: user.id } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      return { items: await this.service.withLoans(items) };
    },
  });

  /**
   * Enrol a machine, and hand back its secret once.
   *
   * The minting itself is `EstateService.createBay`, shared with the
   * create-from-inside-a-project flow (#1837), so the two cannot disagree
   * about normalisation, uniqueness or the audit row.
   */
  createEstate = $action({
    use: [$secure({ permissions: ["estate:create"] })],
    method: "POST",
    path: "/estates",
    schema: {
      body: z.object({
        slug: estateSlugSchema,
        label: z.string().max(100).optional(),
        /**
         * Omitted means `bay`, the only type this epic implements.
         */
        type: z.enum(ESTATE_TYPES).meta({ mode: "text" }).optional(),
      }),
      response: mintedEstateSchema,
    },
    handler: async ({ body, user }) => {
      const type = body.type ?? "bay";
      if (type !== "bay") {
        throw new BadRequestError(
          "Cloudflare estates are not available yet; only bay estates can be created",
        );
      }

      const { estate, secret } = await this.service.createBay(user, body);
      return { ...this.service.toResource(estate), secret };
    },
  });

  getEstate = $action({
    use: [$secure({ permissions: ["estate:read"] })],
    method: "GET",
    path: "/estates/:estateId",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      response: estateResourceSchema,
    },
    handler: async ({ params, user }) =>
      this.service.toResource(
        await this.service.loadOwned(params.estateId, user),
      ),
  });

  /**
   * Change the label or the switches. An omitted key means leave it alone.
   *
   * ⚠️ There is no `slug` here, and that is the rename rule: the slug is an
   * identifier a config may record, so it is never writable after creation.
   * A `slug` in the body is stripped by the schema rather than refused,
   * because the label is what a rename is.
   */
  updateEstate = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "PATCH",
    path: "/estates/:estateId",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      body: z.object({
        label: z.string().max(100).optional(),
        collectSeries: z.boolean().optional(),
        deployAllowed: z.boolean().optional(),
        statsIntervalSeconds: z.integer().min(60).max(86_400).optional(),
      }),
      response: estateResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.service.loadOwned(params.estateId, user);

      await this.estates.updateById(estate.id, {
        ...(body.label === undefined
          ? {}
          : { label: body.label.trim() || null }),
        ...(body.collectSeries === undefined
          ? {}
          : { collectSeries: body.collectSeries }),
        ...(body.deployAllowed === undefined
          ? {}
          : { deployAllowed: body.deployAllowed }),
        ...(body.statsIntervalSeconds === undefined
          ? {}
          : { statsIntervalSeconds: body.statsIntervalSeconds }),
      });

      await this.audits.estate.logSuccess("update", {
        ...this.audits.actor(user),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
        metadata: { fields: Object.keys(body) },
      });

      const updated = await this.service.loadOwned(params.estateId, user);
      // The machine caches what `welcome` told it, so a switch it acts on
      // (deploys, the gauge interval) is pushed as `config` the moment it
      // changes. Best effort: an offline machine learns it from its next
      // `welcome`, and the label is nothing the machine reads.
      if (
        body.deployAllowed !== undefined ||
        body.statsIntervalSeconds !== undefined
      ) {
        await this.transport.push(
          updated,
          this.service.welcomeFrame(updated, "config"),
        );
      }
      return this.service.toResource(updated);
    },
  });

  /**
   * Replace the secret, keeping the row and everything lent through it.
   *
   * This is what revoking a leaked secret costs. The old secret stops
   * resolving the moment the hash changes, because `EstateTokenService.verify`
   * looks the estate up BY its hash; the connector holding the old one is
   * refused on its next dial (#1782) and nothing is handed over.
   */
  rotateEstate = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/rotate",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      response: mintedEstateSchema,
    },
    handler: async ({ params, user }) => {
      const estate = await this.service.loadOwned(params.estateId, user);
      if (estate.type !== "bay") {
        throw new BadRequestError(
          "Only a bay estate holds a secret Lore minted; a cloudflare credential is replaced, not rotated",
        );
      }

      const minted = this.tokens.mint();
      await this.estates.updateById(estate.id, {
        secretHash: minted.hash,
        secretPrefix: minted.prefix,
      });

      // The one UPDATE in the audit set with a warning: rotating is what
      // revoking a leaked secret looks like, and "when was this rotated" is
      // the question asked after the leak is found.
      await this.audits.estate.logSuccess("rotate", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      const rotated = await this.service.loadOwned(params.estateId, user);
      return { ...this.service.toResource(rotated), secret: minted.secret };
    },
  });

  /**
   * Remove an estate.
   *
   * Refused while an app instance anywhere points at it
   * (`assertUnreferenced`, #1767). Deleting undeploys nothing: the VPS keeps
   * running and Lore only loses the ability to inspect, redeploy or roll
   * back, which the dialog says because the intuitive reading is the
   * opposite. For a `bay` estate the row IS the credential, so deleting it
   * revokes; the lending join cascades with it.
   */
  deleteEstate = $action({
    use: [$secure({ permissions: ["estate:delete"] })],
    method: "DELETE",
    path: "/estates/:estateId",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const estate = await this.service.loadOwned(params.estateId, user);
      await this.service.assertUnreferenced(estate.id);

      await this.estates.deleteById(estate.id);

      await this.audits.estate.logSuccess("delete", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { ok: true };
    },
  });

  /**
   * What deleting the caller's account would take with it.
   *
   * A question beside `UserDeletionHook.countMyAuthoredQuests`, for the same
   * dialog: an account deletion cascades to its estates (the deliberate
   * exception to the refuse-while-referenced rule, because it must not be
   * blockable by other people's projects), so the number is stated before
   * the click rather than discovered after it.
   */
  countMyEstates = $action({
    use: [$secure()],
    method: "GET",
    path: "/users/me/estates",
    description:
      "How many estates the caller owns, and how many projects they are lent to",
    schema: {
      response: z.object({ estates: z.integer(), projects: z.integer() }),
    },
    handler: async ({ user }) => this.service.countOwned(user.id),
  });
}
