import {
  LorePermissions,
  ProjectController,
  ProjectRankPresets,
} from "@lore/core/api";
import { CapabilityRegistry } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha } from "alepha";
import {
  MemberController,
  OrganizationController,
  OrganizationInvitationController,
  OrganizationRankController,
} from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * What a member holding SOME of the configuration permissions can do with
 * them: the cases where a delegated right could be stretched past itself.
 *
 * `member-access-sweep.spec.ts` proves a rank never gets through a gate it
 * does not hold. This file is about the gates it DOES hold: a rank manager
 * granting what they lack, a member manager promoting past themselves,
 * demoting or removing somebody above them, or taking ownership.
 *
 * Every call goes over HTTP with a real token, as the browser's does.
 */

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha, ["api"]);
  const repos = alepha.inject(CoreTestEntities);
  await alepha.start();

  const users = alepha.inject(UserService);
  const projects = alepha.inject(ProjectController);
  const rankApi = alepha.inject(OrganizationRankController);
  const memberApi = alepha.inject(MemberController);
  const orgApi = alepha.inject(OrganizationController);
  const inviteApi = alepha.inject(OrganizationInvitationController);
  const capabilities = alepha.inject(CapabilityRegistry);
  const presets = alepha.inject(ProjectRankPresets);

  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;

  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;

  const owner = await person("owner");
  const created = await projects.createProject.fetch(
    {
      body: {
        title: "Ranks",
        capabilities: capabilities.all().map((it) => ({ key: it.key })),
      } as never,
    },
    as(owner),
  );
  const projectId = created.data.id;
  const organizationId = (await repos.projects.findById(projectId))!
    .organizationId!;

  const admin = presets
    .presetsFor(capabilities.keys() as never)
    .find((it) => it.key === "admin")!.permissions;

  /**
   * Ranks the owner defines, the way the editor does.
   */
  const RANKS: Record<string, string[]> = {
    admin,
    reader: [...LorePermissions.FLOOR],
    keeper: [...LorePermissions.FLOOR, "member:read", "rank:manage"],
    steward: [...LorePermissions.FLOOR, "member:read", "member:manage"],
    inviter: [
      ...LorePermissions.FLOOR,
      "member:read",
      "member:manage",
      "invitation:create",
    ],
  };
  for (const [key, permissions] of Object.entries(RANKS)) {
    await rankApi.saveOrganizationRank.fetch(
      { params: { organizationId, key }, body: { name: key, permissions } },
      as(owner),
    );
  }

  /**
   * Seat somebody, then give them `rank` through the owner's own assignment.
   */
  const seat = async (name: string, rank = "member") => {
    const id = await person(name);
    await repos.members.create({ organizationId, userId: id });
    if (rank !== "member") {
      await rankApi.assignOrganizationRank.fetch(
        { params: { organizationId, userId: id }, body: { key: rank } },
        as(owner),
      );
    }
    return id;
  };

  const rankOf = async (userId: string) =>
    (
      await repos.members.findOne({
        where: {
          organizationId: { eq: organizationId },
          userId: { eq: userId },
        },
      })
    )?.rank ?? (undefined as string | null | undefined);

  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
      return 200;
    } catch (error) {
      return (error as { status?: number }).status ?? 0;
    }
  };

  return {
    alepha,
    repos,
    projects,
    rankApi,
    memberApi,
    orgApi,
    inviteApi,
    as,
    seat,
    rankOf,
    statusOf,
    owner,
    projectId,
    organizationId,
    RANKS,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("delegated rank and member management", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("a rank manager (rank:manage, nothing else)", () => {
    it("cannot grant a permission they do not hold, to a new rank or their own", async ({
      expect,
    }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      const { organizationId } = ctx;

      expect(
        await ctx.statusOf(
          ctx.rankApi.saveOrganizationRank.fetch(
            {
              params: { organizationId, key: "mine" },
              body: {
                name: "Mine",
                permissions: [...LorePermissions.FLOOR, "release:manage"],
              },
            },
            ctx.as(keeper),
          ),
        ),
      ).toBe(400);

      expect(
        await ctx.statusOf(
          ctx.rankApi.saveOrganizationRank.fetch(
            {
              params: { organizationId, key: "keeper" },
              body: {
                name: "keeper",
                permissions: [...ctx.RANKS.keeper, "member:manage"],
              },
            },
            ctx.as(keeper),
          ),
        ),
      ).toBe(400);
    });

    it("can create a rank inside their own set", async ({ expect }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      expect(
        await ctx.statusOf(
          ctx.rankApi.saveOrganizationRank.fetch(
            {
              params: { organizationId: ctx.organizationId, key: "reader" },
              body: { name: "Reader", permissions: [...LorePermissions.FLOOR] },
            },
            ctx.as(keeper),
          ),
        ),
      ).toBe(200);
    });

    it("cannot strip a rank held by somebody they do not outrank", async ({
      expect,
    }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      const admin = await ctx.seat("admin", "admin");

      // The Admin rank holds far more than the keeper. Rewriting it down to
      // the floor demotes every Admin, which is an act on people above them.
      const status = await ctx.statusOf(
        ctx.rankApi.saveOrganizationRank.fetch(
          {
            params: { organizationId: ctx.organizationId, key: "admin" },
            body: { name: "admin", permissions: [...LorePermissions.FLOOR] },
          },
          ctx.as(keeper),
        ),
      );
      expect(status, "keeper rewrote the Admin rank").not.toBe(200);
      expect(await ctx.rankOf(admin)).toBe("admin");
    });

    it("cannot delete a rank above them", async ({ expect }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      // Nobody holds `inviter`, so only the ceiling can stop this.
      const status = await ctx.statusOf(
        ctx.rankApi.deleteOrganizationRank.fetch(
          { params: { organizationId: ctx.organizationId, key: "inviter" } },
          ctx.as(keeper),
        ),
      );
      expect(status, "keeper deleted a rank above them").not.toBe(200);
    });

    it("cannot lock themselves out of rank:manage", async ({ expect }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      expect(
        await ctx.statusOf(
          ctx.rankApi.saveOrganizationRank.fetch(
            {
              params: { organizationId: ctx.organizationId, key: "keeper" },
              body: { name: "keeper", permissions: [...LorePermissions.FLOOR] },
            },
            ctx.as(keeper),
          ),
        ),
      ).toBe(400);
    });
  });

  describe("a member manager (member:manage, nothing else)", () => {
    it("cannot promote anybody, themselves included, past their own rank", async ({
      expect,
    }) => {
      const steward = await ctx.seat("steward", "steward");
      const plain = await ctx.seat("plain");
      const { organizationId } = ctx;

      expect(
        await ctx.statusOf(
          ctx.rankApi.assignOrganizationRank.fetch(
            {
              params: { organizationId, userId: plain },
              body: { key: "admin" },
            },
            ctx.as(steward),
          ),
        ),
      ).toBe(400);
      expect(
        await ctx.statusOf(
          ctx.rankApi.assignOrganizationRank.fetch(
            {
              params: { organizationId, userId: steward },
              body: { key: "admin" },
            },
            ctx.as(steward),
          ),
        ),
      ).toBe(400);
      expect(
        await ctx.statusOf(
          ctx.rankApi.assignOrganizationRank.fetch(
            {
              params: { organizationId, userId: plain },
              body: { key: "owner" },
            },
            ctx.as(steward),
          ),
        ),
      ).toBe(400);
      expect(await ctx.rankOf(plain)).toBeFalsy();
    });

    it("cannot demote somebody above them", async ({ expect }) => {
      const steward = await ctx.seat("steward", "steward");
      const admin = await ctx.seat("admin", "admin");

      // `reader` is inside the steward's own set, so the ceiling on the
      // TARGET rank allows it: only a rule about the member being moved can.
      const status = await ctx.statusOf(
        ctx.rankApi.assignOrganizationRank.fetch(
          {
            params: { organizationId: ctx.organizationId, userId: admin },
            body: { key: "reader" },
          },
          ctx.as(steward),
        ),
      );
      expect(status, "steward demoted an Admin").not.toBe(200);
      expect(await ctx.rankOf(admin)).toBe("admin");
    });

    it("cannot remove somebody above them from the project", async ({
      expect,
    }) => {
      const steward = await ctx.seat("steward", "steward");
      const admin = await ctx.seat("admin", "admin");

      const status = await ctx.statusOf(
        ctx.projects.removeMember.fetch(
          { params: { id: ctx.projectId, userId: admin } },
          ctx.as(steward),
        ),
      );
      expect(status, "steward removed an Admin").not.toBe(200);
      expect(await ctx.rankOf(admin)).toBe("admin");
    });

    it("cannot remove the owner, nor take ownership", async ({ expect }) => {
      const steward = await ctx.seat("steward", "steward");
      const plain = await ctx.seat("plain");
      const { organizationId, projectId, owner } = ctx;

      expect(
        await ctx.statusOf(
          ctx.projects.removeMember.fetch(
            { params: { id: projectId, userId: owner } },
            ctx.as(steward),
          ),
        ),
      ).toBe(403);
      expect(
        await ctx.statusOf(
          ctx.memberApi.removeOrganizationMember.fetch(
            { params: { organizationId, userId: owner } },
            ctx.as(steward),
          ),
        ),
      ).toBe(403);
      expect(
        await ctx.statusOf(
          ctx.projects.transferOwnership.fetch(
            { params: { id: projectId }, body: { userId: plain } },
            ctx.as(steward),
          ),
        ),
      ).toBe(403);
      expect(await ctx.rankOf(owner)).toBe("owner");
      expect(await ctx.rankOf(steward)).toBe("steward");
    });

    it("cannot invite somebody at a rank above their own", async ({
      expect,
    }) => {
      const inviter = await ctx.seat("inviter", "inviter");
      expect(
        await ctx.statusOf(
          ctx.inviteApi.createOrganizationInvitation.fetch(
            {
              params: { organizationId: ctx.organizationId },
              body: { email: "guest@example.com", rank: "admin" },
            },
            ctx.as(inviter),
          ),
        ),
      ).toBe(400);
      expect(
        await ctx.statusOf(
          ctx.inviteApi.createOrganizationInvitation.fetch(
            {
              params: { organizationId: ctx.organizationId },
              body: { email: "guest2@example.com", rank: "owner" },
            },
            ctx.as(inviter),
          ),
        ),
      ).toBe(400);
    });
  });

  describe("an Admin (everything short of the owner's two acts)", () => {
    it("cannot delete the project, its organization, or switch capabilities", async ({
      expect,
    }) => {
      const admin = await ctx.seat("admin", "admin");
      expect(
        await ctx.statusOf(
          ctx.projects.deleteProjectById.fetch(
            { params: { id: ctx.projectId } },
            ctx.as(admin),
          ),
        ),
      ).toBe(403);
      expect(
        await ctx.statusOf(
          ctx.orgApi.deleteOrganization.fetch(
            { params: { organizationId: ctx.organizationId } },
            ctx.as(admin),
          ),
        ),
      ).toBe(403);
      expect(await ctx.repos.projects.findById(ctx.projectId)).toBeTruthy();
    });

    it("cannot be granted organization:delete by the owner", async ({
      expect,
    }) => {
      const status = await ctx.statusOf(
        ctx.rankApi.saveOrganizationRank.fetch(
          {
            params: { organizationId: ctx.organizationId, key: "wrecker" },
            body: {
              name: "Wrecker",
              permissions: [...LorePermissions.FLOOR, "organization:delete"],
            },
          },
          ctx.as(ctx.owner),
        ),
      );
      expect(status, "a rank was granted organization:delete").toBe(400);
    });
  });

  describe("changes take effect on the next request", () => {
    it("a demoted Admin loses rank:manage at once", async ({ expect }) => {
      const admin = await ctx.seat("admin", "admin");
      const read = () =>
        ctx.statusOf(
          ctx.rankApi.getOrganizationRanks.fetch(
            { params: { organizationId: ctx.organizationId } },
            ctx.as(admin),
          ),
        );
      expect(await read()).toBe(200);

      await ctx.rankApi.assignOrganizationRank.fetch(
        {
          params: { organizationId: ctx.organizationId, userId: admin },
          body: { key: "member" },
        },
        ctx.as(ctx.owner),
      );
      expect(await read()).toBe(403);
    });

    it("a removed member loses the project at once", async ({ expect }) => {
      const plain = await ctx.seat("plain");
      const read = () =>
        ctx.statusOf(
          ctx.projects.getProjectById.fetch(
            { params: { id: ctx.projectId } },
            ctx.as(plain),
          ),
        );
      expect(await read()).toBe(200);

      await ctx.projects.removeMember.fetch(
        { params: { id: ctx.projectId, userId: plain } },
        ctx.as(ctx.owner),
      );
      expect(await read()).toBe(403);
    });

    it("a rank stripped of a permission loses it at once", async ({
      expect,
    }) => {
      const keeper = await ctx.seat("keeper", "keeper");
      const read = () =>
        ctx.statusOf(
          ctx.rankApi.getOrganizationRanks.fetch(
            { params: { organizationId: ctx.organizationId } },
            ctx.as(keeper),
          ),
        );
      expect(await read()).toBe(200);

      await ctx.rankApi.saveOrganizationRank.fetch(
        {
          params: { organizationId: ctx.organizationId, key: "keeper" },
          body: { name: "keeper", permissions: [...LorePermissions.FLOOR] },
        },
        ctx.as(ctx.owner),
      );
      expect(await read(), "the 30 s definitions cache").toBe(403);
    });
  });
});
