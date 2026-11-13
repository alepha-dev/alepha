import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import {
  AppController,
  ArtifactController,
  ArtifactDetailService,
  LoreDeployApi,
} from "../src/api/index.ts";
import { deployments } from "../src/schemas/index.ts";
import { packedArtifact } from "../src/testing/index.ts";

class TestRows {
  public readonly deployments = $repository(deployments);
}

/**
 * The page behind one build: what it declares, and how the copies of its app
 * stand against its BYTES. The digest is what is under test throughout:
 * `latest` is replaced in place, so a tag cannot say which build a copy runs.
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
  alepha.with(LoreDeployApi);
  alepha.with(TestRows);

  const artifactApi = alepha.inject(ArtifactController);
  const appApi = alepha.inject(AppController);
  const rows = alepha.inject(TestRows);
  await alepha.start();

  const created = await alepha
    .inject(UserService)
    .createUser({ username: "owner" });
  const user = { id: created.id, roles: ["user"] };
  const project = (
    await alepha
      .inject(ProjectController)
      .createProject.fetch({ body: { title: "Detail" } }, { user })
  ).data;
  await alepha.inject(ProjectCapabilityController).setCapability.fetch(
    {
      params: { projectId: project.id, key: "apps" },
      body: { enabled: true },
    },
    { user },
  );
  const projectId = project.id;

  const push = async (tag: string, filler = "a") =>
    (
      await artifactApi.pushArtifact.fetch(
        {
          params: { projectId },
          body: {
            app: "my-app",
            tag,
            file: await packedArtifact({
              manifest: {
                runtimes: [{ runtime: "node", entry: "index.node.js" }],
                resources: { hasDatabase: true, hasKV: false },
                secrets: [{ name: "APP_SECRET" }],
              },
              filler,
            }),
          },
        },
        { user },
      )
    ).data.artifact;

  const copy = async (env: string) =>
    (
      await appApi.createApp.fetch(
        { params: { projectId }, body: { app: "my-app", env } },
        { user },
      )
    ).data;

  const ran = async (
    instanceId: string,
    artifact: { tag: string; sha256: string },
    status: "succeeded" | "failed" = "succeeded",
  ) =>
    await rows.deployments.create({
      projectId,
      instanceId,
      app: "my-app",
      tag: artifact.tag,
      sha256: artifact.sha256,
      status,
      log: [{ at: "2026-11-01T00:00:00.000Z", text: "a line of the log" }],
    });

  const detail = async (tag: string) =>
    (
      await artifactApi.getArtifact.fetch(
        { params: { projectId, app: "my-app", tag } },
        { user },
      )
    ).data;

  const app = async (env: string) =>
    (
      await appApi.getApp.fetch(
        { params: { projectId, app: "my-app", env } },
        { user },
      )
    ).data;

  return {
    alepha,
    artifactApi,
    appApi,
    user,
    projectId,
    push,
    copy,
    ran,
    detail,
    app,
  };
};

describe("getArtifact", () => {
  it("answers each variant's parsed manifest, which the listing leaves out", async ({
    expect,
  }) => {
    const { artifactApi, user, projectId, push, detail } = await setup();
    await push("1.2.3");

    const read = await detail("1.2.3");

    expect(read.variants).toHaveLength(1);
    expect(read.variants[0].manifest?.secrets).toEqual([
      { name: "APP_SECRET" },
    ]);

    const listed = await artifactApi.listArtifacts.fetch(
      { params: { projectId }, query: {} },
      { user },
    );
    expect(listed.data.groups[0].variants[0].manifest).toBeUndefined();
  });

  it("answers a 404 for a tag this app never built", async ({ expect }) => {
    const { push, detail } = await setup();
    await push("1.2.3");

    await expect(detail("9.9.9")).rejects.toThrow(/9\.9\.9/);
  });

  it("reaches a tag named like the routes beside it", async ({ expect }) => {
    const { push, detail } = await setup();
    await push("download");

    expect((await detail("download")).tag).toBe("download");
  });

  it("lists every copy of the app with what it runs, and only this tag's runs", async ({
    expect,
  }) => {
    const { push, copy, ran, detail } = await setup();
    const one = await push("1.0.0", "one");
    const two = await push("2.0.0", "two");
    const production = await copy("production");
    const staging = await copy("staging");
    await copy("idle");

    await ran(production.id, one);
    await ran(staging.id, one);
    await ran(staging.id, two);

    const read = await detail("1.0.0");

    expect(read.copies.map((it) => it.env)).toEqual([
      "idle",
      "production",
      "staging",
    ]);
    const by = new Map(read.copies.map((it) => [it.env, it.deployed]));
    expect(by.get("idle")).toBeUndefined();
    expect(by.get("production")?.sha256).toBe(one.sha256);
    expect(
      read.deployments
        .map((it) => it.env)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(["production", "staging"]);
  });

  it("never carries a run's log", async ({ expect }) => {
    const { push, copy, ran, detail } = await setup();
    const build = await push("1.0.0");
    await ran((await copy("production")).id, build);

    const read = await detail("1.0.0");

    expect(read.deployments).toHaveLength(1);
    expect(JSON.stringify(read)).not.toContain("a line of the log");
  });

  it("caps the runs of a tag that is deployed on every push", async ({
    expect,
  }) => {
    const { push, copy, ran, detail } = await setup();
    const build = await push("latest");
    const production = await copy("production");
    const cap = ArtifactDetailService.MAX_RUNS;

    await Promise.all(
      Array.from({ length: cap + 2 }, () => ran(production.id, build)),
    );

    expect((await detail("latest")).deployments).toHaveLength(cap);
  });
});

describe("getApp's deployed build", () => {
  it("is current while the tag still holds these bytes", async ({ expect }) => {
    const { push, copy, ran, app } = await setup();
    const build = await push("1.0.0");
    await ran((await copy("production")).id, build);

    expect((await app("production")).deployed).toMatchObject({
      tag: "1.0.0",
      sha256: build.sha256,
      state: "current",
      runtime: "node",
      format: "archive",
    });
  });

  it("has moved once latest holds newer bytes", async ({ expect }) => {
    const { push, copy, ran, app } = await setup();
    const build = await push("latest", "old");
    await ran((await copy("production")).id, build);
    await push("latest", "new");

    const { deployed, version } = await app("production");

    expect(version).toBe("latest");
    expect(deployed).toMatchObject({ sha256: build.sha256, state: "moved" });
  });

  it("is gone once the build was deleted, and the snapshot still names it", async ({
    expect,
  }) => {
    const { artifactApi, user, projectId, push, copy, ran, app } =
      await setup();
    const build = await push("1.0.0");
    await ran((await copy("production")).id, build);
    await artifactApi.deleteArtifact.fetch(
      { params: { projectId, artifactId: build.id } },
      { user },
    );

    expect((await app("production")).deployed).toMatchObject({
      tag: "1.0.0",
      state: "gone",
    });
  });

  it("ignores a failed run", async ({ expect }) => {
    const { push, copy, ran, app } = await setup();
    const good = await push("1.0.0", "good");
    const bad = await push("2.0.0", "bad");
    const production = await copy("production");
    await ran(production.id, good);
    await ran(production.id, bad, "failed");

    expect((await app("production")).deployed?.tag).toBe("1.0.0");
  });

  it("is not looked up for the list, which answers no state", async ({
    expect,
  }) => {
    const { appApi, user, projectId, push, copy, ran } = await setup();
    const build = await push("1.0.0");
    await ran((await copy("production")).id, build);

    const { items } = (
      await appApi.listApps.fetch({ params: { projectId } }, { user })
    ).data;

    expect(items[0].version).toBe("1.0.0");
    expect(items[0].deployed?.sha256).toBe(build.sha256);
    expect(items[0].deployed?.state).toBeUndefined();
  });
});
