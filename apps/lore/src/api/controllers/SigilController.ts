import { $inject, type Static, z } from "alepha";
import { $repository, DbConflictError } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError, NotFoundError, okSchema } from "alepha/server";
import { SIGIL_KINDS, type Sigil, sigils } from "../entities/sigils.ts";
import { CampaignSecurityService } from "../services/CampaignSecurityService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

/**
 * A sigil as the owner's Settings page sees it.
 *
 * `tokenHash` is absent and `tokenPrefix` is present, which is the whole point
 * of keeping a prefix: the UI has to be able to name a credential it can never
 * reconstruct.
 */
const sigilResourceSchema = z.object({
  id: z.uuid(),
  campaignId: z.integer(),
  app: z.string(),
  environment: z.string(),
  label: z.string(),
  /** First characters of the token — enough to name it, not to use it. */
  tokenPrefix: z.string(),
  kinds: z.array(z.string()),
  createdAt: z.string(),
  /** Last time this environment reported. Absent means never. */
  lastSeenAt: z.string().optional(),
});

export type SigilResource = Static<typeof sigilResourceSchema>;

/**
 * A sigil plus the one cleartext copy of its token that will ever exist.
 *
 * Returned by `createSigil` and `rotateSigil` only. Nothing can produce it
 * again — the column stores a hash — so a caller that drops this response has
 * to rotate.
 */
const mintedSigilSchema = sigilResourceSchema.extend({
  token: z.string(),
});

export type MintedSigil = Static<typeof mintedSigilSchema>;

/**
 * Owner-facing CRUD for sigils — one credential per application per
 * environment, which is what an app presents to `POST /sigils/ingest`.
 *
 * **Reads are member-gated, mutations owner-gated**, the same split the rest of
 * the app uses. There is deliberately no role, no allowlist and no capability
 * beyond that: anyone who owns a campaign may enrol an environment into it, and
 * a sigil grants nothing outside the two ingest routes.
 */
export class SigilController {
  protected sigils = $repository(sigils);
  protected security = $inject(CampaignSecurityService);
  protected tokens = $inject(SigilTokenService);

