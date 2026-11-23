import {
  LiveQuestRegistry,
  ProjectCapabilityController,
  ProjectController,
  type RecordedQuestCommits,
} from "@lore/core/api";
import { hostProjects, hosts } from "@lore/core/schemas";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { CloudflareDeployClient } from "alepha/cli/infra-lib";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppController,
  ArtifactController,
  CommitQuestSetService,
  DeployService,
  LiveQuestController,
  LiveQuestService,
  LoreShipApi,
  QuestBitmap,
  RollbackService,
} from "../src/api/index.ts";
import {
  appInstances,
  artifacts,
  commitQuestSets,
  deployments,
} from "../src/schemas/index.ts";
import { packedArtifact } from "../src/testing/index.ts";

/**
 * Live quests (#E154, folio #F1516): a pushed commit keeps the quests its
 * history references, every deployment snapshots the commit it ran, and a
 * copy's live set is its newest succeeded deployment's commit's set.
 *
 * Ship boots alone here, so Plan's half of the seam (the commits recorded on
 * each quest) is registered on the core registry by the spec, as Plan does it.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

class TestRows {
  public readonly deployments = $repository(deployments);
  public readonly hosts = $repository(hosts);
  public readonly grants = $repository(hostProjects);
  public readonly instances = $repository(appInstances);
  public readonly artifacts = $repository(artifacts);
  public readonly sets = $repository(commitQuestSets);
}

/**
 * Plan's source, as the spec states it: what `quest.commits` would answer.
 */
class TestRecordedCommits {
  public recorded: RecordedQuestCommits[] = [];
}

const sha = (seed: string) => seed.repeat(40).slice(0, 40);

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreShipApi);
  alepha.with(TestRows);
  alepha.with(TestRecordedCommits);
  await alepha.start();
  const recorded = alepha.inject(TestRecordedCommits);
  alepha
    .inject(LiveQuestRegistry)
    .registerCommits(async () => recorded.recorded);
  return alepha;
};

describe("QuestBitmap", () => {
  it("round-trips a set, and two equal sets encode alike", ({ expect }) => {
    const numbers = [1, 7, 8, 9, 3786, 42];

    const encoded = QuestBitmap.encode(numbers);

    expect([...QuestBitmap.decode(encoded)].sort((a, b) => a - b)).toEqual([
      1, 7, 8, 9, 42, 3786,
    ]);
    expect(QuestBitmap.encode([...numbers].toReversed())).toBe(encoded);
    expect(QuestBitmap.encode([])).toBe("");
    expect(QuestBitmap.decode("").size).toBe(0);
  });

  it("keeps 5,000 quests well under a kilobyte", ({ expect }) => {
    const all = Array.from({ length: 5_000 }, (_, i) => i + 1);

    expect(QuestBitmap.encode(all).length).toBeLessThan(900);
  });

  it("refuses a number it cannot hold", ({ expect }) => {
    expect(() => QuestBitmap.encode([0])).toThrow(/out of range/);
    expect(() => QuestBitmap.encode([QuestBitmap.MAX_NUMBER + 1])).toThrow(
      /out of range/,
    );
  });
});

