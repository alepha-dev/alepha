import { $inject, Alepha, z } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import { ServerCookiesProvider } from "alepha/server/cookies";

import { type UserDock, userDocks } from "../entities/userDocks.ts";
import { DockFullError } from "../errors/DockFullError.ts";
import { coreRelations } from "../relations/coreRelations.ts";
import { USER_DOCK_CAP } from "../schemas/userDockCap.ts";

/**
 * A project as the dock needs it: enough to filter and to seed.
 */
export interface DockProject {
  id: number;
  updatedAt: string;
  archivedAt?: string | null;
}

/**
 * What a pin did: `pinned` is whether the project is on the dock now, `full`
 * whether it was refused for want of a slot.
 */
export interface DockPinOutcome {
  pinned: boolean;
  full: boolean;
}

/**
 * Each user's dock of pinned projects (#E139, #Q3434): one `user_docks` row,
 * an ordered array of project ids, at most {@link USER_DOCK_CAP}.
 *
 * Every write is one row write, so nothing needs a transaction on D1.
 *
 * ## Reads are filtered, writes are not
 *
 * {@link UserDockService.read} drops every id that is no longer a membership
 * or whose project is archived, so a deleted or archived project is never
 * drawn. That is a safety net only: the unpin that frees the slot is a write
 * (leave, removal, archive), because unarchiving must not pin a project back.
 */
