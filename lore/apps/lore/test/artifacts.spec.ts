import { Alepha, z } from "alepha";
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
import { packedArtifact, tar } from "./fixtures/artifactTarball.ts";

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
        },
      },
      { user },
    );

  /**
   * The status a refusal came back with, so the specs below assert 400 or 409
   * rather than "something threw".
   *
   * A bad artifact is the caller's fault and has to read as one: a 500 blames
   * Lore for a request it was right to refuse, and a CI log full of "Internal
   * Server Error" tells nobody what to fix.
   */
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
      const stored = await ctx.artifactController.artifactBucket.get(
        row.fileId,
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
      ).rejects.toThrowError(/--force/);
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
  });
});
