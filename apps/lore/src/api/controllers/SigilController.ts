import { $inject, z } from "alepha";
import { $repository, DbConflictError } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError, NotFoundError, okSchema } from "alepha/server";

import { SIGIL_KINDS, type Sigil, sigils } from "../entities/sigils.ts";
import { appNameSchema } from "../schemas/appNameSchema.ts";
import {
  type MintedSigil,
  mintedSigilSchema,
  type SigilResource,
  sigilResourceSchema,
} from "../schemas/sigilResourceSchema.ts";
import { AppService } from "../services/AppService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { SigilTokenService } from "../services/SigilTokenService.ts";

export type { MintedSigil, SigilResource };

/**
 * Owner-facing CRUD for sigils — one credential per enrolled app, which is what
 * that app presents to `POST /sigils/ingest`.
 *
 * **Reads are member-gated, mutations owner-gated**, the same split the rest of
 * the app uses. There is deliberately no role, no allowlist and no capability
 * beyond that: anyone who owns a project may enrol an app into it, and a sigil
 * grants nothing outside the two ingest routes.
 */
export class SigilController {
  protected sigils = $repository(sigils);
  protected security = $inject(ProjectSecurityService);
  protected audits = $inject(LoreAudits);
  protected tokens = $inject(SigilTokenService);
  protected apps = $inject(AppService);