export class UserDockService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly cookies = $inject(ServerCookiesProvider);
  protected readonly docks = $repository(userDocks);
  protected readonly members = $repository(organizationMembers);
  protected readonly usersWith = $repository(coreRelations, "users");

  /**
   * The cookie the rail kept its order in before the dock (#Q3366): the ids
   * this browser opened last. Read once, by the seed, then deleted.
   */
  protected readonly legacyCookie = "lor.user.recentProjects";

  /**
   * The caller's dock, in order, narrowed to live memberships of unarchived
   * projects. Seeds the row on the first call.
   *
   * `projects` is the caller's membership list when the caller already has
   * it (the Home overview does), to spare a second read.
   */
  public async read(
    userId: string,
    projects?: DockProject[],
  ): Promise<number[]> {
    const memberOf = projects ?? (await this.memberProjects(userId));
    const row = await this.ensure(userId, memberOf);
    return this.visible(row.projectIds, memberOf);
  }

  /**
   * Pin a project at the end of the dock. A project already pinned stays
   * where it is; one the user is not a member of, or that is archived, is
   * refused (400). With the dock full, nothing is written and `full` says so;
   * `strict` turns that into a {@link DockFullError}.
   */
  public async pin(
    userId: string,
    projectId: number,
    options: { strict?: boolean } = {},
  ): Promise<DockPinOutcome> {
    const memberOf = await this.memberProjects(userId);
    const row = await this.ensure(userId, memberOf);
    const live = this.visible(row.projectIds, memberOf);
    if (live.includes(projectId)) {
      return { pinned: true, full: false };
    }
    if (this.visible([projectId], memberOf).length === 0) {
      throw new BadRequestError(`Not a project you can pin: ${projectId}.`);
    }
    if (live.length >= USER_DOCK_CAP) {
      if (options.strict) {
        throw new DockFullError({ cap: USER_DOCK_CAP });
      }
      return { pinned: false, full: true };
    }
    // The stale ids go with this write: the row is being rewritten anyway,
    // and a slot a deleted project held is a slot the cap must not count.
    await this.write(row, [...live, projectId]);
    return { pinned: true, full: false };
  }

  /**
   * Take a project off the dock. A no-op when it is not on it.
   */
  public async unpin(userId: string, projectId: number): Promise<void> {
    const row = await this.docks.findOne({
      where: { userId: { eq: userId } },
    });
    if (!row || !row.projectIds.includes(projectId)) {
      return;
    }
    await this.write(
      row,
      row.projectIds.filter((it) => it !== projectId),
    );
  }

  /**
   * Take a project off every member's dock: archiving frees the slot of
   * everyone who had it pinned (#Q3436). Bounded by the member count.
   */
  public async unpinForMembers(
    organizationId: string,
    projectId: number,
  ): Promise<void> {
    const memberships = await this.members.findMany({
      where: { organizationId: { eq: organizationId } },
      columns: ["userId"],
    });
    for (const membership of memberships) {
      await this.unpin(membership.userId, projectId);
    }
  }

  /**
   * Replace the dock's order with `projectIds`, the full ordered list.
   *
   * Refused (400) when an id is listed twice, is not a live membership of an
   * unarchived project, or the list is longer than the cap. Not required to
   * be a permutation of what is pinned: the list IS the dock afterwards.
   */
  public async reorder(
    userId: string,
    projectIds: number[],
  ): Promise<number[]> {
    if (new Set(projectIds).size !== projectIds.length) {
      throw new BadRequestError("A project may appear only once in the dock.");
    }
    if (projectIds.length > USER_DOCK_CAP) {
      throw new DockFullError({ cap: USER_DOCK_CAP });
    }
    const memberOf = await this.memberProjects(userId);
    const allowed = new Set(
      memberOf.filter((it) => !it.archivedAt).map((it) => it.id),
    );
    const unknown = projectIds.filter((it) => !allowed.has(it));
    if (unknown.length > 0) {
      throw new BadRequestError(
        `Not a project you can pin: ${unknown.join(", ")}.`,
      );
    }
    const row = await this.ensure(userId, memberOf);
    await this.write(row, projectIds);
    return projectIds;
  }

  /**
   * The ids of `ids` that are still a membership of an unarchived project,
   * in their order.
   */
  public visible(ids: number[], memberOf: DockProject[]): number[] {
    const live = new Set(
      memberOf.filter((it) => !it.archivedAt).map((it) => it.id),
    );
    return ids.filter((id) => live.has(id)).slice(0, USER_DOCK_CAP);
  }

  /**
   * The order a new dock starts with: the old rail's cookie first, in its
   * order, then every other unarchived project by `updatedAt`, newest first,
   * capped. The same order the rail drew before the dock, so nobody's rail
   * moves on the day it ships.
   */
  public seedOrder(memberOf: DockProject[], opened: number[]): number[] {
    const live = memberOf.filter((it) => !it.archivedAt);
    const byId = new Map(live.map((it) => [it.id, it]));
    const first = [...new Set(opened)].filter((id) => byId.has(id));
    const rest = live
      .filter((it) => !first.includes(it.id))
      .sort((a, b) =>
        a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0,
      )
      .map((it) => it.id);
    return [...first, ...rest].slice(0, USER_DOCK_CAP);
  }

  /**
   * The caller's row, seeding it when there is none.
   */
  protected async ensure(
    userId: string,
    memberOf: DockProject[],
  ): Promise<UserDock> {
    const existing = await this.docks.findOne({
      where: { userId: { eq: userId } },
    });
    if (existing) {
      return existing;
    }
    return this.seed(userId, memberOf);
  }

  /**
   * Create the row once, from the old rail. A concurrent first request that
   * won the race is not an error: its row is read back.
   */
  protected async seed(
    userId: string,
    memberOf: DockProject[],
  ): Promise<UserDock> {
    const opened = this.readLegacyCookie();
    try {
      const row = await this.docks.create({
        userId,
        projectIds: this.seedOrder(memberOf, opened),
        seededAt: this.dateTime.nowISOString(),
      });
      this.forgetLegacyCookie(opened);
      return row;
    } catch (error) {
      const raced = await this.docks.findOne({
        where: { userId: { eq: userId } },
      });
      if (raced) {
        return raced;
      }
      throw error;
    }
  }

  /**
   * The old rail's order, when the request carries it. Outside a request (a
   * hook, a job, a spec calling a service) there is no cookie, which reads
   * as none.
   */
  protected readLegacyCookie(): number[] {
    try {
      return (
        this.cookies.getCookie(this.legacyCookie, {
          schema: z.array(z.integer()),
          path: "/",
          prefix: false,
        }) ?? []
      );
    } catch {
      return [];
    }
  }

  /**
   * Expire the old rail's cookie once the seed has read it: nothing reads it
   * again.
   */
  protected forgetLegacyCookie(opened: number[]): void {
    if (opened.length === 0) {
      return;
    }
    try {
      this.cookies.deleteCookie(this.legacyCookie, undefined, false, {
        path: "/",
      });
    } catch (error) {
      this.log.debug("Could not expire the legacy rail cookie", { error });
    }
  }

  protected async write(row: UserDock, projectIds: number[]): Promise<void> {
    await this.docks.updateById(row.id, { projectIds });
  }

  /**
   * The caller's projects, through the membership row.
   */
  protected async memberProjects(userId: string): Promise<DockProject[]> {
    const me = await this.usersWith.findById(userId, {
      include: { projects: true },
    });
    return me?.projects ?? [];
  }
}