describe("live quests", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const world = async () => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: `Live ${crypto.randomUUID().slice(0, 8)}` } },
          { user },
        )
    ).data;
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "ship" },
        body: { enabled: true },
      },
      { user },
    );
    const copy = async (env: string) =>
      (
        await alepha
          .inject(AppController)
          .createApp.fetch(
            { params: { projectId: project.id }, body: { app: "my-app", env } },
            { user },
          )
      ).data;
    const instance = await copy("production");
    return { user, project, instance, copy };
  };

  const push = async (
    w: Awaited<ReturnType<typeof world>>,
    body: {
      tag?: string;
      commitSha?: string;
      dirty?: boolean;
      quests?: { base?: string; numbers: number[]; complete: boolean };
      walked?: string[];
      appQuests?: {
        paths: string;
        base?: string;
        numbers: number[];
        complete: boolean;
      };
      appWalked?: string[];
      filler?: string;
    },
  ) =>
    (
      await alepha.inject(ArtifactController).pushArtifact.fetch(
        {
          params: { projectId: w.project.id },
          body: {
            app: "my-app",
            tag: body.tag ?? "latest",
            commitSha: body.commitSha,
            dirty: body.dirty,
            file: await packedArtifact({
              manifest: {
                manifestVersion: 2,
                project: "my-app",
                runtimes: [{ runtime: "workerd", entry: "index.js" }],
              },
              filler: body.filler ?? crypto.randomUUID(),
            }),
            ...(body.quests
              ? { quests: { version: 1 as const, ...body.quests } }
              : {}),
            ...(body.walked
              ? {
                  commits: new File(
                    [JSON.stringify(body.walked)],
                    "commits.json",
                    { type: "application/json" },
                  ),
                }
              : {}),
            ...(body.appQuests
              ? { appQuests: { version: 1 as const, ...body.appQuests } }
              : {}),
            ...(body.appWalked
              ? {
                  appCommits: new File(
                    [JSON.stringify(body.appWalked)],
                    "app-commits.json",
                    { type: "application/json" },
                  ),
                }
              : {}),
          },
        },
        { user: w.user },
      )
    ).data;

  /**
   * A succeeded run, written as the runner leaves it.
   */
  const ran = async (
    w: Awaited<ReturnType<typeof world>>,
    run: {
      instanceId?: string;
      commitSha?: string;
      dirty?: boolean;
      at: string;
      status?: string;
    },
  ) =>
    await alepha.inject(TestRows).deployments.create({
      projectId: w.project.id,
      instanceId: run.instanceId ?? w.instance.id,
      app: "my-app",
      tag: "latest",
      sha256: "e".repeat(64),
      status: run.status ?? "succeeded",
      createdAt: run.at,
      finishedAt: run.at,
      ...(run.commitSha ? { commitSha: run.commitSha } : {}),
      ...(run.dirty === undefined ? {} : { dirty: run.dirty }),
    } as never);

  const setOf = async (projectId: number, commit: string) =>
    (
      await alepha.inject(CommitQuestSetService).setsOf(projectId, [commit])
    ).get(commit);

  describe("pushing a commit", () => {
    it("keeps the full set of a first push, with the quests whose recorded sha it walked", async ({
      expect,
    }) => {
      // The message refs, plus a quest named by no message whose recorded
      // sha (an abbreviated one) is among the walked commits: the rebased
      // history's second source.
      const w = await world();
      alepha.inject(TestRecordedCommits).recorded = [
        { number: 50, shas: [sha("b").slice(0, 9)], completed: true },
        { number: 51, shas: [sha("9")], completed: true },
      ];

      const result = await push(w, {
        commitSha: sha("a"),
        quests: { numbers: [12, 30], complete: true },
        walked: [sha("a"), sha("b")],
      });

      expect(result.quests).toEqual({ count: 3, complete: true });
      const set = await setOf(w.project.id, sha("a"));
      expect([...(set?.numbers ?? [])].sort((a, b) => a - b)).toEqual([
        12, 30, 50,
      ]);
      expect(set?.complete).toBe(true);
      const [artifact] = await alepha.inject(TestRows).artifacts.findMany({});
      expect(artifact?.commitSha).toBe(sha("a"));
    });

    it("adds the base's set to an incremental push", async ({ expect }) => {
      const w = await world();
      await push(w, {
        commitSha: sha("a"),
        quests: { numbers: [1, 2], complete: true },
        walked: [sha("a")],
      });

      await push(w, {
        commitSha: sha("c"),
        quests: { base: sha("a"), numbers: [3], complete: true },
        walked: [sha("c")],
      });

      const set = await setOf(w.project.id, sha("c"));
      expect([...(set?.numbers ?? [])].sort((a, b) => a - b)).toEqual([
        1, 2, 3,
      ]);
      expect(set?.complete).toBe(true);
    });

    it("is partial when it rests on a partial base, or a base Lore does not have", async ({
      expect,
    }) => {
      const w = await world();
      await push(w, {
        commitSha: sha("a"),
        quests: { numbers: [1], complete: false },
        walked: [sha("a")],
      });

      await push(w, {
        commitSha: sha("c"),
        quests: { base: sha("a"), numbers: [3], complete: true },
        walked: [sha("c")],
      });
      await push(w, {
        commitSha: sha("d"),
        quests: { base: sha("f"), numbers: [4], complete: true },
        walked: [sha("d")],
      });

      expect((await setOf(w.project.id, sha("c")))?.complete).toBe(false);
      expect((await setOf(w.project.id, sha("d")))?.complete).toBe(false);
      expect(
        [...((await setOf(w.project.id, sha("c")))?.numbers ?? [])].sort(
          (a, b) => a - b,
        ),
      ).toEqual([1, 3]);
    });

    it("lets a complete set replace a partial one, never the reverse", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      const input = {
        projectId: w.project.id,
        commitSha: sha("a"),
        walked: [],
      };

      await service.record({ ...input, numbers: [1, 9], complete: false });
      await service.record({ ...input, numbers: [1, 2], complete: true });
      await service.record({ ...input, numbers: [7], complete: false });

      const set = await setOf(w.project.id, sha("a"));
      expect([...(set?.numbers ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
      expect(set?.complete).toBe(true);
      expect(await alepha.inject(TestRows).sets.findMany({})).toHaveLength(1);
    });

    it("merges two partial sets of one commit", async ({ expect }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      const input = {
        projectId: w.project.id,
        commitSha: sha("a"),
        walked: [],
      };

      await service.record({ ...input, numbers: [1], complete: false });
      await service.record({ ...input, numbers: [2], complete: false });

      expect(
        [...((await setOf(w.project.id, sha("a")))?.numbers ?? [])].sort(
          (a, b) => a - b,
        ),
      ).toEqual([1, 2]);
    });

    it("records the set on an idempotent re-push of the same bytes", async ({
      expect,
    }) => {
      // The set belongs to the commit, not to the bytes.
      const w = await world();
      await push(w, { tag: "1.0.0", commitSha: sha("a"), filler: "same" });

      const again = await push(w, {
        tag: "1.0.0",
        commitSha: sha("a"),
        filler: "same",
        quests: { numbers: [5], complete: true },
        walked: [sha("a")],
      });

      expect(again.stored).toBe(false);
      expect(again.quests).toEqual({ count: 1, complete: true });
    });

    it("keeps no set without a commit, and stores dirty on the artifact", async ({
      expect,
    }) => {
      const w = await world();

      const result = await push(w, {
        dirty: true,
        quests: { numbers: [5], complete: true },
      });

      expect(result.quests).toBeUndefined();
      expect(await alepha.inject(TestRows).sets.findMany({})).toHaveLength(0);
      const [artifact] = await alepha.inject(TestRows).artifacts.findMany({});
      expect(artifact?.dirty).toBe(true);
    });

    it("takes a push carrying every part at once, past the framework's 10-part default", async ({
      expect,
    }) => {
      // app, tag, commitSha, force, manifest, quests, appQuests, dirty,
      // file, maps, schema, commits, appCommits: thirteen parts, where the
      // default refused eleven with a 413 before the gate ran.
      const w = await world();
      const json = (name: string, value: unknown) =>
        new File([JSON.stringify(value)], name, { type: "application/json" });

      const pushed = await alepha.inject(ArtifactController).pushArtifact.fetch(
        {
          params: { projectId: w.project.id },
          body: {
            app: "my-app",
            tag: "latest",
            commitSha: sha("a"),
            force: true,
            manifest: {
              manifestVersion: 2,
              project: "my-app",
              runtimes: [{ runtime: "node", entry: "index.node.js" }],
            } as never,
            quests: { version: 1, numbers: [3], complete: true },
            appQuests: {
              version: 1,
              paths: "docs",
              numbers: [3],
              complete: true,
            },
            dirty: false,
            file: await packedArtifact(),
            maps: new File(["maps"], "maps.tar.zst"),
            schema: json("schema.json", { version: 1, dialects: {} }),
            commits: json("commits.json", [sha("a")]),
            appCommits: json("app-commits.json", [sha("a")]),
          },
        },
        { user: w.user },
      );

      expect(pushed.data.quests).toEqual({ count: 1, complete: true });
      expect(pushed.data.appQuests).toEqual({ count: 1, complete: true });
    });

    it("refuses a commit list that is not one", async ({ expect }) => {
      const w = await world();

      await expect(
        alepha.inject(ArtifactController).pushArtifact.fetch(
          {
            params: { projectId: w.project.id },
            body: {
              app: "my-app",
              tag: "latest",
              commitSha: sha("a"),
              file: await packedArtifact(),
              quests: { version: 1, numbers: [1], complete: true },
              commits: new File(['["not a sha"]'], "commits.json"),
            },
          },
          { user: w.user },
        ),
      ).rejects.toThrow(/not a list of commit shas/);
      expect(await alepha.inject(TestRows).artifacts.findMany({})).toHaveLength(
        0,
      );
    });
  });

  describe("the known-commits read", () => {
    it("answers which of 200 shas have a set, in the order asked, past D1's parameter limit", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      const shas = Array.from({ length: 200 }, (_, i) =>
        i.toString(16).padStart(40, "0"),
      );
      await service.record({
        projectId: w.project.id,
        commitSha: shas[150] as string,
        numbers: [1],
        walked: [],
        complete: true,
      });
      await service.record({
        projectId: w.project.id,
        commitSha: shas[3] as string,
        numbers: [1],
        walked: [],
        complete: false,
      });

      const answer = (
        await alepha
          .inject(LiveQuestController)
          .findKnownCommits.fetch(
            { params: { projectId: w.project.id }, body: { shas } },
            { user: w.user },
          )
      ).data;

      expect(answer.known).toEqual([
        { sha: shas[3], complete: false },
        { sha: shas[150], complete: true },
      ]);
    });

    it("never answers another project's sets", async ({ expect }) => {
      const first = await world();
      const second = await world();
      await alepha.inject(CommitQuestSetService).record({
        projectId: first.project.id,
        commitSha: sha("a"),
        numbers: [1],
        walked: [],
        complete: true,
      });

      expect(
        await alepha
          .inject(CommitQuestSetService)
          .known(second.project.id, [sha("a")]),
      ).toEqual([]);
    });
  });

  describe("an app that declares its paths (#Q3868)", () => {
    const docs = { app: "my-app", paths: "docs" };

    const appSetOf = async (projectId: number, commit: string) =>
      (
        await alepha
          .inject(CommitQuestSetService)
          .appSetsOf(projectId, [{ app: "my-app", sha: commit }])
      ).get(CommitQuestSetService.appKey("my-app", commit));

    const sorted = (numbers: Set<number> | undefined) =>
      [...(numbers ?? [])].sort((a, b) => a - b);

    it("keeps the app's set beside the whole history, and reads it as what is live", async ({
      expect,
    }) => {
      const w = await world();
      alepha.inject(TestRecordedCommits).recorded = [
        // Recorded on a commit that touched the paths, and on one that did
        // not (the pushed commit itself): only the first is the app's.
        { number: 50, shas: [sha("b")], completed: true },
        { number: 51, shas: [sha("a")], completed: true },
        // Done, and merged after this build.
        { number: 60, shas: [sha("9")], completed: true },
      ];

      const result = await push(w, {
        commitSha: sha("a"),
        quests: { numbers: [1, 2, 3], complete: true },
        walked: [sha("a"), sha("b")],
        appQuests: { paths: "docs", numbers: [2], complete: true },
        appWalked: [sha("b")],
      });
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      expect(result.quests).toEqual({ count: 5, complete: true });
      expect(result.appQuests).toEqual({ count: 2, complete: true });
      expect(sorted((await setOf(w.project.id, sha("a")))?.numbers)).toEqual([
        1, 2, 3, 50, 51,
      ]);
      expect(sorted((await appSetOf(w.project.id, sha("a")))?.numbers)).toEqual(
        [2, 50],
      );

      const live = alepha.inject(LiveQuestService);
      const detail = await live.instance(w.project.id, w.instance.id);
      expect(detail?.state).toBe("known");
      expect(detail?.scoped).toBe(true);
      expect(detail?.live).toEqual([2, 50]);
      // A quest of another app in the same history is live nowhere here.
      expect(await live.whereLive(w.project.id, 1)).toEqual([]);
      expect(await live.whereLive(w.project.id, 2)).toMatchObject([
        { instanceId: w.instance.id, app: "my-app" },
      ]);
      // Behind stays on the whole history: 51 is merged in this build, so
      // it is not behind although the app's paths never saw it.
      expect(detail?.behind).toEqual([60]);
      expect(
        (await live.behindCounts(w.project.id, [w.instance.id])).get(
          w.instance.id,
        ),
      ).toBe(1);
    });

    it("builds on the app's own base, walked with the same paths", async ({
      expect,
    }) => {
      const w = await world();
      await push(w, {
        commitSha: sha("a"),
        quests: { numbers: [1, 2], complete: true },
        walked: [sha("a")],
        appQuests: { paths: "docs", numbers: [2], complete: true },
        appWalked: [sha("a")],
      });
      await push(w, {
        commitSha: sha("c"),
        quests: { base: sha("a"), numbers: [3], complete: true },
        walked: [sha("c")],
        appQuests: {
          paths: "docs",
          base: sha("a"),
          numbers: [],
          complete: true,
        },
        appWalked: [],
      });

      // The whole history's base is never the app's: 1 stays out.
      const set = await appSetOf(w.project.id, sha("c"));
      expect(sorted(set?.numbers)).toEqual([2]);
      expect(set?.complete).toBe(true);
      expect(sorted((await setOf(w.project.id, sha("c")))?.numbers)).toEqual([
        1, 2, 3,
      ]);
    });

    it("knows a commit for an app only with the paths its set was walked with", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      await service.record({
        projectId: w.project.id,
        commitSha: sha("a"),
        scope: docs,
        numbers: [2],
        walked: [],
        complete: true,
      });
      const ask = async (body: { app?: string; paths?: string }) =>
        (
          await alepha.inject(LiveQuestController).findKnownCommits.fetch(
            {
              params: { projectId: w.project.id },
              body: { shas: [sha("a")], ...body },
            },
            { user: w.user },
          )
        ).data;

      // The app is echoed, so a pusher can tell this Lore from one that
      // ignores the question and answers the whole-history sets.
      expect(await ask(docs)).toEqual({
        known: [{ sha: sha("a"), complete: true }],
        app: "my-app",
      });
      expect(await ask({ app: "my-app", paths: "docs\nlib" })).toEqual({
        known: [],
        app: "my-app",
      });
      expect(await ask({ app: "other", paths: "docs" })).toEqual({
        known: [],
        app: "other",
      });
      // The app's set is not a whole-history one.
      expect(await ask({})).toEqual({ known: [] });
    });

    it("starts over when the paths change: a base walked with others is none, and the row is replaced", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      await service.record({
        projectId: w.project.id,
        commitSha: sha("a"),
        scope: docs,
        numbers: [2],
        walked: [],
        complete: true,
      });

      // A pusher that still names the old base: partial, and nothing of
      // the old set is carried over.
      const stale = await service.record({
        projectId: w.project.id,
        commitSha: sha("c"),
        scope: { app: "my-app", paths: "lib" },
        base: sha("a"),
        numbers: [7],
        walked: [],
        complete: true,
      });
      expect(sorted(stale.numbers)).toEqual([7]);
      expect(stale.complete).toBe(false);

      // The same commit pushed again with new paths: the complete set the
      // old paths found is replaced, not kept.
      await service.record({
        projectId: w.project.id,
        commitSha: sha("a"),
        scope: { app: "my-app", paths: "lib" },
        numbers: [9],
        walked: [],
        complete: true,
      });
      const set = await appSetOf(w.project.id, sha("a"));
      expect(sorted(set?.numbers)).toEqual([9]);
      expect(set?.paths).toBe("lib");
    });

    it("claims no diff between a run walked with the app's paths and one that was not", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      const whole = { walked: [], complete: true };
      await service.record({
        ...whole,
        projectId: w.project.id,
        commitSha: sha("a"),
        numbers: [1, 2],
      });
      await service.record({
        ...whole,
        projectId: w.project.id,
        commitSha: sha("b"),
        numbers: [1, 2, 3],
      });
      await service.record({
        ...whole,
        projectId: w.project.id,
        commitSha: sha("b"),
        scope: docs,
        numbers: [2, 3],
      });
      // Deployed before the app declared its paths, then after.
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      await ran(w, { commitSha: sha("b"), at: "2026-11-02T00:00:00.000Z" });

      const live = alepha.inject(LiveQuestService);
      const detail = await live.instance(w.project.id, w.instance.id);

      expect(detail?.live).toEqual([2, 3]);
      expect(detail?.runs[0]).toEqual({
        deploymentId: detail?.runs[0]?.deploymentId,
        known: false,
      });
      // "Since" still reaches back through the older run: 2 was live then
      // too.
      expect((await live.whereLive(w.project.id, 2))[0]?.since).toBe(
        "2026-11-01T00:00:00.000Z",
      );
    });

    it("leaves a copy of another app in the project on the whole history", async ({
      expect,
    }) => {
      const w = await world();
      const service = alepha.inject(CommitQuestSetService);
      await service.record({
        projectId: w.project.id,
        commitSha: sha("a"),
        numbers: [1, 2],
        walked: [],
        complete: true,
      });
      await service.record({
        projectId: w.project.id,
        commitSha: sha("a"),
        scope: { app: "other-app", paths: "docs" },
        numbers: [2],
        walked: [],
        complete: true,
      });
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      const detail = await alepha
        .inject(LiveQuestService)
        .instance(w.project.id, w.instance.id);

      expect(detail?.scoped).toBeUndefined();
      expect(detail?.live).toEqual([1, 2]);
    });
  });

  describe("a deployment's commit", () => {
    const onHost = async (type: "cloudflare" | "bay") => {
      const w = await world();
      const rows = alepha.inject(TestRows);
      const host = await rows.hosts.create({
        projectId: w.project.id,
        ownerUserId: w.user.id,
        type,
        slug: `${type}-${crypto.randomUUID().slice(0, 6)}`,
        deployAllowed: true,
        credentialStatus: "valid",
        ...(type === "cloudflare"
          ? { accountId: "acct", credential: "sealed" }
          : {}),
      } as never);
      await rows.grants.create({ hostId: host.id, projectId: w.project.id });
      await rows.instances.updateById(w.instance.id, { hostId: host.id });
      return w;
    };

    it("is snapshotted from the artifact on Cloudflare, and survives latest being replaced", async ({
      expect,
    }) => {
      // A UI deploy of a CI push: the deploy runs no git, the commit follows
      // the bytes.
      const w = await onHost("cloudflare");
      await push(w, { commitSha: sha("a"), dirty: true });

      const row = await alepha.inject(DeployService).queue({
        projectId: w.project.id,
        instanceId: w.instance.id,
        tag: "latest",
      });
      await push(w, { commitSha: sha("b") });

      const kept = await alepha.inject(TestRows).deployments.findById(row.id);
      expect(kept?.commitSha).toBe(sha("a"));
      expect(kept?.dirty).toBe(true);
    });

    it("is snapshotted from the artifact on a Bay machine", async ({
      expect,
    }) => {
      const w = await onHost("bay");
      await alepha.inject(ArtifactController).pushArtifact.fetch(
        {
          params: { projectId: w.project.id },
          body: {
            app: "my-app",
            tag: "latest",
            commitSha: sha("a"),
            dirty: false,
            file: await packedArtifact(),
          },
        },
        { user: w.user },
      );

      const row = await alepha.inject(DeployService).queue({
        projectId: w.project.id,
        instanceId: w.instance.id,
        tag: "latest",
      });

      expect(row.commandId).toBeDefined();
      expect(row.commitSha).toBe(sha("a"));
      expect(row.dirty).toBe(false);
    });

    it("is copied from the TARGET run by a fast rollback", async ({
      expect,
    }) => {
      const w = await onHost("cloudflare");
      const rows = alepha.inject(TestRows);
      await rows.instances.updateById(w.instance.id, {
        resourceName: "acme-my-app",
      });
      const target = await rows.deployments.create({
        projectId: w.project.id,
        instanceId: w.instance.id,
        app: "my-app",
        tag: "1.0.0",
        sha256: "e".repeat(64),
        status: "succeeded",
        versionId: "v1",
        migrationsApplied: 0,
        commitSha: sha("a"),
        dirty: true,
        createdAt: "2026-11-01T00:00:00.000Z",
      } as never);
      await rows.deployments.create({
        projectId: w.project.id,
        instanceId: w.instance.id,
        app: "my-app",
        tag: "latest",
        sha256: "f".repeat(64),
        status: "succeeded",
        versionId: "v2",
        migrationsApplied: 0,
        commitSha: sha("b"),
        createdAt: "2026-11-02T00:00:00.000Z",
      } as never);
      const service = alepha.inject(RollbackService);
      Object.assign(service as unknown as Record<string, unknown>, {
        seal: { open: () => "token" },
      });
      const listVersions = CloudflareDeployClient.prototype.listVersions;
      const rollbackTo = CloudflareDeployClient.prototype.rollbackTo;
      CloudflareDeployClient.prototype.listVersions = async () => [
        { id: "v1" },
        { id: "v2" },
      ];
      CloudflareDeployClient.prototype.rollbackTo = async () => undefined;
      try {
        await service.rollback(w.project.id, target.id);
      } finally {
        CloudflareDeployClient.prototype.listVersions = listVersions;
        CloudflareDeployClient.prototype.rollbackTo = rollbackTo;
      }

      const [newest] = await rows.deployments.findMany({
        where: { instanceId: { eq: w.instance.id } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: 1,
      });
      expect(newest?.status).toBe("succeeded");
      expect(newest?.commitSha).toBe(sha("a"));
      expect(newest?.dirty).toBe(true);
    });
  });

  describe("reading what runs", () => {
    const record = async (
      projectId: number,
      commit: string,
      numbers: number[],
      complete = true,
    ) =>
      await alepha.inject(CommitQuestSetService).record({
        projectId,
        commitSha: commit,
        numbers,
        walked: [],
        complete,
      });

    it("is the newest succeeded run's commit's set, so a rollback by either path is right with nothing recomputed", async ({
      expect,
    }) => {
      const w = await world();
      await record(w.project.id, sha("a"), [1, 2]);
      await record(w.project.id, sha("b"), [1, 2, 3]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      await ran(w, { commitSha: sha("b"), at: "2026-11-02T00:00:00.000Z" });
      await ran(w, {
        commitSha: sha("c"),
        at: "2026-11-02T12:00:00.000Z",
        status: "failed",
      });
      // The artifact-path rollback: an ordinary deploy of the older bytes.
      await ran(w, { commitSha: sha("a"), at: "2026-11-03T00:00:00.000Z" });

      const detail = await alepha
        .inject(LiveQuestService)
        .instance(w.project.id, w.instance.id);

      expect(detail?.state).toBe("known");
      expect(detail?.live).toEqual([1, 2]);
      expect(detail?.runs[0]).toMatchObject({
        known: true,
        added: [],
        removed: [3],
      });
      expect(detail?.runs[1]).toMatchObject({ added: [3], removed: [] });
      expect(
        await alepha.inject(LiveQuestService).whereLive(w.project.id, 3),
      ).toEqual([]);
    });

    it("says since when, from the newest unbroken run carrying the quest", async ({
      expect,
    }) => {
      const w = await world();
      await record(w.project.id, sha("a"), [1]);
      await record(w.project.id, sha("b"), [2]);
      await record(w.project.id, sha("c"), [1, 2]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      await ran(w, { commitSha: sha("b"), at: "2026-11-02T00:00:00.000Z" });
      await ran(w, { commitSha: sha("c"), at: "2026-11-03T00:00:00.000Z" });
      await ran(w, {
        commitSha: sha("c"),
        dirty: true,
        at: "2026-11-04T00:00:00.000Z",
      });

      const live = alepha.inject(LiveQuestService);

      expect(await live.whereLive(w.project.id, 1)).toEqual([
        {
          instanceId: w.instance.id,
          app: "my-app",
          env: "production",
          dirty: true,
          since: "2026-11-03T00:00:00.000Z",
        },
      ]);
      expect((await live.whereLive(w.project.id, 2))[0]?.since).toBe(
        "2026-11-02T00:00:00.000Z",
      );
    });

    it("counts behind as completed quests with a recorded commit, minus the live set", async ({
      expect,
    }) => {
      const w = await world();
      alepha.inject(TestRecordedCommits).recorded = [
        { number: 1, shas: [sha("1")], completed: true },
        { number: 2, shas: [sha("2")], completed: true },
        { number: 3, shas: [sha("3")], completed: false },
      ];
      await record(w.project.id, sha("a"), [1, 4]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      const detail = await alepha
        .inject(LiveQuestService)
        .instance(w.project.id, w.instance.id);

      expect(detail?.behind).toEqual([2]);
    });

    it("is not behind on a quest completed before the copy first deployed a commit", async ({
      expect,
    }) => {
      const w = await world();
      const live = alepha.inject(LiveQuestService);
      alepha.inject(TestRecordedCommits).recorded = [
        // Its sha is in no history: done before the copy existed, it is
        // nothing the copy was ever waiting for.
        {
          number: 1,
          shas: [sha("1")],
          completed: true,
          completedAt: "2026-10-01T00:00:00.000Z",
        },
        // Done after the first deployment, and not in the newest one.
        {
          number: 2,
          shas: [sha("2")],
          completed: true,
          completedAt: "2026-11-02T00:00:00.000Z",
        },
      ];
      await record(w.project.id, sha("a"), [4]);
      await record(w.project.id, sha("b"), [4, 5]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      await ran(w, { commitSha: sha("b"), at: "2026-11-03T00:00:00.000Z" });

      expect(
        (await live.instance(w.project.id, w.instance.id))?.behind,
      ).toEqual([2]);
      expect(
        (await live.behindCounts(w.project.id, [w.instance.id])).get(
          w.instance.id,
        ),
      ).toBe(1);
    });

    it("is unknown, never empty, for a copy that never deployed, a run from before the commit, or a commit with no set", async ({
      expect,
    }) => {
      const w = await world();
      const preEpic = await w.copy("staging");
      const noSet = await w.copy("preview");
      await ran(w, { instanceId: preEpic.id, at: "2026-11-01T00:00:00.000Z" });
      await ran(w, {
        instanceId: noSet.id,
        commitSha: sha("d"),
        at: "2026-11-01T00:00:00.000Z",
      });

      const states = await alepha.inject(LiveQuestService).states(w.project.id);
      const reasonOf = (id: string) =>
        states.find((state) => state.instanceId === id);

      expect(reasonOf(w.instance.id)).toMatchObject({
        state: "unknown",
        reason: "never-deployed",
      });
      expect(reasonOf(preEpic.id)).toMatchObject({
        state: "unknown",
        reason: "no-commit",
      });
      expect(reasonOf(noSet.id)).toMatchObject({
        state: "unknown",
        reason: "no-set",
      });
      const detail = await alepha
        .inject(LiveQuestService)
        .instance(w.project.id, preEpic.id);
      expect(detail?.live).toBeUndefined();
      expect(detail?.behind).toBeUndefined();
      expect(
        (await alepha.inject(LiveQuestService).projectLiveness(w.project.id))
          .settled,
      ).toBe(false);
    });

    it("shows a partial set's quests, but claims no behind and does not settle", async ({
      expect,
    }) => {
      const w = await world();
      alepha.inject(TestRecordedCommits).recorded = [
        { number: 2, shas: [sha("2")], completed: true },
      ];
      await record(w.project.id, sha("a"), [1], false);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      const live = alepha.inject(LiveQuestService);
      const detail = await live.instance(w.project.id, w.instance.id);

      expect(detail).toMatchObject({ state: "partial", reason: "partial" });
      expect(detail?.live).toEqual([1]);
      expect(detail?.behind).toBeUndefined();
      expect((await live.whereLive(w.project.id, 1)).length).toBe(1);
      expect((await live.projectLiveness(w.project.id)).settled).toBe(false);
    });

    it("settles a project whose deployed copies all have a complete set, ignoring copies Lore never deployed", async ({
      expect,
    }) => {
      const w = await world();
      await w.copy("staging");
      await record(w.project.id, sha("a"), [1]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      const liveness = await alepha
        .inject(LiveQuestService)
        .projectLiveness(w.project.id);

      expect(liveness.settled).toBe(true);
      expect(liveness.live.get(1)).toHaveLength(1);
      expect(liveness.live.has(2)).toBe(false);
    });

    it("answers through the core registry, which is how Plan reads it", async ({
      expect,
    }) => {
      const w = await world();
      await record(w.project.id, sha("a"), [7]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });

      const registry = alepha.inject(LiveQuestRegistry);

      expect(await registry.whereLive(w.project.id, 7)).toHaveLength(1);
      expect(
        (await registry.projectLiveness(w.project.id))?.live.get(7),
      ).toHaveLength(1);
    });

    it("puts a behind count on each listed copy with a known set, and none on the others", async ({
      expect,
    }) => {
      const w = await world();
      alepha.inject(TestRecordedCommits).recorded = [
        { number: 1, shas: [sha("1")], completed: true },
        { number: 2, shas: [sha("2")], completed: true },
        { number: 3, shas: [sha("3")], completed: true },
      ];
      const preEpic = await w.copy("staging");
      await record(w.project.id, sha("a"), [1]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      await ran(w, { instanceId: preEpic.id, at: "2026-11-01T00:00:00.000Z" });

      const { items } = (
        await alepha
          .inject(AppController)
          .listApps.fetch(
            { params: { projectId: w.project.id } },
            { user: w.user },
          )
      ).data;

      const byEnv = new Map(items.map((it: any) => [it.env, it]));
      expect(byEnv.get("production")?.behind).toBe(2);
      expect(byEnv.get("staging")?.behind).toBeUndefined();
    });

    it("serves an instance's live quests and a quest's copies over HTTP", async ({
      expect,
    }) => {
      const w = await world();
      await record(w.project.id, sha("a"), [7]);
      await ran(w, { commitSha: sha("a"), at: "2026-11-01T00:00:00.000Z" });
      const controller = alepha.inject(LiveQuestController);

      const instance = (
        await controller.getInstanceLiveQuests.fetch(
          { params: { projectId: w.project.id, instanceId: w.instance.id } },
          { user: w.user },
        )
      ).data;
      const quest = (
        await controller.getQuestLiveness.fetch(
          { params: { projectId: w.project.id, number: 7 } },
          { user: w.user },
        )
      ).data;

      expect(instance).toMatchObject({ state: "known", live: [7], behind: [] });
      expect(quest.settled).toBe(true);
      expect(quest.instances).toHaveLength(1);
    });
  });
});
