import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import { type Estate, type EstateType, estates } from "../entities/estates.ts";
import {
  type EstateResource,
  estateResourceSchema,
} from "../schemas/estateResourceSchema.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "../schemas/estateSlugSchema.ts";

/**
 * What an estate IS, stated once: which runtimes its type runs, when it
 * counts as online, what may be read off it, and what stands in the way of
 * deleting it.
 *
 * The rules here are the ones folio #1194 fixed on 2026-09-04, and the
 * controller, the admin backstop (#1838), the lending (#1837) and epic #1's
 * environments (#1810) all read them from here rather than restating them.
 */
export class EstateService {
  protected readonly estates = $repository(estates);
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
   * Projects a row into what a reader may see. `secretHash` never crosses:
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
   * What an account deletion takes with it, for the confirmation dialog.
   *
   * `projects` is how many projects lose a deploy destination, which #1837
   * fills in from the lending join; until then it is zero, and it is stated
   * as a number rather than omitted so the dialog's shape does not change.
   */
  async countOwned(
    userId: string,
  ): Promise<{ estates: number; projects: number }> {
    return {
      estates: await this.estates.count({ ownerUserId: { eq: userId } }),
      projects: 0,
    };
  }
}
