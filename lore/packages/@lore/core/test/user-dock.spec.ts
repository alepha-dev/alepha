import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { UserDockController } from "../src/api/controllers/UserDockController.ts";
import { userDocks } from "../src/api/entities/userDocks.ts";
import { DockFullError } from "../src/api/errors/DockFullError.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { USER_DOCK_CAP } from "../src/api/schemas/userDockCap.ts";
import { UserDockService } from "../src/api/services/UserDockService.ts";
import {
  CoreTestEntities,
  createTestMember,
  createTestProject,
} from "../src/testing/index.ts";

class DockEntities extends CoreTestEntities {
  docks = $repository(userDocks);
}

interface Ctx {
  alepha: Alepha;
  repos: DockEntities;
  dock: UserDockService;
  api: UserDockController;
  projects: ProjectController;
  user: UserAccountToken;
}

const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);
  const repos = alepha.inject(DockEntities);
  await alepha.start();
  const me = await repos.users.create({});
  return {
    alepha,
    repos,
    dock: alepha.inject(UserDockService),
    api: alepha.inject(UserDockController),
    projects: alepha.inject(ProjectController),
    user: { id: me.id, roles: ["user"] },
  };
};

/**
 * The dock's storage and actions (#E139, #Q3434).
 */
describe("UserDockService", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A project the caller belongs to, each one updated a minute after the
   * previous, so the seed's `updatedAt` order is the creation order.
   */
  const joined = async (title: string) => {
    await ctx.alepha.inject(DateTimeProvider).travel(60_000);
    const project = await createTestProject(ctx.alepha, {
      title: `Project ${title}`,
    });
    await createTestMember(ctx.alepha, project, ctx.user.id);
    return project;
  };

  describe("seed", () => {
    it("seeds the first read by last update, archived projects left out", async ({
      expect,
    }) => {
      const a = await joined("A");
      const b = await joined("B");
      const archived = await joined("Archived");
      await ctx.repos.projects.updateById(archived.id, {
        archivedAt: ctx.alepha.inject(DateTimeProvider).nowISOString(),
      });
      const c = await joined("C");

      expect(await ctx.dock.read(ctx.user.id)).toEqual([c.id, b.id, a.id]);
      const row = await ctx.repos.docks.findOne({
        where: { userId: { eq: ctx.user.id } },
      });
      expect(row?.projectIds).toEqual([c.id, b.id, a.id]);
    });

    it("puts the old rail's order first, then the rest by last update, capped", ({
      expect,
    }) => {
      const projects = Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        // Newest last: id 25 is the most recent.
        updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
        archivedAt: index === 24 ? "2026-02-01T00:00:00Z" : undefined,
      }));

      const order = ctx.dock.seedOrder(projects, [3, 99, 3, 25, 7]);

      // 99 is no membership and 25 is archived: both dropped, 3 kept once.
      expect(order.slice(0, 3)).toEqual([3, 7, 24]);
      expect(order).toHaveLength(USER_DOCK_CAP);
      expect(order).not.toContain(25);
    });

    it("seeds from the old rail's cookie when the request carries it, then expires it", async ({
      expect,
    }) => {
      const a = await joined("A");
      const b = await joined("B");
      const c = await joined("C");
      const res: Record<string, unknown> = {};

      const order = await ctx.alepha.context.run(() => {
        ctx.alepha.store.set("alepha.http.request", {
          cookies: {
            req: {
              "lor.user.recentProjects": encodeURIComponent(
                JSON.stringify([a.id, c.id]),
              ),
            },
            res,
          },
        } as never);
        return ctx.dock.read(ctx.user.id);
      });

      expect(order).toEqual([a.id, c.id, b.id]);
      expect(Object.keys(res)).toContain("lor.user.recentProjects");
    });

    it("never seeds twice: an emptied dock stays empty", async ({ expect }) => {
      const a = await joined("A");
      expect(await ctx.dock.read(ctx.user.id)).toEqual([a.id]);

      await ctx.dock.unpin(ctx.user.id, a.id);
      await joined("B");

      expect(await ctx.dock.read(ctx.user.id)).toEqual([]);
    });
  });

  describe("read", () => {
    it("drops ids that are no longer a membership or are archived", async ({
      expect,
    }) => {
      const a = await joined("A");
      const b = await joined("B");
      const c = await joined("C");
      await ctx.repos.docks.create({
        userId: ctx.user.id,
        projectIds: [a.id, 404, b.id, c.id],
        seededAt: ctx.alepha.inject(DateTimeProvider).nowISOString(),
      });
      await ctx.repos.projects.updateById(b.id, {
        archivedAt: ctx.alepha.inject(DateTimeProvider).nowISOString(),
      });

      expect(await ctx.dock.read(ctx.user.id)).toEqual([a.id, c.id]);
    });

    it("rides on the Home overview, for the first paint", async ({
      expect,
    }) => {
      const a = await joined("A");
      const overview = await ctx.projects.getHomeOverview(
        {},
        { user: ctx.user },
      );
      expect(overview.dock).toEqual([a.id]);
    });
  });

  describe("pin", () => {
    it("appends at the end, and a second pin is a no-op", async ({
      expect,
    }) => {
      const a = await joined("A");
      expect(await ctx.dock.read(ctx.user.id)).toEqual([a.id]);
      const b = await joined("B");

      const first = await ctx.api.pinProject(
        { params: { projectId: b.id } },
        { user: ctx.user },
      );
      expect(first.projectIds).toEqual([a.id, b.id]);

      const again = await ctx.api.pinProject(
        { params: { projectId: b.id } },
        { user: ctx.user },
      );
      expect(again.projectIds).toEqual([a.id, b.id]);
    });

    it("refuses a project the caller is not a member of", async ({
      expect,
    }) => {
      const stranger = await createTestProject(ctx.alepha, {
        title: "Stranger",
      });
      await expect(
        ctx.api.pinProject(
          { params: { projectId: stranger.id } },
          { user: ctx.user },
        ),
      ).rejects.toThrow("Not a project you can pin");
    });

    it("refuses past the cap with DOCK_FULL, and the service reports it", async ({
      expect,
    }) => {
      for (let index = 0; index < USER_DOCK_CAP; index++) {
        await joined(`P${index}`);
      }
      expect(await ctx.dock.read(ctx.user.id)).toHaveLength(USER_DOCK_CAP);
      const extra = await joined("Extra");

      await expect(
        ctx.api.pinProject(
          { params: { projectId: extra.id } },
          { user: ctx.user },
        ),
      ).rejects.toBeInstanceOf(DockFullError);
      expect(await ctx.dock.pin(ctx.user.id, extra.id)).toEqual({
        pinned: false,
        full: true,
      });
      expect(await ctx.dock.read(ctx.user.id)).not.toContain(extra.id);
    });
  });

  describe("unpin", () => {
    it("takes the project off and keeps the order of the rest", async ({
      expect,
    }) => {
      const a = await joined("A");
      const b = await joined("B");
      const c = await joined("C");
      await ctx.dock.reorder(ctx.user.id, [a.id, b.id, c.id]);

      const after = await ctx.api.unpinProject(
        { params: { projectId: b.id } },
        { user: ctx.user },
      );
      expect(after.projectIds).toEqual([a.id, c.id]);
    });
  });

  describe("reorder", () => {
    it("saves the full ordered list", async ({ expect }) => {
      const a = await joined("A");
      const b = await joined("B");
      const c = await joined("C");

      const after = await ctx.api.reorderDock(
        { body: { projectIds: [b.id, c.id, a.id] } },
        { user: ctx.user },
      );
      expect(after.projectIds).toEqual([b.id, c.id, a.id]);
      expect(await ctx.dock.read(ctx.user.id)).toEqual([b.id, c.id, a.id]);
    });

    it("refuses an id listed twice", async ({ expect }) => {
      const a = await joined("A");
      await expect(ctx.dock.reorder(ctx.user.id, [a.id, a.id])).rejects.toThrow(
        "only once",
      );
    });

    it("refuses a project the caller is not a member of, or an archived one", async ({
      expect,
    }) => {
      const a = await joined("A");
      const stranger = await createTestProject(ctx.alepha, {
        title: "Stranger",
      });
      await expect(
        ctx.dock.reorder(ctx.user.id, [a.id, stranger.id]),
      ).rejects.toThrow("Not a project you can pin");

      await ctx.repos.projects.updateById(a.id, {
        archivedAt: ctx.alepha.inject(DateTimeProvider).nowISOString(),
      });
      await expect(ctx.dock.reorder(ctx.user.id, [a.id])).rejects.toThrow(
        "Not a project you can pin",
      );
    });

    it("refuses more ids than the cap", async ({ expect }) => {
      await expect(
        ctx.dock.reorder(
          ctx.user.id,
          Array.from({ length: USER_DOCK_CAP + 1 }, (_, index) => index + 1),
        ),
      ).rejects.toBeInstanceOf(DockFullError);
    });
  });
});