  /**
   * Enrol one environment of one application, and hand back its token once.
   *
   * `(campaignId, app, environment)` is unique, because the triple is the
   * identity: a second sigil for `lore` in `production` would split that
   * environment's history in two and make every aggregate wrong. A repeat is a
   * 409 rather than a silent second row, and the way to replace a credential is
   * {@link rotateSigil}.
   *
   * The duplicate is refused twice, on purpose. The `findOne` names the clash
   * in the message an operator reads; the `DbConflictError` catch covers the
   * window between that read and the insert, where a second concurrent create
   * would otherwise reach the unique index and surface as a 500. The index is
   * what actually guarantees integrity — the check is only there to explain it.
   */
  createSigil = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/sigils",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      body: z.object({
        app: z.string().min(1).max(100),
        environment: z.string().min(1).max(50),
        /** Defaults to `<app> / <environment>` — a name, not an identity. */
        label: z.string().min(1).max(200).optional(),
        /**
         * Capability buckets the ingest endpoint will accept from this sigil.
         * Omitted grants all of them; the campaign's own feature toggles are
         * what an operator normally turns things off with.
         */
        kinds: z
          .array(z.enum([...SIGIL_KINDS]).meta({ mode: "text" }))
          .max(10)
          .optional(),
      }),
      response: mintedSigilSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const app = body.app.trim();
      const environment = body.environment.trim();

      const existing = await this.sigils.findOne({
        where: {
          campaignId: { eq: params.campaignId },
          app: { eq: app },
          environment: { eq: environment },
        },
      });
      if (existing) {
        throw new ConflictError(
          `A sigil already exists for ${app} / ${environment}`,
        );
      }

      const minted = this.tokens.mint();
      try {
        const created = await this.sigils.create({
          campaignId: params.campaignId,
          app,
          environment,
          label: body.label?.trim() || `${app} / ${environment}`,
          tokenHash: minted.hash,
          tokenPrefix: minted.prefix,
          kinds: body.kinds ?? [...SIGIL_KINDS],
          createdBy: user.id,
        });

        return { ...this.toResource(created), token: minted.token };
      } catch (error) {
        if (error instanceof DbConflictError) {
          throw new ConflictError(
            await this.explainConflict(params.campaignId, app, environment),
          );
        }
        throw error;
      }
    },
  });

  /**
   * Every sigil on a campaign, newest first.
   *
   * Member-gated rather than owner-gated: the list is an inventory of which
   * environments report, which is exactly what the blights inbox's filter and
   * the insights page mean, and neither of those is owner-only.
   */
  listSigils = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/sigils",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      response: z.object({ items: z.array(sigilResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);

      const items = await this.sigils.findMany({
        where: { campaignId: { eq: params.campaignId } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });

      return { items: items.map((sigil) => this.toResource(sigil)) };
    },
  });

  /**
   * Replace a sigil's token, keeping the row and everything attached to it.
   *
   * This is what revoking a leaked credential should cost. All four aggregate
   * tables cascade on `sigilId`, so {@link deleteSigil} — the other way to make
   * a token stop working — also erases that environment's views, vitals,
   * uniques and error budget. Rotation is the same revocation without the
   * amnesia: the old token stops resolving the moment the hash changes, because
   * `SigilTokenService.verify` looks a sigil up *by* its hash.
   */
  rotateSigil = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/sigils/:sigilId/rotate",
    schema: {
      params: z.object({ campaignId: z.integer(), sigilId: z.uuid() }),
      response: mintedSigilSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const sigil = await this.loadSigil(params.campaignId, params.sigilId);

      const minted = this.tokens.mint();
      await this.sigils.updateById(sigil.id, {
        tokenHash: minted.hash,
        tokenPrefix: minted.prefix,
      });

      const rotated = await this.loadSigil(params.campaignId, params.sigilId);
      return { ...this.toResource(rotated), token: minted.token };
    },
  });

  /**
   * Remove a sigil, and with it everything that environment ever reported.
   *
   * A hard delete — the entity carries no soft-delete column, and the four
   * aggregate tables cascade. Blights survive, because `blights.sigilId` is
   * `ON DELETE SET NULL`: a triage decision outlives the credential that
   * surfaced it.
   */
  deleteSigil = $action({
    use: [$secure({ permissions: ["campaign:delete"] })],
    method: "DELETE",
    path: "/campaigns/:campaignId/sigils/:sigilId",
    schema: {
      params: z.object({ campaignId: z.integer(), sigilId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const sigil = await this.loadSigil(params.campaignId, params.sigilId);

      await this.sigils.deleteById(sigil.id);
      return { ok: true };
    },
  });

  /**
   * Works out which unique index refused the insert, and says so.
   *
   * `sigils` carries two: `(campaignId, app, environment)` and `tokenHash`.
   * `DbConflictError` does not name the one that fired, and the two mean
   * opposite things to a caller — the first says "you already have this
   * environment", the second says "try again and you will get a different
   * token". Answering the first message to the second case would send an
   * operator looking for a sigil that does not exist.
   *
   * One extra read, only on the error path.
   */
  protected async explainConflict(
    campaignId: number,
    app: string,
    environment: string,
  ): Promise<string> {
    const clash = await this.sigils.findOne({
      where: {
        campaignId: { eq: campaignId },
        app: { eq: app },
        environment: { eq: environment },
      },
    });
    return clash
      ? `A sigil already exists for ${app} / ${environment}`
      : "Could not mint a unique token for this sigil — retry.";
  }

  /**
   * Load a sigil, asserting it belongs to the campaign in the path.
   *
   * The campaign filter is the cross-campaign guard: without it, an id from
   * another campaign would resolve and the owner check would have passed on the
   * wrong campaign.
   *
   * ⚠️ The path segment is `:sigilId`, not `:id`, and that is load-bearing.
   * `/api/campaigns/:id` already exists, and the router keeps one param node per
   * position: a route naming two different segments `id` collapses both onto one
   * key, the outer one wins, and the inner param arrives missing.
   */
  protected async loadSigil(campaignId: number, id: string): Promise<Sigil> {
    const sigil = await this.sigils.findOne({
      where: { id: { eq: id }, campaignId: { eq: campaignId } },
    });
    if (!sigil) {
      throw new NotFoundError("Sigil not found");
    }
    return sigil;
  }

  /**
   * Project a row into the owner-facing resource — `tokenHash` never crosses.
   */
  protected toResource(sigil: Sigil): SigilResource {
    return {
      id: sigil.id,
      campaignId: sigil.campaignId,
      app: sigil.app,
      environment: sigil.environment,
      label: sigil.label,
      tokenPrefix: sigil.tokenPrefix,
      kinds: sigil.kinds ?? [],
      createdAt: sigil.createdAt,
      lastSeenAt: sigil.lastSeenAt,
    };
  }
}
