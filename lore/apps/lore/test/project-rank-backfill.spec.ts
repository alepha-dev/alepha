import { Alepha } from "alepha";
import { rankDefinitions, RankService } from "alepha/api/ranks";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectRankJobs } from "../src/api/jobs/ProjectRankJobs.ts";

/**
 * Direct handle onto the definitions table, so a spec can put a project into
 * the state every project older than epic #E39 is in: the two built-ins and
 * no rows at all. `createProject` seeds the three presets, so there is no way
 * to CREATE one of these any more - only to make one.
 */
class DefinitionsProbe {
  definitions = $repository(rankDefinitions);
}

/**
 * The nightly sweep that gives a pre-#E39 project the presets a project
 * created today starts with (feedback #P2122).
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
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const projectApi = alepha.inject(ProjectController);
  const jobs = alepha.inject(ProjectRankJobs);
  const ranks = alepha.inject(RankService);
  const probe = alepha.inject(DefinitionsProbe);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: userId,
        roles: ["user"],
      } as never);
      return fn();
    });

  /**
   * A project as it looked before #E39: created normally, then stripped of
   * the rows `createProject` seeds.
   */
  const aLegacyProject = async (
    title: string,
    capabilities?: Array<{ key: string }>,
  ) => {
    const project = await asUser(owner.id, () =>
      projectApi.createProject({
        body: capabilities ? { title, capabilities } : { title },
      } as never),
    );
    for (const row of await probe.definitions.findMany({
      where: { type: { eq: "project" }, scopeId: { eq: String(project.id) } },
    })) {
      await probe.definitions.deleteById(row.id);
    }
    return project;
  };

  const keysOf = async (projectId: number) =>
    (
      await probe.definitions.findMany({
        where: { type: { eq: "project" }, scopeId: { eq: String(projectId) } },
      })
    )
      .map((row) => row.key)
      .sort();

  return {
    alepha,
    projectApi,
    jobs,
    ranks,
    probe,
    owner,
    asUser,
    aLegacyProject,
    keysOf,
  };
};

describe("the preset-rank backfill", () => {
  it("gives a project with no definition rows the three presets", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.aLegacyProject("Legacy");

    expect(await ctx.keysOf(project.id)).toEqual([]);

    await ctx.jobs.seedMissingPresetRanks.run();

    expect(await ctx.keysOf(project.id)).toEqual([
      "admin",
      "contributor",
      "viewer",
    ]);
    // Admin is everything short of the two acts that belong to the owner
    // structurally - which is the rank the report was asking for.
    const admin = (await ctx.ranks.ranksOf("project", String(project.id))).find(
      (rank) => rank.key === "admin",
    );
    expect(admin?.name).toBe("Admin");
    expect(admin?.permissions).toContain("member:manage");
    expect(admin?.permissions).toContain("rank:manage");
    expect(admin?.permissions).not.toContain("project:delete");
    expect(admin?.permissions).not.toContain("capability:manage");

    await ctx.alepha.stop();
  });

  it("leaves a project that already holds rows alone", async ({ expect }) => {
    // ⚠️ The predicate is "no rows at all", not "no row for this key". A
    // project with rows has been through the rank editor, and an owner who
    // deleted Admin on purpose must not find it back tomorrow morning.
    const ctx = await setup();
    const project = await ctx.aLegacyProject("Decided");
    await ctx.probe.definitions.create({
      type: "project",
      scopeId: String(project.id),
      key: "contributor",
      name: "Writers",
      permissions: ["project:read", "quest:read", "quest:create"],
    });

    await ctx.jobs.seedMissingPresetRanks.run();

    expect(await ctx.keysOf(project.id)).toEqual(["contributor"]);
    const kept = (await ctx.ranks.ranksOf("project", String(project.id))).find(
      (rank) => rank.key === "contributor",
    );
    expect(kept?.name).toBe("Writers");

    await ctx.alepha.stop();
  });

  it("is safe to run again", async ({ expect }) => {
    // D1 gives the sweep no transaction, so re-running after a partial pass
    // is the normal case rather than the exception.
    const ctx = await setup();
    const project = await ctx.aLegacyProject("Twice");

    await ctx.jobs.seedMissingPresetRanks.run();
    await ctx.jobs.seedMissingPresetRanks.run();

    expect(await ctx.keysOf(project.id)).toEqual([
      "admin",
      "contributor",
      "viewer",
    ]);

    await ctx.alepha.stop();
  });

  it("computes each preset from the project's own capabilities", async ({
    expect,
  }) => {
    // A Contributor of a Knowledge-only project must not carry `quest:create`:
    // a permission whose group belongs to a capability the project does not
    // have is a checkbox in the matrix that grants nothing, and it stays there
    // after the capability is turned on.
    const ctx = await setup();
    const project = await ctx.aLegacyProject("Knowledge only", [
      { key: "knowledge" },
    ]);

    await ctx.jobs.seedMissingPresetRanks.run();

    const contributor = (
      await ctx.ranks.ranksOf("project", String(project.id))
    ).find((rank) => rank.key === "contributor");
    expect(contributor?.permissions).toContain("folio:write");
    expect(contributor?.permissions).not.toContain("quest:create");
    // The floor is never narrowable, whatever the capability set says.
    expect(contributor?.permissions).toContain("project:read");

    await ctx.alepha.stop();
  });
});
