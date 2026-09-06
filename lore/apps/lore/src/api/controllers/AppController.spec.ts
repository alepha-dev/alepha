import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { sigils } from "../entities/sigils.ts";
import { LoreApi } from "../index.ts";
import { defaultAppInstance } from "../schemas/defaultAppInstance.ts";
import { AppController } from "./AppController.ts";

class AppRepositories {
  instances = $repository(appInstances);
  sigils = $repository(sigils);
  estates = $repository(estates);
  grants = $repository(estateProjects);
}

interface TestContext {
  alepha: Alepha;
  controller: AppController;
  repos: AppRepositories;
}

/**
 * Pinned to `:memory:`, like every other lore spec: the ROOT vitest config —
 * the one CI runs — sets `DATABASE_URL` to a Postgres URL, which this app's
 * SQLite provider rejects outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(AppRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(AppController),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

describe("AppController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates an instance from two names, and mints nothing", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);

    const created = await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "  Club ", env: "B14-Production" },
      },
      { user: ownerToken(project) },
    );

    expect(created.app).toBe("club");
    expect(created.env).toBe("b14-production");
    expect(created.sigil).toBeUndefined();
  });

  it("refuses a name outside the URL charset", async ({ expect }) => {
    // Both segments sit in the URL, so both take the same charset. The first
    // hand-made row that got through would be a page nothing could route to.
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.createApp(
        {
          params: { projectId: project.id },
          body: { app: "club", env: "b14 production" },
        },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow(/environment name/);
  });

  it("refuses a second instance with the same pair", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production" },
      },
      { user },
    );

    await expect(
      ctx.controller.createApp(
        {
          params: { projectId: project.id },
          body: { app: "club", env: "production" },
        },
        { user },
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("lists the rows and the distinct app names beside them", async ({
    expect,
  }) => {
    // The names ride along rather than getting an endpoint of their own: a
    // second request for a projection of the first one is a request that can
    // disagree with it.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    for (const [app, env] of [
      ["club", "production"],
      ["club", "staging"],
      ["docs", "production"],
    ]) {
      await ctx.controller.createApp(
        { params: { projectId: project.id }, body: { app, env } },
        { user },
      );
    }

    const listed = await ctx.controller.listApps(
      { params: { projectId: project.id } },
      { user },
    );

    expect(listed.items).toHaveLength(3);
    expect(listed.apps).toEqual(["club", "docs"]);
    // Ordered by the pair, which is what the flat list reads in.
    expect(listed.items.map((it) => `${it.app}/${it.env}`)).toEqual([
      "club/production",
      "club/staging",
      "docs/production",
    ]);
  });

  it("resolves the bare-app redirect from the list it already fetched", async ({
    expect,
  }) => {
    // What `/apps/:app` does, driven through the two pieces that make it: the
    // list the loader fetches, and `defaultAppInstance`, the same function
    // `AppService.defaultInstance` calls. The loader cannot inject the service
    // (it runs in the browser), so this is the guard that the rule the redirect
    // applies is the rule the server would have.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    for (const [app, env] of [
      ["club", "a-staging"],
      ["club", "production"],
      ["docs", "b14-preview"],
      ["docs", "staging"],
    ]) {
      await ctx.controller.createApp(
        { params: { projectId: project.id }, body: { app, env } },
        { user },
      );
    }

    const { items } = await ctx.controller.listApps(
      { params: { projectId: project.id } },
      { user },
    );

    // `production` wins even though `a-staging` sorts before it.
    expect(defaultAppInstance(items, "club")?.env).toBe("production");
    // No production: the first env by name.
    expect(defaultAppInstance(items, "docs")?.env).toBe("b14-preview");
    // A bare name that names nothing is a 404 in the loader.
    expect(defaultAppInstance(items, "nothing")).toBeUndefined();
  });

  it("carries the sigil summary, and never the credential", async ({
    expect,
  }) => {
    // `tokenHash` must not reach a browser, and the resource is built field by
    // field rather than spread precisely so widening the query cannot leak it.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const created = await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production" },
      },
      { user },
    );
    const sigil = await ctx.repos.sigils.create({
      projectId: project.id,
      name: "club/production",
      tokenHash: "hash-1",
      tokenPrefix: "sg_test_",
      kinds: ["beacon"],
    });
    await ctx.repos.instances.updateById(created.id, { sigilId: sigil.id });

    const read = await ctx.controller.getApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
      },
      { user },
    );

    expect(read.sigil?.tokenPrefix).toBe("sg_test_");
    expect(read.sigil?.kinds).toEqual(["beacon"]);
    expect(JSON.stringify(read)).not.toContain("hash-1");
  });

  it("answers 404 for a pair in another project", async ({ expect }) => {
    // The cross-project guard: without the `projectId` filter the pair would
    // resolve and the membership check would have passed on the wrong project.
    const mine = await createTestProject(ctx.alepha);
    const theirs = await createTestProject(ctx.alepha);
    await ctx.controller.createApp(
      {
        params: { projectId: theirs.id },
        body: { app: "club", env: "production" },
      },
      { user: ownerToken(theirs) },
    );

    await expect(
      ctx.controller.getApp(
        { params: { projectId: mine.id, app: "club", env: "production" } },
        { user: ownerToken(mine) },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("renames either half and carries the sigil mirror with it", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const created = await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "staging" },
      },
      { user },
    );
    const sigil = await ctx.repos.sigils.create({
      projectId: project.id,
      name: "club/staging",
      tokenHash: "hash-2",
      tokenPrefix: "sg_test_",
      kinds: [],
    });
    await ctx.repos.instances.updateById(created.id, { sigilId: sigil.id });

    const renamed = await ctx.controller.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "staging" },
        body: { env: "b14-production" },
      },
      { user },
    );

    expect(renamed.env).toBe("b14-production");
    expect((await ctx.repos.sigils.getById(sigil.id)).name).toBe(
      "club/b14-production",
    );
  });

  it("leaves every key the PATCH did not mention", async ({ expect }) => {
    // The name fields, the URL field and the estate select are separate
    // surfaces, and each PATCHes only what it owns.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production", url: "https://club.example" },
      },
      { user },
    );

    const updated = await ctx.controller.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
        body: { app: "lore" },
      },
      { user },
    );

    expect(updated.url).toBe("https://club.example");
  });

  it("refuses an estate the project was never lent", async ({ expect }) => {
    // Validated against `estate_projects` and never against `estates`: the
    // whole point of the lending join.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production" },
      },
      { user },
    );
    const owner = await ctx.alepha
      .inject(TestEntityRepositories)
      .users.create({});
    const estate = await ctx.repos.estates.create({
      ownerUserId: owner.id,
      type: "bay",
      slug: "ovh-1",
    });

    await expect(
      ctx.controller.updateApp(
        {
          params: { projectId: project.id, app: "club", env: "production" },
          body: { estateId: estate.id },
        },
        { user },
      ),
    ).rejects.toThrow(/no such estate/i);

    // And accepts it once the loan exists.
    await ctx.repos.grants.create({
      estateId: estate.id,
      projectId: project.id,
    });
    const pointed = await ctx.controller.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
        body: { estateId: estate.id },
      },
      { user },
    );
    expect(pointed.estate?.slug).toBe("ovh-1");
  });

  it("clears the estate through the endpoint, and unblocks the detach", async ({
    expect,
  }) => {
    // ⚠️ Driven through the CONTROLLER rather than the service: `null` has to
    // survive the body schema to reach `setEstate`, and an `estateId` that
    // arrived as `undefined` would skip the branch entirely and leave the
    // column set - which reads as a cleared select and a refusal that never
    // lifts.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production" },
      },
      { user },
    );
    const owner = await ctx.alepha
      .inject(TestEntityRepositories)
      .users.create({});
    const estate = await ctx.repos.estates.create({
      ownerUserId: owner.id,
      type: "bay",
      slug: "ovh-clear",
    });
    await ctx.repos.grants.create({
      estateId: estate.id,
      projectId: project.id,
    });
    await ctx.controller.updateApp(
      {
        params: { projectId: project.id, app: "club", env: "production" },
        body: { estateId: estate.id },
      },
      { user },
    );

    // ⚠️ Through `.fetch()`, which runs the body SCHEMA, rather than calling the
    // handler directly. `null` has to survive `z.uuid().nullable().optional()`
    // to reach `setEstate`; an `estateId` that arrived as `undefined` would skip
    // the branch and leave the column set, which is invisible to a spec that
    // hands the handler a already-parsed object.
    const cleared = await ctx.controller.updateApp.fetch(
      {
        params: { projectId: project.id, app: "club", env: "production" },
        body: { estateId: null },
      },
      { user },
    );

    expect(cleared.data.estate).toBeUndefined();
    const stored = await ctx.repos.instances.findOne({
      where: { projectId: { eq: project.id }, app: { eq: "club" } },
    });
    expect(stored?.estateId ?? null).toBeNull();
  });

  it("takes the sigil with the instance on delete", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const created = await ctx.controller.createApp(
      {
        params: { projectId: project.id },
        body: { app: "club", env: "production" },
      },
      { user },
    );
    const sigil = await ctx.repos.sigils.create({
      projectId: project.id,
      name: "club/production",
      tokenHash: "hash-3",
      tokenPrefix: "sg_test_",
      kinds: [],
    });
    await ctx.repos.instances.updateById(created.id, { sigilId: sigil.id });

    await ctx.controller.deleteApp(
      { params: { projectId: project.id, app: "club", env: "production" } },
      { user },
    );

    expect(
      await ctx.repos.instances.findOne({ where: { id: { eq: created.id } } }),
    ).toBeUndefined();
    expect(
      await ctx.repos.sigils.findOne({ where: { id: { eq: sigil.id } } }),
    ).toBeUndefined();
  });
});
