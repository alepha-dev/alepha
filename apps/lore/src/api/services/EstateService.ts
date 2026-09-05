import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, type EstateType, estates } from "../entities/estates.ts";
import { projects } from "../entities/projects.ts";
import {
  type EstateResource,
  estateResourceSchema,
} from "../schemas/estateResourceSchema.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "../schemas/estateSlugSchema.ts";
import {
  ESTATE_PROTOCOL_VERSION,
  type EstateWelcomeFrame,
} from "../schemas/estateWelcomeFrameSchema.ts";
import type { OwnedEstateResource } from "../schemas/ownedEstateResourceSchema.ts";
import { EstateTokenService } from "./EstateTokenService.ts";
import { LoreAudits } from "./LoreAudits.ts";

/**
 * What an estate IS, stated once: which runtimes its type runs, when it
 * counts as online, what may be read off it, how one is minted, and what
 * stands in the way of deleting it.
 *
 * The rules here are the ones folio #1194 fixed on 2026-09-04, and the
 * owner's controller, the project-side lending (#1837), the admin backstop
 * (#1838) and epic #1's environments (#1810) all read them from here rather
 * than restating them.
 */
export class EstateService {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The runtimes an estate of this type can run, which is what epic #1's
   * runtime gate (#1598) refuses an artifact against.
   *
   * A property of the type, not of the row: a `bay` runs a Node process, a
   * `cloudflare` account runs a Worker, and nothing an owner can set changes
   * either.
   */
  acceptedRuntimes(type: EstateType): string[] {
    return type === "bay" ? ["node"] : ["workerd"];
  }

  /**
   * Whether the machine is connected right now, from the row's stamps.
   *
   * `connectedAt > disconnectedAt` says a connection opened and has not been
   * seen closing. That alone is not enough: the Durable Object hosting the
   * socket can lose the close event, so the second clause requires a frame
   * within twice the stats interval, which is the longest a healthy
   * connection stays silent. A machine that stopped pushing is offline
   * whatever the first clause says.
   */
  isOnline(estate: Estate, now = this.dateTime.nowMillis()): boolean {
    if (!estate.connectedAt) {
      return false;
    }
    const connected = Date.parse(estate.connectedAt);
    const disconnected = estate.disconnectedAt
      ? Date.parse(estate.disconnectedAt)
      : 0;
    if (!(connected > disconnected)) {
      return false;
    }
    const seen = estate.lastSeenAt ? Date.parse(estate.lastSeenAt) : connected;
    return now - seen <= estate.statsIntervalSeconds * 2 * 1000;
  }

  /**
   * What a machine is told about its estate: the `welcome` on connect and
   * the `config` on every switch change, same fields, wire format v1.
   */
  welcomeFrame(
    estate: Estate,
    type: EstateWelcomeFrame["type"],
  ): EstateWelcomeFrame {
    return {
      type,
      protocol: ESTATE_PROTOCOL_VERSION,
      estate: { id: estate.id, slug: estate.slug },
      deployAllowed: estate.deployAllowed,
      statsIntervalSeconds: estate.statsIntervalSeconds,
    };
  }

  /**
   * Projects a row into what its owner may see. `secretHash` never crosses:
   * the resource schema omits it and parsing strips it, so no future field
   * added to the row reaches a browser by accident.
   */
  toResource(estate: Estate): EstateResource {
    return estateResourceSchema.parse({
      ...estate,
      online: this.isOnline(estate),
      acceptedRuntimes: this.acceptedRuntimes(estate.type),
    });
  }

  /**
   * Mints a `bay` estate for its owner, and hands back the only cleartext
   * copy of its secret that will ever exist.
   *
   * One path for the account page and for "create it from inside a project"
   * (#1837), so the two cannot disagree about normalisation, uniqueness or
   * the audit row. `(ownerUserId, slug)` is unique: the `findOne` in
   * {@link claimSlug} names the clash in a message the owner reads, and the
   * `DbConflictError` catch covers the window between that read and the
   * insert. The index guarantees integrity; the check explains it.
   */
  async createBay(
    user: UserAccountToken,
    input: { slug: string; label?: string },
  ): Promise<{ estate: Estate; secret: string }> {
    const slug = await this.claimSlug(user.id, input.slug);
    const minted = this.tokens.mint();
    try {
      const estate = await this.estates.create({
        ownerUserId: user.id,
        type: "bay",
        slug,
        label: input.label?.trim() || undefined,
        secretHash: minted.hash,
        secretPrefix: minted.prefix,
      });

      // An estate is a credential, so its whole life is audited and kept
      // longer than the rest, see `LoreAudits`.
      await this.audits.estate.logSuccess("create", {
        ...this.audits.actor(user),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { estate, secret: minted.secret };
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(await this.explainConflict(user.id, slug));
      }
      throw error;
    }
  }

  /**
   * Normalises a slug, then checks it.
   *
   * Normalised BEFORE it is validated, like an app name: `estateSlugSchema`
   * carries the length only, so `"  OVH-1 "` reaches this as typed and
   * leaves as `ovh-1`. Lowercasing rather than refusing is deliberate, since
   * the case is not a distinction anyone means.
   */
  normalizeSlug(raw: string): string {
    const slug = raw.trim().toLowerCase();
    if (
      !slug ||
      slug.length > ESTATE_SLUG_MAX_LENGTH ||
      !ESTATE_SLUG_PATTERN.test(slug)
    ) {
      throw new BadRequestError(
        "An estate slug is lowercase letters, digits and hyphens, like ovh-1",
      );
    }
    return slug;
  }

  /**
   * Loads an estate the caller owns, or answers as if it did not exist.
   *
   * The owner filter is the whole access rule: a non-owner gets the same 404
   * an unknown id gets, so nothing about another user's estates can be
   * learned by guessing ids. There is no per-estate role to check beyond
   * this; the project is the permission boundary, not the estate.
   */
  async loadOwned(estateId: string, user: UserAccountToken): Promise<Estate> {
    const estate = await this.estates.findOne({
      where: { id: { eq: estateId }, ownerUserId: { eq: user.id } },
    });
    if (!estate) {
      throw new NotFoundError("Estate not found");
    }
    return estate;
  }

  /**
   * Refuses to delete an estate, or detach it from a project, while an
   * environment points at it.
   *
   * ⚠️ A seam today. No `environments` table exists yet (epic #1, #1810), so
   * nothing can point at an estate and this refuses nothing. #1810 extends
   * it with the real count and the message naming the environments. The
   * rule it will enforce, from folio #1194: never cascade, because cascading
   * silently breaks other people's projects, while refusing forces a visible
   * repoint or removal in each one.
   *
   * With a `projectId` the question is narrower: only that project's
   * environments block a detach. Without one, any environment anywhere
   * blocks a delete.
   *
   * The one deliberate exception is a user account deletion, which cascades
   * through `estates.ownerUserId` without passing here: account deletion
   * must not be blockable by other people's projects.
   */
  async assertUnreferenced(
    estateId: string,
    projectId?: number,
  ): Promise<void> {
    void estateId;
    void projectId;
  }

  /**
   * What an account deletion takes with it, for the confirmation dialog:
   * the estates the account owns, and how many projects lose a deploy
   * destination when they go.
   */
  /**
   * The owner's list with the projects each estate is lent to (#1838).
   *
   * Two queries for the whole list, never one per row. A project deleted
   * since the loan is left out by the repository's own soft-delete filter,
   * and its grant is left alone: the row cascades when the project is
   * really gone, and until then the loan is not the owner's to see.
   */
  async withLoans(owned: Estate[]): Promise<OwnedEstateResource[]> {
    if (owned.length === 0) {
      return [];
    }
    const grants = await this.grants.findMany({
      where: { estateId: { inArray: owned.map((estate) => estate.id) } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    const projectIds = [...new Set(grants.map((grant) => grant.projectId))];
    const rows = projectIds.length
      ? await this.projects.findMany({
          where: { id: { inArray: projectIds } },
          columns: ["id", "title", "slug"],
        })
      : [];
    const named = new Map(rows.map((project) => [project.id, project]));

    return owned.map((estate) => ({
      ...this.toResource(estate),
      projects: grants
        .filter((grant) => grant.estateId === estate.id)
        .flatMap((grant) => {
          const project = named.get(grant.projectId);
          return project
            ? [
                {
                  id: project.id,
                  title: project.title,
                  ...(project.slug ? { slug: project.slug } : {}),
                  lentAt: String(grant.createdAt),
                },
              ]
            : [];
        }),
    }));
  }

  async countOwned(
    userId: string,
  ): Promise<{ estates: number; projects: number }> {
    const owned = await this.estates.findMany({
      where: { ownerUserId: { eq: userId } },
    });
    if (owned.length === 0) {
      return { estates: 0, projects: 0 };
    }
    const grants = await this.grants.findMany({
      where: { estateId: { inArray: owned.map((estate) => estate.id) } },
    });
    return {
      estates: owned.length,
      projects: new Set(grants.map((grant) => grant.projectId)).size,
    };
  }

  /**
   * Normalises a slug and proves it is free for this owner.
   */
  protected async claimSlug(ownerUserId: string, raw: string): Promise<string> {
    const slug = this.normalizeSlug(raw);
    const clash = await this.estates.findOne({
      where: { ownerUserId: { eq: ownerUserId }, slug: { eq: slug } },
    });
    if (clash) {
      throw new ConflictError(`You already have an estate named "${slug}"`);
    }
    return slug;
  }

  /**
   * Works out which unique index refused the insert, and says so.
   *
   * `estates` carries two: `(ownerUserId, slug)` and `secretHash`. The first
   * says "you already have this estate", the second says "try again and you
   * will get a different secret", and answering the first to the second case
   * would send an owner looking for an estate that does not exist.
   */
  protected async explainConflict(
    ownerUserId: string,
    slug: string,
  ): Promise<string> {
    const clash = await this.estates.findOne({
      where: { ownerUserId: { eq: ownerUserId }, slug: { eq: slug } },
    });
    return clash
      ? `You already have an estate named "${slug}"`
      : "Could not mint a unique secret for this estate, retry.";
  }
}
