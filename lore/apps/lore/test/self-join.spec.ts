import {
  LoreViewerAllowlist,
  ProjectController,
  ProjectExclusions,
  ProjectJoinController,
  ProjectLimits,
} from "@lore/core/api";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import {
  MemberController,
  OrganizationRankController,
} from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Joining an open project by yourself (#Q3646): the preview a stranger
 * sees, the join, the exclusion of someone an admin removed, the shared
 * member cap and the rate limits. Every call goes over HTTP.
 */

class TwoMemberLimits extends ProjectLimits {
  public override async maxMembersPerProject(): Promise<number> {
    return 2;
  }
}

const setup = async (options: { cap?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      LORE_OPEN_PROJECTS: "true",
    },
  });
  if (options.cap) {
    alepha.with({ provide: ProjectLimits, use: TwoMemberLimits });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha, ["api"]);
  const repos = alepha.inject(CoreTestEntities);
  await alepha.start();

  const projects = alepha.inject(ProjectController);
  const join = alepha.inject(ProjectJoinController);
  const memberApi = alepha.inject(MemberController);
  const rankApi = alepha.inject(OrganizationRankController);
  const users = alepha.inject(UserService);
  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;
  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;

  const owner = await person("owner");
  const create = async (title: string, open: boolean) => {
    const project = (
      await projects.createProject.fetch({ body: { title } }, as(owner))
    ).data;
    if (open) {
      await projects.updateProjectById.fetch(
        { params: { id: project.id }, body: { joinPolicy: "open" } },
        as(owner),
      );
    }
    return project;
  };
  const project = await create("Open", true);
  const organizationId = project.organizationId;

  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
      return { status: 200, message: "" };
    } catch (error) {
      const failed = error as { status?: number; message?: string };
      return { status: failed.status ?? 0, message: failed.message ?? "" };
    }
  };

  const joinAs = (userId: string, projectId = project.id) =>
    join.joinProject.fetch({ params: { id: projectId } }, as(userId));

  const membershipOf = (userId: string) =>
    repos.members.findOne({
      where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
    });

  return {
    alepha,
    repos,
    projects,
    join,
    memberApi,
    rankApi,
    as,
    person,
    create,
    owner,
    project,
    organizationId,
    statusOf,
    joinAs,
    membershipOf,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("joining an open project", () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the preview", () => {
    it("shows an open project's card, with no session and no member count", async ({
      expect,
    }) => {
      ctx = await setup();

      const card = (
        await ctx.join.previewOpenProject.fetch({
          params: { slug: ctx.project.slug },
        })
      ).data;

      expect(card).toEqual({
        id: ctx.project.id,
        title: "Open",
        slug: ctx.project.slug,
      });
    });

    it("gives the same 404 for an invite-only and an unknown project", async ({
      expect,
    }) => {
      ctx = await setup();
      const closed = await ctx.create("Closed", false);

      for (const slug of [closed.slug, "nothing-here"]) {
        const result = await ctx.statusOf(
          ctx.join.previewOpenProject.fetch({ params: { slug } }),
        );
        expect(result, slug).toEqual({
          status: 404,
          message: "Project not found",
        });
      }
    });
  });

  describe("resolving a slug as a non-member (#Q3649)", () => {
    it("gives the same 404 as an unknown slug, open or not, until they join", async ({
      expect,
    }) => {
      ctx = await setup();
      const closed = await ctx.create("Closed", false);
      const stranger = await ctx.person("stranger");
      const resolve = (slug: string) =>
        ctx.statusOf(
          ctx.projects.getProjectBySlug.fetch(
            { params: { slug } },
            ctx.as(stranger),
          ),
        );

      for (const slug of [ctx.project.slug, closed.slug, "nothing-here"]) {
        expect(await resolve(slug), slug).toEqual({
          status: 404,
          message: "Project not found",
        });
      }

      await ctx.joinAs(stranger);
      expect((await resolve(ctx.project.slug)).status).toBe(200);
    });
  });

  describe("the join", () => {
    it("makes a stranger a member on the viewer rank, once, and audits it", async ({
      expect,
    }) => {
      ctx = await setup();
      const stranger = await ctx.person("stranger");

      const first = (await ctx.joinAs(stranger)).data;
      const again = (await ctx.joinAs(stranger)).data;

      expect(first).toEqual({
        joined: true,
        rank: "viewer",
        slug: ctx.project.slug,
      });
      expect(again.joined).toBe(false);
      expect((await ctx.membershipOf(stranger))?.rank).toBe("viewer");

      const audits = await ctx.alepha.inject(AuditService).find({
        scopeType: "project",
        scopeId: String(ctx.project.id),
        type: "member",
      });
      expect(
        audits.content.filter(
          (row) => row.action === "self_join" && row.userId === stranger,
        ),
      ).toHaveLength(1);
    });

    it("leaves an existing member's rank alone", async ({ expect }) => {
      ctx = await setup();

      const result = (await ctx.joinAs(ctx.owner)).data;

      expect(result).toMatchObject({ joined: false, rank: "owner" });
    });

    it("gives an invite-only project the same 404", async ({ expect }) => {
      ctx = await setup();
      const closed = await ctx.create("Closed", false);
      const stranger = await ctx.person("stranger");

      expect((await ctx.statusOf(ctx.joinAs(stranger, closed.id))).status).toBe(
        404,
      );
      expect(await ctx.membershipOf(stranger)).toBeUndefined();
    });

    it("checks the Viewer allowlist at the join itself", async ({ expect }) => {
      ctx = await setup();
      // Viewer widened behind the lock's back (it is refused while open), so
      // the join is the last line.
      await ctx.projects.updateProjectById.fetch(
        { params: { id: ctx.project.id }, body: { joinPolicy: "invite" } },
        ctx.as(ctx.owner),
      );
      await ctx.rankApi.saveOrganizationRank.fetch(
        {
          params: { organizationId: ctx.organizationId, key: "viewer" },
          body: {
            name: "Viewer",
            permissions: [...LoreViewerAllowlist.PERMISSIONS, "error:read"],
          },
        },
        ctx.as(ctx.owner),
      );
      await ctx.repos.projects.updateById(ctx.project.id, {
        joinPolicy: "open",
      });
      const stranger = await ctx.person("stranger");

      const refused = await ctx.statusOf(ctx.joinAs(stranger));

      expect(refused.status).toBe(400);
      expect(refused.message).toContain("error:read");
      expect(await ctx.membershipOf(stranger)).toBeUndefined();
    });
  });

  describe("someone an admin removed", () => {
    it("cannot rejoin until an admin lifts it; someone who left can", async ({
      expect,
    }) => {
      ctx = await setup();
      const removed = await ctx.person("removed");
      const leaver = await ctx.person("leaver");
      await ctx.joinAs(removed);
      await ctx.joinAs(leaver);

      await ctx.memberApi.removeOrganizationMember.fetch(
        { params: { organizationId: ctx.organizationId, userId: removed } },
        ctx.as(ctx.owner),
      );
      await ctx.memberApi.leaveOrganization.fetch(
        { params: { organizationId: ctx.organizationId } },
        ctx.as(leaver),
      );

      const refused = await ctx.statusOf(ctx.joinAs(removed));
      expect(refused.status).toBe(403);
      expect(refused.message).toContain("cannot rejoin");
      expect((await ctx.joinAs(leaver)).data.joined).toBe(true);

      const listed = (
        await ctx.join.listProjectExclusions.fetch(
          { params: { id: ctx.project.id } },
          ctx.as(ctx.owner),
        )
      ).data;
      expect(listed.map((row) => row.userId)).toEqual([removed]);

      await ctx.join.liftProjectExclusion.fetch(
        { params: { id: ctx.project.id, userId: removed } },
        ctx.as(ctx.owner),
      );
      expect((await ctx.joinAs(removed)).data.joined).toBe(true);
    });

    it("is let back in by accepting an invitation", async ({ expect }) => {
      ctx = await setup();
      const removed = await ctx.person("removed");
      const exclusions = ctx.alepha.inject(ProjectExclusions);
      await exclusions.exclude(ctx.project.id, removed, ctx.owner);

      await ctx.alepha.events.emit("organization:invitation:accepted", {
        invitation: { organizationId: ctx.organizationId } as never,
        acceptedBy: { id: removed },
      });

      expect(await exclusions.isExcluded(ctx.project.id, removed)).toBe(false);
    });

    it("ends excluded and not a member when the removal races the join", async ({
      expect,
    }) => {
      ctx = await setup();
      const exclusions = ctx.alepha.inject(ProjectExclusions);

      for (let round = 0; round < 5; round += 1) {
        const racer = await ctx.person(`racer${round}`);
        await Promise.allSettled([
          ctx.joinAs(racer),
          exclusions.exclude(ctx.project.id, racer, ctx.owner),
        ]);

        expect(await exclusions.isExcluded(ctx.project.id, racer)).toBe(true);
        expect(await ctx.membershipOf(racer), `round ${round}`).toBeUndefined();
      }
    });
  });

  describe("the limits", () => {
    it("counts a self-join against the one member cap", async ({ expect }) => {
      ctx = await setup({ cap: true });
      const first = await ctx.person("first");
      const second = await ctx.person("second");

      expect((await ctx.joinAs(first)).data.joined).toBe(true);
      const refused = await ctx.statusOf(ctx.joinAs(second));

      expect(refused.status).toBe(403);
      expect(refused.message).toContain("maximum number of members");
    });

    it("raises the defaults to 5,000 members and 50,000 quests", async ({
      expect,
    }) => {
      ctx = await setup();
      const limits = ctx.alepha.inject(ProjectLimits);

      expect(await limits.maxMembersPerProject()).toBe(5_000);
      expect(await limits.maxQuestsPerProject()).toBe(50_000);
    });

    it("rate-limits joins per account", async ({ expect }) => {
      ctx = await setup();
      const stranger = await ctx.person("stranger");
      const limiter = (
        ctx.join as unknown as {
          joinsPerUser: { consume: (key: string) => Promise<unknown> };
        }
      ).joinsPerUser;
      for (let hit = 0; hit < 20; hit += 1) await limiter.consume(stranger);

      const refused = await ctx.statusOf(ctx.joinAs(stranger));

      expect(refused.status).toBe(429);
      expect(await ctx.membershipOf(stranger)).toBeUndefined();
    });
  });
});
