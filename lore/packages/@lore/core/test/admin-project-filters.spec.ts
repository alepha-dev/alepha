import { AdminProjectController, ProjectController } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";

/**
 * `findProjects`' archived filter and creation window (#Q3539), which the
 * admin dashboard's Projects tile counts with and links through.
 */
class Probe {
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
  alepha.with(LoreCoreApi);
  const probe = alepha.inject(Probe);
  await alepha.start();

  const admins = alepha.inject(AdminUserController);
  const projectApi = alepha.inject(ProjectController);
  const adminProjects = alepha.inject(AdminProjectController);
  const fake = alepha.inject(FakeProvider);

  const created = await admins.createUser.fetch(
    {
      body: {
        ...fake.generate(z.object({ username: z.string(), email: z.email() })),
        roles: ["user"],
      },
    },
    { user: adminUser },
  );
  const user = { id: created.data.id, roles: created.data.roles };

  const create = async (title: string, createdAt: string) => {
    const project = (
      await projectApi.createProject.fetch({ body: { title } }, { user })
    ).data;
    await probe.projects.updateById(project.id, { createdAt });
    return project;
  };

  const total = async (query: Record<string, string>) =>
    (
      await adminProjects.findProjects.fetch(
        { query: { ...query, size: 1 } },
        { user: adminUser },
      )
    ).data.page.totalElements;

  return { probe, create, total };
};

describe("findProjects filters", () => {
  it("counts every project without archived, live ones with exclude, archived ones with only", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.create("Live", "2026-11-10T12:00:00.000Z");
    const old = await ctx.create("Old", "2026-11-10T12:00:00.000Z");
    await ctx.probe.projects.updateById(old.id, {
      archivedAt: "2026-11-11T00:00:00.000Z",
    });

    expect(await ctx.total({})).toBe(2);
    expect(await ctx.total({ archived: "exclude" })).toBe(1);
    expect(await ctx.total({ archived: "only" })).toBe(1);
    // A stale value from a stored filter is no filter, not an error.
    expect(await ctx.total({ archived: "stale" })).toBe(2);
  });

  it("windows creation: from inclusive, to exclusive, so adjacent windows never overlap", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.create("At the start", "2026-11-08T00:00:00.000Z");
    await ctx.create("Just before", "2026-11-07T23:59:59.999Z");
    await ctx.create("At the end", "2026-11-15T00:00:00.000Z");

    const window = {
      createdFrom: "2026-11-08T00:00:00.000Z",
      createdTo: "2026-11-15T00:00:00.000Z",
    };
    expect(await ctx.total(window)).toBe(1);
    expect(
      await ctx.total({
        createdFrom: "2026-11-01T00:00:00.000Z",
        createdTo: "2026-11-08T00:00:00.000Z",
      }),
    ).toBe(1);
  });
});
