import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * `projects.repositoryUrl` (quest #1571), the value that turns a quest's
 * commit sha from dead text into a link.
 *
 * The refusals carry as much weight as the happy path. A bare `owner/repo` is
 * the shape a person most plausibly types, and accepting it produces an href
 * that resolves against lore.alepha.dev rather than a repository - a broken
 * link that looks like a working one.
 */
describe("a project's repository URL", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

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
    await alepha.start();

    const admin = alepha.inject(AdminUserController);
    const projects = alepha.inject(ProjectController);
    const fake = alepha.inject(FakeProvider);

    const makeUser = async () => {
      const created = await admin.createUser.fetch(
        { body: { ...fake.generate(userDataSchema), roles: ["user"] } },
        { user: adminUser },
      );
      return { id: created.data.id, roles: created.data.roles };
    };

    const owner = await makeUser();
    const stranger = await makeUser();

    const project = await projects.createProject.fetch(
      { body: { title: "Repo probe" } },
      { user: owner },
    );

    const update = async (
      body: Record<string, unknown>,
      as: { id: string; roles: string[] } = owner,
    ) =>
      projects.updateProjectById.fetch(
        { params: { id: project.data.id }, body: body as never },
        { user: as },
      );

    const reread = async () => {
      const res = await projects.getProjectBySlug.fetch(
        { params: { slug: project.data.slug } },
        { user: owner },
      );
      return res.data;
    };

    return { alepha, update, reread, owner, stranger, project: project.data };
  };

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("stores a full https URL, and it survives a re-read", async ({
    expect,
  }) => {
    // ⚠️ The re-read is the assertion that matters. `updateProjectById`
    // returns the in-memory object it just mutated, so asserting its response
    // alone would pass even if the column were never written.
    const res = await ctx.update({
      repositoryUrl: "https://github.com/alepha-dev/alepha",
    });
    expect(res.data.repositoryUrl).toBe("https://github.com/alepha-dev/alepha");
    expect((await ctx.reread()).repositoryUrl).toBe(
      "https://github.com/alepha-dev/alepha",
    );
  });

  it("strips a trailing slash so a path can be appended without guessing", async ({
    expect,
  }) => {
    const res = await ctx.update({
      repositoryUrl: "https://github.com/alepha-dev/alepha/",
    });
    expect(res.data.repositoryUrl).toBe("https://github.com/alepha-dev/alepha");
  });

  it("clears with null", async ({ expect }) => {
    await ctx.update({ repositoryUrl: "https://github.com/a/b" });
    const cleared = await ctx.update({ repositoryUrl: null });
    expect(cleared.data.repositoryUrl).toBeUndefined();
  });

  it("leaves it alone when the key is omitted", async ({ expect }) => {
    await ctx.update({ repositoryUrl: "https://github.com/a/b" });
    const other = await ctx.update({ title: "Renamed probe" });
    expect(other.data.repositoryUrl).toBe("https://github.com/a/b");
  });

  it("refuses a bare owner/repo", async ({ expect }) => {
    await expect(
      ctx.update({ repositoryUrl: "alepha-dev/alepha" }),
    ).rejects.toThrow();
  });

  it("refuses a query string or a fragment", async ({ expect }) => {
    await expect(
      ctx.update({ repositoryUrl: "https://github.com/a/b?tab=readme" }),
    ).rejects.toThrow();
    await expect(
      ctx.update({ repositoryUrl: "https://github.com/a/b#readme" }),
    ).rejects.toThrow();
  });

  it("refuses a non-http protocol", async ({ expect }) => {
    await expect(
      ctx.update({ repositoryUrl: "git@github.com:a/b.git" }),
    ).rejects.toThrow();
  });

  it("refuses a non-owner, on the gate that was already there", async ({
    expect,
  }) => {
    await expect(
      ctx.update({ repositoryUrl: "https://github.com/a/b" }, ctx.stranger),
    ).rejects.toThrow();
  });
});
