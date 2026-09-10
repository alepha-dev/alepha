import { Alepha, type FileLike, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ArtifactController } from "../src/api/controllers/ArtifactController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { artifacts } from "../src/api/entities/artifacts.ts";
import { LoreApi } from "../src/api/index.ts";
import { ArtifactService } from "../src/api/services/ArtifactService.ts";
import { RegistryTransport } from "../src/api/services/RegistryTransport.ts";
import { packedArtifact, tar } from "./fixtures/artifactTarball.ts";
import { MemoryRegistryTransport } from "./fixtures/MemoryRegistryTransport.ts";

/**
 * The registry half of epic #18: CI pushes what it built, and Lore keeps it.
 *
 * The properties worth a test here are the ones that would be quietly wrong
 * rather than loudly broken:
 *
 * - **The runtime comes out of the artifact, never out of its filename.** A
 *   mislabelled upload lands where the manifest says, or the whole "one tag,
 *   N runtimes" model is decoration.
 * - **Identical bytes pushed twice are one row.** A re-run of a CI job is not
 *   a second artifact, and answering it with a conflict turns a green pipeline
 *   red for succeeding.
 * - **Different bytes under a tag that already exists are refused.** A tag
 *   that changed underneath a deploy makes "which version is running here"
 *   unanswerable.
 * - **A tarball that is not an Alepha artifact never gets a row.** The manifest
 *   check is what separates a registry from a bucket with a table beside it.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class TestRows {
  public readonly artifacts = $repository(artifacts);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  artifactController: ArtifactController;
  artifactService: ArtifactService;
  rows: TestRows;
  fakeProvider: FakeProvider;
  registry: MemoryRegistryTransport;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  // ⚠️ BEFORE the modules that inject it. A substitution registered after the
  // service has been resolved is a `TooLateSubstitutionError`, and `LoreApi`
  // resolves `ArtifactService` - which holds the registry client - on the way
  // in. Substituted rather than mocked, so the whole file still runs with no
  // network and no credential.
  alepha.with({ provide: RegistryTransport, use: MemoryRegistryTransport });

  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    artifactController: alepha.inject(ArtifactController),
    artifactService: alepha.inject(ArtifactService),
    rows: alepha.inject(TestRows),
    fakeProvider: alepha.inject(FakeProvider),
    registry: alepha.inject(MemoryRegistryTransport),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

describe("artifacts", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const aProject = async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: `Artifacts ${crypto.randomUUID().slice(0, 8)}` } },
      { user: owner },
    );
    return { owner, projectId: project.data.id };
  };

  const push = async (
    projectId: number,
    user: { id: string },
    body: {
      app?: string;
      tag?: string;
      commitSha?: string;
      force?: boolean;
      file: File;
      maps?: File;
    },
  ) =>
    ctx.artifactController.pushArtifact.fetch(
      {
        params: { projectId },
        body: {
          app: body.app ?? "my-app",
          tag: body.tag ?? "1.2.3",
          commitSha: body.commitSha,
          force: body.force,
          file: body.file,
          maps: body.maps,
        },
      },
      { user },
    );

  /**
   * A stand-in for the `.maps.tar.gz` the packer writes beside an artifact.
   *
   * Its contents do not matter: unlike the artifact it is never read for a
   * manifest, never digested and never validated. What matters is that it is a
   * distinct object with distinct bytes, so a test can tell which one a row
   * points at.
   */
  const mapsArchive = (marker = "one") =>
    new File([`source-maps-${marker}`], "app-1.2.3.maps.tar.gz", {
      type: "application/gzip",
    });

  /**
   * The status a refusal came back with, so the specs below assert 400 or 409
   * rather than "something threw".
   *
   * A bad artifact is the caller's fault and has to read as one: a 500 blames
   * Lore for a request it was right to refuse, and a CI log full of "Internal
   * Server Error" tells nobody what to fix.
   */
  /**
   * The image sibling of `push`. Same defaults, and no `runtime` field to
   * pass even if a case wanted to.
   */
  const pushImage = async (
    projectId: number,
    user: { id: string },
    body: {
      app?: string;
      tag?: string;
      reference?: string;
      commitSha?: string;
      force?: boolean;
      digest?: string;
    },
  ) =>
    ctx.artifactController.pushImage.fetch(
      {
        params: { projectId },
        body: {
          app: body.app ?? "my-app",
          tag: body.tag ?? "0.30.0",
          reference: body.reference ?? "ghcr.io/alepha-dev/lore:0.30.0",
          commitSha: body.commitSha,
          force: body.force,
          digest: body.digest,
        },
      },
      { user },
    );

  const statusOf = async (call: Promise<unknown>): Promise<number> => {
    try {
      await call;
    } catch (error) {
      return HttpError.is(error) ? error.status : 500;
    }
    return 200;
  };

  describe("pushing a build", () => {
    it("stores it, addressed by sha256", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const result = await push(projectId, owner, {
        file: await packedArtifact(),
        commitSha: "0b35cb375",
      });

      expect(result.data.stored).toBe(true);
      expect(result.data.artifact.app).toBe("my-app");
      expect(result.data.artifact.tag).toBe("1.2.3");
      expect(result.data.artifact.runtime).toBe("node");
      expect(result.data.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.data.artifact.size).toBeGreaterThan(0);
      expect(result.data.artifact.commitSha).toBe("0b35cb375");
    });

    /**
     * The row must not carry the `files` id: it is how Lore stores the bytes,
     * not how a caller addresses them, and publishing it would invite a client
     * to fetch through the framework's own file endpoint instead of one that
     * knows what an artifact is.
     */
    it("does not publish the framework file id", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const result = await push(projectId, owner, {
        file: await packedArtifact(),
      });

      expect("fileId" in result.data.artifact).toBe(false);
    });

    it("keeps the bytes in the artifacts storage", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, { file: await packedArtifact() });

      const [row] = await ctx.rows.artifacts.findMany({});
      // A pushed archive always has bytes; the column is optional only
      // because an IMAGE row has none, and this spec pushes a tarball.
      expect(row.format).toBe("archive");
      expect(row.fileId).toBeDefined();
      const stored = await ctx.artifactController.artifactBucket.get(
        row.fileId as string,
      );
      expect(stored.bucket).toBe(ArtifactService.BUCKET);
      expect(stored.size).toBe(row.size);
    });

    it("lowercases the app name and preserves the tag's case", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const result = await push(projectId, owner, {
        app: "My-App",
        tag: "RC1",
        file: await packedArtifact(),
      });

      expect(result.data.artifact.app).toBe("my-app");
      // The join key to `releases.tag`, which CI derives from a git tag byte
      // for byte. Lowercasing it would break the join for anything but a
      // lowercase tag, silently.
      expect(result.data.artifact.tag).toBe("RC1");
    });
  });

  describe("the runtime", () => {
    /**
     * The whole reason `runtime` is a column rather than part of a filename.
     */
    it("comes from the manifest, never from the filename", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const result = await push(projectId, owner, {
        file: await packedArtifact({
          manifest: { version: 1, runtime: "workerd" },
          name: "my-app_1.2.3_node.tar.gz",
        }),
      });

      expect(result.data.artifact.runtime).toBe("workerd");
    });

    it("refuses an artifact that declares none", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      expect(
        await statusOf(
          push(projectId, owner, {
            file: await packedArtifact({ manifest: { version: 1 } }),
          }),
        ),
      ).toBe(400);
    });
  });

  describe("the manifest check", () => {
    it("refuses a tarball carrying no manifest", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      expect(
        await statusOf(
          push(projectId, owner, {
            file: await packedArtifact({ manifest: null }),
          }),
        ),
      ).toBe(400);
    });

    it("refuses a manifest whose version is not 1", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      expect(
        await statusOf(
          push(projectId, owner, {
            file: await packedArtifact({
              manifest: { version: 2, runtime: "node" },
            }),
          }),
        ),
      ).toBe(400);
    });

    it("refuses bytes that are not a gzip archive", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      const notGzip = new File(
        [tar({ "dist/manifest.json": "{}" }) as BlobPart],
        "my-app.tar.gz",
        { type: "application/gzip" },
      );

      // ⚠️ 400, not 500. The inflate failure surfaces on the first read of the
      // decompression stream, well inside the reader, and an uncaught one
      // there would answer a malformed upload with "Internal Server Error".
      expect(await statusOf(push(projectId, owner, { file: notGzip }))).toBe(
        400,
      );
    });

    it("leaves no row and no bytes behind when it refuses", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      expect(
        await statusOf(
          push(projectId, owner, {
            file: await packedArtifact({ manifest: null }),
          }),
        ),
      ).toBe(400);

      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(0);
      const held = await ctx.artifactController.artifactBucket.list({});
      expect(held.content).toHaveLength(0);
    });
  });

  describe("re-pushing", () => {
    it("recognises identical bytes instead of storing them twice", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const first = await push(projectId, owner, {
        file: await packedArtifact(),
      });
      const second = await push(projectId, owner, {
        file: await packedArtifact(),
      });

      expect(second.data.stored).toBe(false);
      expect(second.data.artifact.id).toBe(first.data.artifact.id);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
      const held = await ctx.artifactController.artifactBucket.list({});
      expect(held.content).toHaveLength(1);
    });

    it("refuses different bytes under a tag that already exists", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, { file: await packedArtifact() });

      expect(
        await statusOf(
          push(projectId, owner, {
            file: await packedArtifact({ filler: "// a later commit" }),
          }),
        ),
      ).toBe(409);
    });

    /**
     * The message is the whole remedy. A pusher that hits this has tagged the
     * wrong commit, and the fix is one flag away - but only if the refusal
     * names it.
     */
    it("names --force in the refusal", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, { file: await packedArtifact() });

      await expect(
        push(projectId, owner, {
          file: await packedArtifact({ filler: "// a later commit" }),
        }),
      ).rejects.toThrow(/--force/);
    });

    /**
     * `1.2.3` for workerd and `1.2.3` for node are one release with two
     * variants, so the second must not read as a conflict with the first.
     */
    it("keeps one row per runtime under the same tag", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        file: await packedArtifact({
          manifest: { version: 1, runtime: "node" },
        }),
      });
      await push(projectId, owner, {
        file: await packedArtifact({
          manifest: { version: 1, runtime: "workerd" },
        }),
      });

      const rows = await ctx.rows.artifacts.findMany({});
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.runtime).sort()).toEqual([
        "node",
        "workerd",
      ]);
    });
  });

  describe("the latest tag", () => {
    /**
     * `latest` replacing in place IS the retention policy: one row, one stored
     * object, no sweep job to schedule and nothing to cap.
     */
    it("replaces in place, leaving one row and one stored object", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const first = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
      });
      const second = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "// a later commit" }),
      });

      expect(second.data.stored).toBe(true);
      // The same row, moved - not a second one beside the first.
      expect(second.data.artifact.id).toBe(first.data.artifact.id);
      expect(second.data.artifact.sha256).not.toBe(first.data.artifact.sha256);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);

      // The previous bytes are reclaimed, which is the half a row count
      // cannot see: a replace that only rewrote the row would leave every
      // superseded build in the bucket forever.
      const held = await ctx.artifactController.artifactBucket.list({});
      expect(held.content).toHaveLength(1);
    });

    it("re-pushing the same bytes churns nothing", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const first = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
      });
      const second = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
      });

      expect(second.data.stored).toBe(false);
      expect(second.data.artifact.updatedAt).toBe(
        first.data.artifact.updatedAt,
      );
      const held = await ctx.artifactController.artifactBucket.list({});
      expect(held.content).toHaveLength(1);
    });

    /**
     * ⚠️ The ORM reads an explicit `undefined` as an absent key, so the naive
     * update leaves the row naming the commit that produced the bytes it just
     * threw away.
     */
    it("clears the commit when the replacing push names none", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        tag: "latest",
        commitSha: "0b35cb375",
        file: await packedArtifact(),
      });
      const second = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "// pushed from a laptop" }),
      });

      expect(second.data.artifact.commitSha).toBeUndefined();
    });
  });

  describe("force", () => {
    it("moves a pinned tag onto new bytes", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const first = await push(projectId, owner, {
        tag: "1.2.3",
        file: await packedArtifact(),
      });
      const forced = await push(projectId, owner, {
        tag: "1.2.3",
        force: true,
        file: await packedArtifact({ filler: "// the right commit this time" }),
      });

      expect(forced.data.artifact.id).toBe(first.data.artifact.id);
      expect(forced.data.artifact.sha256).not.toBe(first.data.artifact.sha256);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
      const held = await ctx.artifactController.artifactBucket.list({});
      expect(held.content).toHaveLength(1);
    });

    /**
     * A CI job that always passes `--force` should not have to know which tag
     * it is pushing, so passing it where it changes nothing is not an error.
     */
    it("is inert on a first push", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const fresh = await push(projectId, owner, {
        tag: "2.0.0",
        force: true,
        file: await packedArtifact(),
      });

      expect(fresh.data.stored).toBe(true);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
    });

    it("does not turn identical bytes into a replace", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const first = await push(projectId, owner, {
        tag: "2.0.0",
        force: true,
        file: await packedArtifact(),
      });
      const same = await push(projectId, owner, {
        tag: "2.0.0",
        force: true,
        file: await packedArtifact(),
      });

      // `--force` says "you may move this tag", never "move it anyway": the
      // sha256 check comes first, so a forced re-push of the same build still
      // stores nothing and leaves `updatedAt` where it was.
      expect(same.data.stored).toBe(false);
      expect(same.data.artifact.updatedAt).toBe(first.data.artifact.updatedAt);
    });

    it("is inert on latest, which moves either way", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
      });
      const forced = await push(projectId, owner, {
        tag: "latest",
        force: true,
        file: await packedArtifact({ filler: "// a later commit" }),
      });

      expect(forced.data.stored).toBe(true);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
    });
  });

  describe("listing", () => {
    const list = async (
      projectId: number,
      user: { id: string },
      query: { app?: string; tag?: string } = {},
    ) =>
      ctx.artifactController.listArtifacts.fetch(
        { params: { projectId }, query },
        { user },
      );

    /**
     * The property the whole `(app, tag, runtime)` key exists for. A flat list
     * would render one release as two, on the first screen anyone sees.
     */
    it("folds every runtime of a tag into one group", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        tag: "1.2.3",
        file: await packedArtifact({
          manifest: { version: 1, runtime: "workerd" },
        }),
      });
      await push(projectId, owner, {
        tag: "1.2.3",
        file: await packedArtifact({
          manifest: { version: 1, runtime: "node" },
        }),
      });

      const { groups } = (await list(projectId, owner)).data;

      expect(groups).toHaveLength(1);
      expect(groups[0].tag).toBe("1.2.3");
      // Sorted by runtime, so the group does not reshuffle between two reads
      // that pushed nothing.
      expect(groups[0].variants.map((v) => v.runtime)).toEqual([
        "node",
        "workerd",
      ]);
    });

    it("keeps two apps on the same tag apart", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        app: "my-app",
        tag: "1.2.3",
        file: await packedArtifact(),
      });
      await push(projectId, owner, {
        app: "my-docs",
        tag: "1.2.3",
        file: await packedArtifact({ filler: "// the docs build" }),
      });

      const { groups } = (await list(projectId, owner)).data;

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.app).sort()).toEqual(["my-app", "my-docs"]);
    });

    it("narrows to one app, and to one tag", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        app: "my-app",
        tag: "1.2.3",
        file: await packedArtifact(),
      });
      await push(projectId, owner, {
        app: "my-docs",
        tag: "2.0.0",
        file: await packedArtifact({ filler: "// the docs build" }),
      });

      const byApp = (await list(projectId, owner, { app: "my-app" })).data;
      expect(byApp.groups.map((g) => g.app)).toEqual(["my-app"]);

      // The release page's whole query: the join to a release is tag equality.
      const byTag = (await list(projectId, owner, { tag: "2.0.0" })).data;
      expect(byTag.groups.map((g) => g.app)).toEqual(["my-docs"]);
    });

    /**
     * ⚠️ Ordering by `createdAt` would bury a `latest` that moves daily under
     * every pinned version pushed since it first appeared.
     */
    it("puts the most recently pushed bytes first", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
      });
      await push(projectId, owner, {
        tag: "1.2.3",
        file: await packedArtifact({ filler: "// a pinned build" }),
      });
      // `latest` moves, which makes it the newest push again even though its
      // row is the oldest.
      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "// today's build" }),
      });

      const { groups } = (await list(projectId, owner)).data;

      expect(groups.map((g) => g.tag)).toEqual(["latest", "1.2.3"]);
    });

    it("reports an empty project as empty rather than as an error", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const { groups, truncated } = (await list(projectId, owner)).data;

      expect(groups).toEqual([]);
      expect(truncated).toBe(false);
    });

    it("never publishes the framework file id", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, { file: await packedArtifact() });

      const { groups } = (await list(projectId, owner)).data;

      expect("fileId" in groups[0].variants[0]).toBe(false);
    });

    it("refuses a caller who is not a member of the project", async ({
      expect,
    }) => {
      const { projectId } = await aProject();
      const stranger = await createTestUser(ctx);

      expect(await statusOf(list(projectId, stranger))).toBe(403);
    });
  });

  /**
   * #1515: `*.map` left the tarball, so the maps have to arrive and leave
   * beside it.
   *
   * ⚠️ The exclusion is only safe because they are STILL RETRIEVABLE. A
   * sibling object with no way to read it is a deletion with extra storage,
   * and a source map that cannot be fetched is a stack trace nobody can read.
   */
  describe("the source maps beside a build", () => {
    it("stores them as a sibling object and hands them back", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        file: await packedArtifact(),
        maps: mapsArchive(),
      });

      const [row] = await ctx.rows.artifacts.findMany({});
      expect(row.mapsFileId).toBeDefined();
      expect(row.mapsFileId).not.toBe(row.fileId);

      // Through the endpoint rather than the bucket, because "retrievable"
      // means an operator can reach them.
      const answer = await ctx.artifactController.getArtifactMaps.fetch(
        { params: { projectId, artifactId: row.id } },
        { user: owner },
      );
      expect(await (answer.data as unknown as FileLike).text()).toBe(
        "source-maps-one",
      );
    });

    it("is optional, so an older CLI still pushes", async ({ expect }) => {
      // Its maps are inside the tarball, and refusing that push would turn
      // every unupgraded pipeline red for a size optimisation.
      const { owner, projectId } = await aProject();
      await push(projectId, owner, { file: await packedArtifact() });

      const [row] = await ctx.rows.artifacts.findMany({});
      expect(row.mapsFileId).toBeUndefined();
    });

    it("says which fact it has when there is nothing to fetch", async ({
      expect,
    }) => {
      // "no maps" and "no such artifact" are different facts, and an operator
      // holding an unreadable stack trace needs to know which one.
      const { owner, projectId } = await aProject();
      await push(projectId, owner, { file: await packedArtifact() });
      const [row] = await ctx.rows.artifacts.findMany({});

      await expect(
        ctx.artifactController.getArtifactMaps.fetch(
          { params: { projectId, artifactId: row.id } },
          { user: owner },
        ),
      ).rejects.toThrow(/no stored source maps/);

      await expect(
        ctx.artifactController.getArtifactMaps.fetch(
          { params: { projectId, artifactId: crypto.randomUUID() } },
          { user: owner },
        ),
      ).rejects.toThrow(/No such artifact/);
    });

    /**
     * Replacing `latest` IS the retention policy, so the maps have to move
     * with it. A sibling that outlived its artifact would be storage nothing
     * can ever reach or name, and one that did not move would hand back the
     * PREVIOUS build's maps for the current bytes - worse than none at all,
     * because it symbolicates into the wrong source.
     */
    it("moves with a latest replacement, and takes the old object with it", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
        maps: mapsArchive("one"),
      });
      const [first] = await ctx.rows.artifacts.findMany({});
      const firstMapsId = first.mapsFileId as string;

      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "changed" }),
        maps: mapsArchive("two"),
      });

      const [second] = await ctx.rows.artifacts.findMany({});
      expect(second.id).toBe(first.id);
      expect(second.mapsFileId).not.toBe(firstMapsId);

      const answer = await ctx.artifactController.getArtifactMaps.fetch(
        { params: { projectId, artifactId: second.id } },
        { user: owner },
      );
      expect(await (answer.data as unknown as FileLike).text()).toBe(
        "source-maps-two",
      );
      await expect(
        ctx.artifactController.artifactBucket.get(firstMapsId),
      ).rejects.toThrow();
    });

    it("stops naming the previous build's maps when the new one has none", async ({
      expect,
    }) => {
      // ⚠️ The `sql`NULL`` case. An explicit `undefined` reads as an absent key
      // to the ORM, so the row would keep pointing at maps that describe bytes
      // it no longer holds.
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact(),
        maps: mapsArchive(),
      });

      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "changed" }),
      });

      const [row] = await ctx.rows.artifacts.findMany({});
      expect(row.mapsFileId).toBeUndefined();
    });

    it("goes when the artifact goes", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        file: await packedArtifact(),
        maps: mapsArchive(),
      });
      const [row] = await ctx.rows.artifacts.findMany({});
      const mapsId = row.mapsFileId as string;

      await ctx.artifactService.delete(row);

      await expect(
        ctx.artifactController.artifactBucket.get(mapsId),
      ).rejects.toThrow();
    });
  });

  describe("the gate", () => {
    it("refuses a caller who is not a member of the project", async ({
      expect,
    }) => {
      const { projectId } = await aProject();
      const stranger = await createTestUser(ctx);

      expect(
        await statusOf(
          push(projectId, stranger, { file: await packedArtifact() }),
        ),
      ).toBe(403);
    });

    it("gates the image push the same way, on artifact:read", async ({
      expect,
    }) => {
      const { projectId } = await aProject();
      const stranger = await createTestUser(ctx);
      ctx.registry.healthy();

      expect(await statusOf(pushImage(projectId, stranger, {}))).toBe(403);
    });
  });

  /**
   * An image is a reference, not bytes.
   *
   * The properties worth pinning here are the ones that separate this from
   * `push`: what the row records, what it refuses, and what makes a re-run of
   * a release job exit 0.
   */
  describe("pushing an image", () => {
    const REFERENCE = "ghcr.io/alepha-dev/lore:0.30.0";

    it("records the reference, the bare index digest and the index", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();

      const response = await pushImage(projectId, owner, {});

      expect(response.data.stored).toBe(true);
      const [row] = await ctx.rows.artifacts.findMany({});
      expect(row.format).toBe("image");
      expect(row.reference).toBe(REFERENCE);
      // ⚠️ Bare hex. The column is exactly 64 characters and the registry
      // reports `sha256:` plus 64, which is 71.
      expect(row.sha256).toBe("a".repeat(64));
      // ⚠️ No bytes at all: Lore records a reference and stores nothing.
      expect(row.fileId).toBeUndefined();
      // The OCI INDEX, which carries the platform list and the per-arch
      // digests - which is why there is no arch column.
      expect(JSON.parse(row.manifest as string).manifests).toHaveLength(3);
    });

    it("takes the runtime from the label, never from the request", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy({ runtime: "bun" });

      await pushImage(projectId, owner, {});

      const [row] = await ctx.rows.artifacts.findMany({});
      expect(row.runtime).toBe("bun");
      // And there is no field on the endpoint that could have said otherwise.
      // ⚠️ Read off the action rather than from a list written here: a
      // `runtime` added to the body would sail past a hand-maintained one.
      const body = ctx.artifactController.pushImage.options.schema?.body as {
        shape: Record<string, unknown>;
      };
      expect(Object.keys(body.shape)).not.toContain("runtime");
    });

    it("returns the format and the reference on the wire", async ({
      expect,
    }) => {
      // ⚠️ `schema.response` is what serializes: a field on the row that is
      // not on the resource is absent from the payload, silently.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();

      const response = await pushImage(projectId, owner, {});

      expect(response.data.artifact.format).toBe("image");
      expect(response.data.artifact.reference).toBe(REFERENCE);
    });

    it("keeps a size the registry answered, and tolerates one it did not", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();

      await pushImage(projectId, owner, {});
      const [sized] = await ctx.rows.artifacts.findMany({});
      expect(sized.size).toBe(42_002_000);

      // ⚠️ An absent size is a NORMAL row, not an error. Every surface
      // renders N/A for it.
      ctx.registry.on("/manifests/sha256:" + "b".repeat(64), {
        status: 200,
        body: JSON.stringify({
          config: { digest: `sha256:${"e".repeat(64)}` },
          layers: [{ size: 1 }],
        }),
      });
      await pushImage(projectId, owner, { tag: "0.31.0" });

      const rows = await ctx.rows.artifacts.findMany({
        where: { tag: { eq: "0.31.0" } },
      });
      expect(rows[0].size).toBeUndefined();
    });

    it("refuses a workerd image by name: a Worker does not run in a container", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy({ runtime: "workerd" });

      await expect(pushImage(projectId, owner, {})).rejects.toThrow(
        /a Worker does not run in a container/,
      );
      expect(await ctx.rows.artifacts.findMany({})).toEqual([]);
    });

    it("is a no-op that exits 0 when the digest AND the reference match", async ({
      expect,
    }) => {
      // A re-run of a release job. Answering it with a conflict would turn an
      // idempotent pipeline red for succeeding.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();

      await pushImage(projectId, owner, {});
      const again = await pushImage(projectId, owner, {});

      expect(again.data.stored).toBe(false);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
    });

    it("is NOT a no-op when the same digest arrives under a new reference", async ({
      expect,
    }) => {
      // ⚠️ Where this differs from the archive path, which decides on
      // `sha256` alone. The same image published under two references is a
      // different answer to "what do I pull", and a row still naming the old
      // string would send a reader to a tag CI no longer pushes.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();
      await pushImage(projectId, owner, {});

      ctx.registry.healthy({ repository: "alepha-dev/lore-mirror" });

      await expect(
        pushImage(projectId, owner, {
          reference: "ghcr.io/alepha-dev/lore-mirror:0.30.0",
        }),
      ).rejects.toThrow(/already names .* write-once - push --force/);
    });

    it("refuses to move a pinned tag without force, and moves it with one", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();
      await pushImage(projectId, owner, {});

      ctx.registry.healthy({ digest: `sha256:${"9".repeat(64)}` });

      await expect(pushImage(projectId, owner, {})).rejects.toThrow(
        /write-once - push --force to move it/,
      );

      const moved = await pushImage(projectId, owner, { force: true });
      expect(moved.data.stored).toBe(true);
      const rows = await ctx.rows.artifacts.findMany({});
      expect(rows).toHaveLength(1);
      expect(rows[0].sha256).toBe("9".repeat(64));
    });

    it("moves `latest` with no force at all", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      ctx.registry.healthy({ tag: "latest" });
      await pushImage(projectId, owner, {
        tag: "latest",
        reference: "ghcr.io/alepha-dev/lore:latest",
      });

      ctx.registry.healthy({
        tag: "latest",
        digest: `sha256:${"9".repeat(64)}`,
      });
      const moved = await pushImage(projectId, owner, {
        tag: "latest",
        reference: "ghcr.io/alepha-dev/lore:latest",
      });

      expect(moved.data.stored).toBe(true);
      expect(await ctx.rows.artifacts.findMany({})).toHaveLength(1);
    });

    it("refuses a supplied digest that disagrees with the registry", async ({
      expect,
    }) => {
      // `release.yml` sends none, deliberately. The field stays because
      // somebody else's CI may want it, and an unexercised branch is worse
      // than an unused field.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy();

      await expect(
        pushImage(projectId, owner, { digest: `sha256:${"f".repeat(64)}` }),
      ).rejects.toThrow(/is aaaaaaaaaaaa in the registry, and the push claims/);
      expect(await ctx.rows.artifacts.findMany({})).toEqual([]);
    });

    it("sorts a group's variants on (runtime, format), deterministically", async ({
      expect,
    }) => {
      // ⚠️ `listGrouped`'s sort exists so "a group does not reshuffle between
      // two reads that pushed nothing". Two variants sharing a runtime both
      // return 0 from a runtime-only comparator, which makes that guarantee
      // false - and it is also what decides the digest `AppArtifactsRow`
      // shows, since that takes `variants[0]`.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy({ tag: "1.2.3" });

      await push(projectId, owner, { file: await packedArtifact() });
      await pushImage(projectId, owner, {
        tag: "1.2.3",
        reference: "ghcr.io/alepha-dev/lore:1.2.3",
      });

      const listing = await ctx.artifactController.listArtifacts.fetch(
        { params: { projectId }, query: { tag: "1.2.3" } },
        { user: owner },
      );

      const [group] = listing.data.groups;
      expect(group.variants.map((it) => `${it.runtime}:${it.format}`)).toEqual([
        "node:archive",
        "node:image",
      ]);
    });

    it("coexists with an archive of the same tag and runtime", async ({
      expect,
    }) => {
      // The widened key, from the push side: the archive push must not
      // resolve to the image row and try to replace it.
      const { owner, projectId } = await aProject();
      ctx.registry.healthy({ tag: "1.2.3" });

      await push(projectId, owner, { file: await packedArtifact() });
      await pushImage(projectId, owner, {
        tag: "1.2.3",
        reference: "ghcr.io/alepha-dev/lore:1.2.3",
      });

      const rows = await ctx.rows.artifacts.findMany({});
      expect(rows).toHaveLength(2);
      expect(rows.map((it) => it.format).sort()).toEqual(["archive", "image"]);
      // One of them holds bytes, and it is not the image.
      expect(rows.filter((it) => it.fileId)).toHaveLength(1);
    });
  });
});
