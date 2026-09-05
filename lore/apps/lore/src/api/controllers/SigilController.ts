import { $inject, z } from "alepha";
import { $repository, DbConflictError } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ConflictError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { SIGIL_KINDS, type Sigil, sigils } from "../entities/sigils.ts";
import { APP_NAME_PATTERN, appNameSchema } from "../schemas/appNameSchema.ts";
import {
  type MintedSigil,
  mintedSigilSchema,
  type SigilResource,
  sigilResourceSchema,
} from "../schemas/sigilResourceSchema.ts";
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

  /**
   * Enrol an app, and hand back its token once.
   *
   * `(projectId, name)` is unique, because the name is the identity: a second
   * sigil called `lore` would split that app's history in two and make every
   * aggregate wrong. A repeat is a 409 rather than a silent second row, and the
   * way to replace a credential is {@link rotateSigil}.
   *
   * The duplicate is refused twice, on purpose. The `findOne` names the clash
   * in the message an operator reads; the `DbConflictError` catch covers the
   * window between that read and the insert, where a second concurrent create
   * would otherwise reach the unique index and surface as a 500. The index is
   * what actually guarantees integrity — the check is only there to explain it.
   */
  createSigil = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/sigils",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        /**
         * Display name of the app, and its URL segment. Unique within the
         * project. Trimmed and lowercased before it is validated.
         */
        name: appNameSchema,
        /**
         * Capability buckets the ingest endpoint will accept from this sigil.
         * Omitted grants all of them; the project's own feature toggles are
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
      await this.security.assertOwner(params.projectId, user);

      const name = await this.claimName(params.projectId, body.name);

      const minted = await this.tokens.mint(params.projectId);
      try {
        const created = await this.sigils.create({
          projectId: params.projectId,
          name,
          tokenHash: minted.hash,
          tokenPrefix: minted.prefix,
          kinds: body.kinds ?? [...SIGIL_KINDS],
          createdBy: user.id,
        });

        // A sigil is a credential, so its whole life is audited and kept
        // longer than the rest — see `LoreAudits`.
        await this.audits.sigil.logSuccess("create", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.projectId),
          resourceType: "sigil",
          resourceId: created.id,
          description: created.name,
        });

        return { ...this.toResource(created), token: minted.token };
      } catch (error) {
        if (error instanceof DbConflictError) {
          throw new ConflictError(
            await this.explainConflict(params.projectId, name),
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
   * Works out which unique index refused the insert, and says so.
   *
   * `sigils` carries two: `(projectId, name)` and `tokenHash`.
   * `DbConflictError` does not name the one that fired, and the two mean
   * opposite things to a caller — the first says "you already have this app",
   * the second says "try again and you will get a different token". Answering
   * the first message to the second case would send an operator looking for a
   * sigil that does not exist.
   *
   * One extra read, only on the error path.
   */
  protected async explainConflict(
    projectId: number,
    name: string,
  ): Promise<string> {
    const clash = await this.sigils.findOne({
      where: {
        projectId: { eq: projectId },
        name: { eq: name },
      },
    });
    return clash
      ? `A sigil already exists named "${name}"`
      : "Could not mint a unique token for this sigil — retry.";
  }

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
  /**
   * Normalises an app name, checks it, and proves it is free.
   *
   * Shared by enrolment and rename because the two must agree: a name that
   * could not be created must not be reachable by renaming into it, and the
   * normalisation has to be identical or `Lore-Staging` would enrol as
   * `lore-staging` and rename to something else.
   *
   * Normalised BEFORE it is validated. `appNameSchema` is `min(1).max(64)` and
   * carries no pattern on purpose, so `"   "` passes the schema; without the
   * trim it would reach the write as an empty name and fail the entity's own
   * validation as a 500 rather than the 400 it is. Lowercasing rather than
   * refusing is deliberate too: the name is a URL segment, and the case is not
   * a distinction an operator means to draw.
   *
   * `exclude` is the sigil being renamed, so renaming an app to the name it
   * already has is a no-op rather than a collision with itself.
   */
  protected async claimName(
    projectId: number,
    raw: string,
    exclude?: string,
  ): Promise<string> {
    const name = raw.trim().toLowerCase();
    if (!APP_NAME_PATTERN.test(name)) {
      throw new BadRequestError(
        "An app name may only contain lowercase letters, digits and hyphens, and must start and end with a letter or digit",
      );
    }

    const existing = await this.sigils.findOne({
      where: { projectId: { eq: projectId }, name: { eq: name } },
    });
    if (existing && existing.id !== exclude) {
      throw new ConflictError(`A sigil already exists named "${name}"`);
    }
    return name;
  }

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
