import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { members } from "../src/api/entities/members.ts";
import { projects } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectLimits } from "../src/api/services/ProjectLimits.ts";

/**
 * The project quota counts what you OWN AND STILL HAVE.
 *
 * It used to be counted twice and the two disagreed in production (feedback
 * #P2133): the create path counted owner membership rows with no join, the
 * Home overview derived `canCreate` from the project list, which filters
 * soft-deleted rows. A user with 8 live projects and 7 deleted ones was told
 * on Home that they could create and refused at submit, because the create
 * path counted 15 against a limit of 10.
 *
 * ⚠️ The stranded rows are made HERE by hand, and that is the point rather
 * than a shortcut: `ProjectDeletionService.deleteProject` soft-deletes the
 * project and then deletes the membership rows as **separate statements**,
 * and D1 has no transaction to bind them (folio #F1227). A failure between
 * the two leaves exactly this state, so the count has to be right in the
 * presence of it, not merely right when the delete completed.
 */
class Probe {
  members = $repository(members);
  projects = $repository(projects);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  // ⚠️ Before `start`: the container locks on start, and a probe class it has
  // never seen cannot be injected afterwards.
  const probe = alepha.inject(Probe);
  await alepha.start();

  const admins = alepha.inject(AdminUserController);
  const projectApi = alepha.inject(ProjectController);
  const limits = alepha.inject(ProjectLimits);
  const fake = alepha.inject(FakeProvider);

  const fakeUser = fake.generate(
    z.object({ username: z.string(), email: z.email() }),
  );
  const created = await admins.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  const user = { id: created.data.id, roles: created.data.roles };

  const create = async (title: string) =>
    (
      await projectApi.createProject.fetch({ body: { title } }, {
        user,
      } as never)
    ).data;

  /**
   * A project deleted the way production's were, with the membership row
   * left behind: the project row soft-deleted and nothing else touched.
   */
  const abandon = async (projectId: number) => {
    await probe.projects.deleteById(projectId);
  };

  const overview = async () =>
    (await projectApi.getHomeOverview.fetch({}, { user } as never)).data;

  return { alepha, projectApi, limits, probe, user, create, abandon, overview };
};

describe("the project quota", () => {
  it("counts a soft-deleted project for neither the quota nor the badge", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.limits.limits.set({
      maxProjectsPerUser: 2,
      maxMembersPerProject: 100,
      maxQuestsPerProject: 5_000,
      maxReleasesPerProject: 200,
    });

    await ctx.create("Alive one");
    const second = await ctx.create("Deleted one");
    await ctx.abandon(second.id);

    // The membership row survives, which is the production state this exists
    // for: the count must be right anyway.
    expect(
      await ctx.probe.members.count({
        userId: { eq: ctx.user.id },
        rank: { eq: "owner" },
      }),
    ).toBe(2);

    const before = await ctx.overview();
    expect(before.ownedCount).toBe(1);
    expect(before.canCreate).toBe(true);

    // And the create path agrees, which is the whole bug: it used to say 2.
    const third = await ctx.create("Alive two");
    expect(third.id).toBeGreaterThan(0);

    await ctx.alepha.stop();
  });

  it("still refuses once the LIVE projects reach the limit", async ({
    expect,
  }) => {
    // The fix must not turn the quota off. A limit that only ever allows is
    // the other way to close this report.
    const ctx = await setup();
    await ctx.limits.limits.set({
      maxProjectsPerUser: 2,
      maxMembersPerProject: 100,
      maxQuestsPerProject: 5_000,
      maxReleasesPerProject: 200,
    });

    await ctx.create("One");
    await ctx.create("Two");

    const after = await ctx.overview();
    expect(after.ownedCount).toBe(2);
    expect(after.canCreate).toBe(false);

    await expect(ctx.create("Three")).rejects.toThrow(
      /maximum number of projects/,
    );

    await ctx.alepha.stop();
  });

  it("agrees with the page that gates the wizard", async ({ expect }) => {
    // ⚠️ The two numbers are the same read now (`ownedProjectIds`), which is
    // what stops the browser saying yes while the server says no - the "it
    // only fails at the end" half of the report.
    const ctx = await setup();
    await ctx.limits.limits.set({
      maxProjectsPerUser: 3,
      maxMembersPerProject: 100,
      maxQuestsPerProject: 5_000,
      maxReleasesPerProject: 200,
    });

    const a = await ctx.create("Alpha one");
    await ctx.create("Beta two");
    await ctx.abandon(a.id);

    const view = await ctx.overview();
    expect(view.ownedCount).toBe(1);
    // Owned rows: 2. Live: 1. The badge and the quota read the same 1.
    expect(view.projects.filter((it) => it.owner)).toHaveLength(1);
    expect(view.canCreate).toBe(true);

    await ctx.alepha.stop();
  });
});
