import {
  HostTokenService,
  AdminHostController,
  HostController,
} from "@lore/core/api";
import { hostProjects, hosts } from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { audits } from "alepha/api/audits";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class HostRepositories {
  hosts = $repository(hosts);
  grants = $repository(hostProjects);
  audits = $repository(audits);
}

interface TestContext {
  alepha: Alepha;
  admin: AdminHostController;
  owner: HostController;
  tokens: HostTokenService;
  repos: HostRepositories;
  entities: DeployTestEntities;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(HostRepositories);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminHostController),
    owner: alepha.inject(HostController),
    tokens: alepha.inject(HostTokenService),
    repos,
    entities,
  };
};

const createUser = async (
  ctx: TestContext,
  username: string,
): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({ username });
  return { id: user.id, roles: ["user"] };
};

const adminToken = (): UserAccountToken => ({
  id: crypto.randomUUID(),
  roles: ["admin"],
});

// Pages are zero-based, like every paginate() caller in the app.
const page = { page: 0, size: 20 };

describe("AdminHostController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists every host on the instance, masked, with its home, its creator and its loans", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const bob = await createUser(ctx, "bob");
    const project = await createTestProject(ctx.alepha);
    const mine = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestHost(ctx.alepha, alice, { slug: "ovh-2" });
    await createTestHost(ctx.alepha, bob, { slug: "hetzner" });
    await ctx.repos.grants.create({
      hostId: mine.id,
      projectId: project.id,
      createdBy: alice.id,
    });

    const result = await ctx.admin.findHosts(
      { query: page },
      { user: adminToken() },
    );
    expect(result.content).toHaveLength(3);

    const row = result.content.find((item) => item.id === mine.id);
    expect(row).toMatchObject({
      slug: "ovh-1",
      type: "bay",
      project: { id: mine.projectId },
      creator: { id: alice.id, name: "alice" },
      online: false,
      deployAllowed: false,
    });
    // Lent to its home when created, then to the other project.
    expect(row?.loans.map((loan) => loan.id)).toEqual([
      mine.projectId,
      project.id,
    ]);
    expect(row?.secretPrefix).toBe(mine.secretPrefix);
    // The masking rule has no exception for the admin role: no hash and no
    // secret on any row, ever.
    for (const item of result.content) {
      expect(Object.keys(item)).not.toContain("secretHash");
      expect(Object.keys(item)).not.toContain("secret");
    }
    expect(
      result.content.find((item) => item.slug === "hetzner")?.loans,
    ).toHaveLength(1);
  });

  it("narrows by slug", async ({ expect }) => {
    const alice = await createUser(ctx, "alice");
    await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestHost(ctx.alepha, alice, { slug: "hetzner" });

    const result = await ctx.admin.findHosts(
      { query: { ...page, search: "hetz" } },
      { user: adminToken() },
    );
    expect(result.content.map((item) => item.slug)).toEqual(["hetzner"]);
  });

  it("filters by type, state and credential, server-side, composing with the search and paging", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const live = await createTestHost(ctx.alepha, alice, { slug: "ovh-live" });
    await createTestHost(ctx.alepha, alice, { slug: "ovh-idle" });
    await createTestHost(ctx.alepha, alice, { slug: "hetzner-live" });
    const now = new Date().toISOString();
    for (const host of await ctx.repos.hosts.findMany({})) {
      if (host.slug.endsWith("-live")) {
        await ctx.repos.hosts.updateById(host.id, {
          connectedAt: now,
          lastSeenAt: now,
        });
      }
    }
    const find = (query: Record<string, unknown>) =>
      ctx.admin.findHosts(
        { query: { ...page, sort: "slug", ...query } },
        { user: adminToken() },
      );

    const online = await find({ state: "online" });
    expect(online.content.map((item) => item.slug)).toEqual([
      "hetzner-live",
      "ovh-live",
    ]);
    expect(online.content.every((item) => item.online)).toBe(true);

    expect(
      (await find({ state: "offline" })).content.map((item) => item.slug),
    ).toEqual(["ovh-idle"]);
    expect(
      (await find({ state: "online", search: "ovh" })).content.map(
        (item) => item.id,
      ),
    ).toEqual([live.id]);

    // Paging and the count run over the filtered set, not over a page.
    const first = await find({ state: "online", size: 1 });
    expect(first.content).toHaveLength(1);
    expect(first.page.totalElements).toBe(2);

    expect((await find({ type: "bay" })).content).toHaveLength(3);
    expect((await find({ type: "cloudflare" })).content).toHaveLength(0);
    // A bay host has no credential status, so it matches neither value.
    expect((await find({ credentialStatus: "valid" })).content).toHaveLength(0);
  });

  it("is closed to a plain user, owner of hosts or not", async ({ expect }) => {
    const alice = await createUser(ctx, "alice");
    await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });

    await expect(
      ctx.admin.findHosts({ query: page }, { user: alice }),
    ).rejects.toThrow(ForbiddenError);
  });

  /**
   * The admin's rename, as moderation (#Q3664): the slug and the display
   * name, unique in the home project like a creation, audited with both.
   */
  it("renames a host whoever owns it, audited, its secret untouched", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const minted = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });

    const renamed = await ctx.admin.adminRenameHost(
      {
        params: { id: minted.id },
        body: { slug: "  Paris-1 ", label: "Paris" },
      },
      { user: adminToken() },
    );

    expect(renamed).toEqual({ slug: "paris-1", label: "Paris" });
    const row = await ctx.repos.hosts.findById(minted.id);
    expect(row?.slug).toBe("paris-1");
    expect(row?.label).toBe("Paris");
    expect(await ctx.tokens.verify(minted.secret)).toBeDefined();

    const audit = (
      await ctx.repos.audits.findMany({
        where: { type: { eq: "host" }, action: { eq: "rename" } },
      })
    )[0];
    expect(audit?.resourceId).toBe(minted.id);
    expect(audit?.metadata).toMatchObject({
      admin: true,
      from: { slug: "ovh-1" },
      to: { slug: "paris-1", label: "Paris" },
    });
  });

  it("refuses a slug already used in the host's home project, and a plain user", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const first = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    await createTestHost(
      ctx.alepha,
      alice,
      { slug: "ovh-2" },
      { projectId: first.projectId },
    );

    await expect(
      ctx.admin.adminRenameHost(
        { params: { id: first.id }, body: { slug: "OVH-2" } },
        { user: adminToken() },
      ),
    ).rejects.toThrow(ConflictError);
    await expect(
      ctx.admin.adminRenameHost(
        { params: { id: first.id }, body: { slug: "not a slug!" } },
        { user: adminToken() },
      ),
    ).rejects.toThrow("lowercase letters, digits and hyphens");
    await expect(
      ctx.admin.adminRenameHost(
        { params: { id: first.id }, body: { slug: "paris-1" } },
        { user: alice },
      ),
    ).rejects.toThrow(ForbiddenError);
    expect((await ctx.repos.hosts.findById(first.id))?.slug).toBe("ovh-1");
  });

  it("deletes a host whoever owns it, which revokes its secret", async ({
    expect,
  }) => {
    const alice = await createUser(ctx, "alice");
    const minted = await createTestHost(ctx.alepha, alice, { slug: "ovh-1" });
    expect(await ctx.tokens.verify(minted.secret)).toBeDefined();

    await ctx.admin.adminDeleteHost(
      { params: { id: minted.id } },
      { user: adminToken() },
    );

    expect(await ctx.tokens.verify(minted.secret)).toBeUndefined();
    expect(
      await ctx.repos.hosts.findOne({ where: { id: { eq: minted.id } } }),
    ).toBeUndefined();
    await expect(
      ctx.admin.adminDeleteHost(
        { params: { id: crypto.randomUUID() } },
        { user: adminToken() },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});