  /**
   * Mint the credential one deployed copy reports with, and hand back its token
   * once.
   *
   * ⚠️ **This does not create anything an operator can see.** Since Apps v3 the
   * instance exists first (`POST /projects/:projectId/apps`) and this turns
   * telemetry ON for it: Analytics, Vitals, Errors and Explore appear the
   * moment it succeeds. That is why the body names an instance rather than
   * carrying a `name` of its own — the name is `"<app>/<env>"`, derived by
   * `AppService`, and `claimName` went with the field.
   *
   * **404 without an instance, and deliberately so.** The controller composes
   * nothing: the two places a one-step flow is wanted (the create dialog's
   * checkbox and the MCP `sigil_create` shim) call `createApp` and then this,
   * where the composition is visible. Building it in here would give a second
   * way to create an instance, which is the shape this epic removed.
   *
   * **409 when the instance already has one.** A second credential for one
   * deployed copy splits its history in two and makes every aggregate wrong;
   * replacing one is {@link rotateSigil}.
   */
  createSigil = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/sigils",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        /**
         * The instance this credential belongs to, as its two names. Both are
         * trimmed and lowercased before they are looked up, so a caller that
         * echoes what a user typed resolves the same row the URL does.
         */
        app: appNameSchema,
        env: appNameSchema,
        /**
         * Capability buckets the ingest endpoint will accept from this sigil.
         * Omitted grants all of them; the instance's own Settings tab is where
         * an operator narrows them afterwards.
         */
        kinds: z
          .array(z.enum([...SIGIL_KINDS]).meta({ mode: "text" }))
          .max(10)
          .optional(),
      }),
      response: mintedSigilSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // Gated by hand: this controller still checks membership in its handlers.
      await this.security.assertCapability(params.projectId, "apps", {
        action: "mint a sigil",
      });

      const instance = await this.apps.load(
        params.projectId,
        this.apps.normalize(body.app, "app"),
        this.apps.normalize(body.env, "environment"),
      );

      try {
        const { sigil, token } = await this.apps.createSigil(instance, {
          kinds: body.kinds ?? [...SIGIL_KINDS],
          createdBy: user.id,
        });

        // A sigil is a credential, so its whole life is audited and kept
        // longer than the rest — see `LoreAudits`.
        await this.audits.sigil.logSuccess("create", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.projectId),
          resourceType: "sigil",
          resourceId: sigil.id,
          description: sigil.name,
        });

        return { ...this.toResource(sigil), token };
      } catch (error) {
        if (error instanceof DbConflictError) {
          // Only one index can fire here now. `(projectId, name)` is satisfied
          // by construction — the mirror is unique because `(app, env)` is —
          // so a conflict is the token hash, and the answer is "retry".
          throw new ConflictError(
            "Could not mint a unique token for this sigil — retry.",
          );
        }
        throw error;
      }
    },
  });

  /**
   * Every sigil on a project, newest first.
   *
   * Member-gated rather than owner-gated: the list is an inventory of which
   * apps report, which is exactly what the blights inbox's filter and the
   * insights page mean, and neither of those is owner-only.
   */
  listSigils = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/sigils",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(sigilResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const items = await this.sigils.findMany({
        where: { projectId: { eq: params.projectId } },
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
   * a token stop working — also erases that app's views, vitals, uniques and
   * error budget. Rotation is the same revocation without the
   * amnesia: the old token stops resolving the moment the hash changes, because
   * `SigilTokenService.verify` looks a sigil up *by* its hash.
   */
  rotateSigil = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/sigils/:sigilId/rotate",
    schema: {
      params: z.object({ projectId: z.integer(), sigilId: z.uuid() }),
      response: mintedSigilSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // Gated by hand: this controller still checks membership in its handlers.
      await this.security.assertCapability(params.projectId, "apps", {
        action: "rotate a sigil",
      });
      const sigil = await this.loadSigil(params.projectId, params.sigilId);

      const minted = await this.tokens.mint(params.projectId);
      await this.sigils.updateById(sigil.id, {
        tokenHash: minted.hash,
        tokenPrefix: minted.prefix,
      });

      const rotated = await this.loadSigil(params.projectId, params.sigilId);

      // The one UPDATE in the audit set: rotating is what revoking a leaked
      // token looks like, and "when was this rotated" is the question asked
      // after the leak is found.
      await this.audits.sigil.logSuccess("rotate", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        severity: "warning",
        resourceType: "sigil",
        resourceId: sigil.id,
        description: sigil.name,
      });

      return { ...this.toResource(rotated), token: minted.token };
    },
  });

  /**
   * Change what this app is allowed to report.
   *
   * The one write path `sigils.kinds` has ever had. Before it, `kinds` was set
   * at creation and never again, which is why {@link SigilIngestService.gatesFor}
   * had to intersect it with the project's own feature flags to give an owner
   * any lever at all — a lever that necessarily applied to every app at once.
   * With this in place the kinds are the lever, per app, and the project flags
   * for blights / beacon / vitals are retired.
   *
   * Replaces the list rather than patching it: "what may this app report" is
   * one answer, and a partial update of a set invites two clients to disagree
   * about a member neither of them named.
   *
   * ⚠️ **`name` and `url` left this endpoint with Apps v3 (#1767).** Both
   * describe the deployed copy rather than the credential, and both moved onto
   * `app_instances`: the address is `AppService.setUrl`, and the name is a
   * server-written mirror of `"<app>/<env>"` that only `AppService.rename`
   * writes. A second writer for that column would let the mirror drift from the
   * instance it names, which every label in the blights inbox and the insights
   * dimension reads.
   *
   * Owner-only, like rotate and delete — a member may read the inventory but
   * not re-arm it.
   */
  updateSigil = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "PATCH",
    path: "/projects/:projectId/sigils/:sigilId",
    schema: {
      params: z.object({ projectId: z.integer(), sigilId: z.uuid() }),
      body: z.object({
        kinds: z
          .array(z.enum([...SIGIL_KINDS]).meta({ mode: "text" }))
          .max(SIGIL_KINDS.length)
          .optional(),
      }),
      response: sigilResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // Gated by hand: this controller still checks membership in its handlers.
      await this.security.assertCapability(params.projectId, "apps", {
        action: "update a sigil",
      });
      const sigil = await this.loadSigil(params.projectId, params.sigilId);

      // Still shaped as an optional field, so an omitted key means "leave it
      // alone" rather than "clear it", and so the endpoint can grow a second
      // one without changing what a caller sending only `kinds` means.
      await this.sigils.updateById(
        sigil.id,
        body.kinds ? { kinds: [...new Set(body.kinds)] } : {},
      );

      return this.toResource(
        await this.loadSigil(params.projectId, params.sigilId),
      );
    },
  });

  /**
   * Remove a sigil, and with it everything that app ever reported.
   *
   * A hard delete — the entity carries no soft-delete column, and the four
   * aggregate tables cascade. Blights survive, because `blights.sigilId` is
   * `ON DELETE SET NULL`: a triage decision outlives the credential that
   * surfaced it.
   */
  deleteSigil = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    method: "DELETE",
    path: "/projects/:projectId/sigils/:sigilId",
    schema: {
      params: z.object({ projectId: z.integer(), sigilId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // Gated by hand: this controller still checks membership in its handlers.
      await this.security.assertCapability(params.projectId, "apps", {
        action: "delete a sigil",
      });
      const sigil = await this.loadSigil(params.projectId, params.sigilId);

      await this.sigils.deleteById(sigil.id);

      // Deleting takes every analytics row with it (all four tables cascade
      // on `sigilId`), which is why rotate exists and why this is a warning.
      await this.audits.sigil.logSuccess("delete", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        severity: "warning",
        resourceType: "sigil",
        resourceId: sigil.id,
        description: sigil.name,
      });

      return { ok: true };
    },
  });

  /**
   * Load a sigil, asserting it belongs to the project in the path.
   *
   * The project filter is the cross-project guard: without it, an id from
   * another project would resolve and the owner check would have passed on the
   * wrong project.
   *
   * ⚠️ The path segment is `:sigilId`, not `:id`, and that is load-bearing.
   * `/api/projects/:id` already exists, and the router keeps one param node per
   * position: a route naming two different segments `id` collapses both onto one
   * key, the outer one wins, and the inner param arrives missing.
   */
  protected async loadSigil(projectId: number, id: string): Promise<Sigil> {
    const sigil = await this.sigils.findOne({
      where: { id: { eq: id }, projectId: { eq: projectId } },
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
      projectId: sigil.projectId,
      name: sigil.name,
      tokenPrefix: sigil.tokenPrefix,
      kinds: sigil.kinds ?? [],
      url: sigil.url,
      createdAt: sigil.createdAt,
      lastSeenAt: sigil.lastSeenAt,
      lastSeenHost: sigil.lastSeenHost,
      reportedConfig: sigil.reportedConfig,
      reportedConfigAt: sigil.reportedConfigAt,
    };
  }
}
