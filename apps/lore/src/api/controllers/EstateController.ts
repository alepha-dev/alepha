import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { estates } from "../entities/estates.ts";
import { cloudflareTokenSchema } from "../schemas/cloudflareCredentialSchema.ts";
import { createEstateBodySchema } from "../schemas/createEstateBodySchema.ts";
import {
  type EstateResource,
  estateResourceSchema,
  type MintedEstate,
  mintedEstateSchema,
} from "../schemas/estateResourceSchema.ts";
import {
  type OwnedEstateResource,
  ownedEstateResourceSchema,
} from "../schemas/ownedEstateResourceSchema.ts";
import { EstateCloudflareService } from "../services/EstateCloudflareService.ts";
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
 * Both types are created here, and the difference is what a credential is.
 * A `bay` secret is one Lore mints and hands back once, so it is rotated; a
 * `cloudflare` token is one its owner pastes, so it is checked, sealed and
 * replaced. Neither is ever readable again, the owner included.
 */
export class EstateController {
  protected readonly estates = $repository(estates);
  protected readonly service = $inject(EstateService);
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly cloudflare = $inject(EstateCloudflareService);
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
   * Enrol a deploy destination.
   *
   * Two shapes behind one route (`createEstateBodySchema`): a `bay` estate,
   * whose secret Lore mints and hands back exactly once, or a `cloudflare`
   * estate, whose token the owner pastes and Lore checks before writing
   * anything. Both go through `EstateService`, shared with the
   * create-from-inside-a-project flow (#1837), so the two entry points
   * cannot disagree about normalisation, uniqueness or the audit row.
   *
   * ⚠️ `secret` is present only when Lore minted one, so it is **absent** on
   * a cloudflare create rather than empty. That is what #1865's "the reveal
   * dialog does not open" rests on: an absent field, not a falsy string.
   */
  createEstate = $action({
    use: [$secure({ permissions: ["estate:create"] })],
    method: "POST",
    path: "/estates",
    schema: {
      body: createEstateBodySchema,
      response: mintedEstateSchema,
    },
    handler: async ({ body, user }) => {
      if (body.type === "cloudflare") {
        const { estate } = await this.service.createCloudflare(user, body);
        return this.service.toResource(estate);
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
      // A cloudflare estate has no machine and no socket, so there is
      // nothing to tell: offering the transport a row it can never reach
      // would queue a push against an estate that has no connector.
      if (
        updated.type === "bay" &&
        (body.deployAllowed !== undefined ||
          body.statsIntervalSeconds !== undefined)
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
          "Only a bay estate holds a secret Lore minted; replace a cloudflare token with POST /estates/:estateId/credential",
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
   * Replace the token on a cloudflare estate.
   *
   * Write-only: there is no GET that returns the token and no PATCH that
   * carries it, so replacing is never a read-modify-write through the
   * client. Checked before it is written and **all or nothing** on a
   * failure, so the token the owner already had keeps working when the new
   * one does not (#1630).
   *
   * Audited as `rotate`, the verb `LoreAudits.estate` already declares, with
   * the same `warning` severity as the bay rotation: "when was this
   * credential last changed" is one question, whichever kind it was. The UI
   * says "Replace token"; the Activity filter does not grow a verb.
   */
  replaceEstateCredential = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/credential",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      body: z.object({ token: cloudflareTokenSchema }),
      response: estateResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.service.loadOwned(params.estateId, user);
      const replaced = await this.service.replaceCredential(
        user,
        estate,
        body.token,
      );
      return this.service.toResource(replaced);
    },
  });

  /**
   * Ask Cloudflare again, now, and record what it said.
   *
   * The owner's own button, for the case the nightly sweep would otherwise
   * answer up to a day later: they have just widened a token at Cloudflare
   * and want the estate to agree. An inconclusive answer leaves the row
   * untouched and says so, exactly as the sweep does.
   */
  checkEstateCredential = $action({
    use: [$secure({ permissions: ["estate:update"] })],
    method: "POST",
    path: "/estates/:estateId/credential/check",
    schema: {
      params: z.object({ estateId: z.uuid() }),
      response: estateResourceSchema,
    },
    handler: async ({ params, user }) => {
      const estate = await this.service.loadOwned(params.estateId, user);
      if (estate.type !== "cloudflare") {
        throw new BadRequestError(
          "Only a cloudflare estate has a token to check",
        );
      }

      const check = await this.cloudflare.recheck(estate);
      if (check.outcome === "inconclusive") {
        // No verdict, so no row change and no pretending otherwise: the
        // drawer shows this sentence and the estate keeps the status it
        // had.
        throw new BadRequestError(check.message);
      }

      return this.service.toResource(
        await this.service.loadOwned(params.estateId, user),
      );
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
