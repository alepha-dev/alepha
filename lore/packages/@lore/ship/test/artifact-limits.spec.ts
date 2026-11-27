import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, isHttpError } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ArtifactController,
  ArtifactLimits,
  LoreShipApi,
  RegistryTransport,
} from "../src/api/index.ts";
import {
  MemoryRegistryTransport,
  packedArtifact,
} from "../src/testing/index.ts";

/**
 * The three caps of `lore.artifact.limits` (#Q4542): rows per project, one
 * archive's size, and the archives' total.
 *
 * What is worth pinning is what a push that adds nothing must NOT meet: a
 * re-push, a `latest` replace and a `--force` add no row, and a replace that
 * drops superseded archives frees their bytes before the total is compared.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with({ provide: RegistryTransport, use: MemoryRegistryTransport });
  alepha.with(AlephaFake);
  alepha.with(LoreShipApi);
  await alepha.start();
  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    artifacts: alepha.inject(ArtifactController),
    limits: alepha.inject(ArtifactLimits),
    fake: alepha.inject(FakeProvider),
    registry: alepha.inject(MemoryRegistryTransport),
  };
};

/**
 * Hex that zstd cannot fold away, so an archive's size follows its length.
 */
const noise = (chars: number): string => {
  let out = "";
  while (out.length < chars) out += crypto.randomUUID().replaceAll("-", "");
  return out.slice(0, chars);
};

describe("artifact limits", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const aProject = async () => {
    const fakeUser = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };
    const project = await ctx.projects.createProject.fetch(
      { body: { title: `Limits ${crypto.randomUUID().slice(0, 8)}` } },
      { user: owner },
    );
    return { owner, projectId: project.data.id };
  };

  const push = (
    projectId: number,
    user: { id: string },
    body: { tag: string; file: File; force?: boolean },
  ) =>
    ctx.artifacts.pushArtifact.fetch(
      {
        params: { projectId },
        body: {
          app: "my-app",
          tag: body.tag,
          file: body.file,
          force: body.force,
        },
      },
      { user },
    );

  const pushImage = (projectId: number, user: { id: string }) =>
    ctx.artifacts.pushImage.fetch(
      {
        params: { projectId },
        body: {
          app: "my-app",
          tag: "0.30.0",
          reference: "ghcr.io/alepha-dev/lore:0.30.0",
        },
      },
      { user },
    );

  const refusal = async (
    call: Promise<unknown>,
  ): Promise<{ status: number; message: string }> => {
    try {
      await call;
    } catch (error) {
      return {
        status: isHttpError(error) ? error.status : 500,
        message: error instanceof Error ? error.message : "",
      };
    }
    return { status: 200, message: "" };
  };

  const workerd = (filler: string) =>
    packedArtifact({
      filler,
      manifest: {
        manifestVersion: 2,
        project: "my-app",
        runtimes: [{ runtime: "workerd", entry: "index.workerd.js" }],
      },
    });

  const nodeAndWorkerd = (filler: string) =>
    packedArtifact({
      filler,
      manifest: {
        manifestVersion: 2,
        project: "my-app",
        runtimes: [
          { runtime: "node", entry: "index.node.js" },
          { runtime: "workerd", entry: "index.workerd.js" },
        ],
      },
    });

  describe("the parameter", () => {
    it("defaults to 100 artifacts, 25 MB each and 1000 MB in all", async ({
      expect,
    }) => {
      expect(await ctx.limits.maxArtifactsPerProject()).toBe(100);
      expect(await ctx.limits.maxArtifactBytes()).toBe(25 * 1024 * 1024);
      expect(await ctx.limits.maxBytesPerProject()).toBe(1000 * 1024 * 1024);
    });

    it("never lets one archive past the platform ceiling", async ({
      expect,
    }) => {
      const schema = ctx.limits.limits.schema;
      expect(
        schema.safeParse({
          maxArtifactBytes: ArtifactLimits.MAX_ARTIFACT_BYTES,
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({
          maxArtifactBytes: ArtifactLimits.MAX_ARTIFACT_BYTES + 1,
        }).success,
      ).toBe(false);

      // A version saved under an older schema comes back unchecked.
      class StaleOverrideLimits extends ArtifactLimits {
        public override readonly limits = {
          get: async () => ({ maxArtifactBytes: 500 * 1024 * 1024 }),
        } as unknown as ArtifactLimits["limits"];
      }
      expect(
        await Alepha.create().inject(StaleOverrideLimits).maxArtifactBytes(),
      ).toBe(ArtifactLimits.MAX_ARTIFACT_BYTES);
    });

    it("falls back to the defaults for keys an older override lacks", async ({
      expect,
    }) => {
      class OldOverrideLimits extends ArtifactLimits {
        public override readonly limits = {
          get: async () => ({}),
        } as unknown as ArtifactLimits["limits"];
      }
      const limits = Alepha.create().inject(OldOverrideLimits);
      expect(await limits.maxArtifactsPerProject()).toBe(100);
      expect(await limits.maxBytesPerProject()).toBe(1000 * 1024 * 1024);
    });
  });

  describe("one archive's size", () => {
    it("refuses an archive past maxArtifactBytes, and an admin override applies at once", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      const file = await packedArtifact({ filler: noise(8000) });
      expect(file.size).toBeGreaterThan(2048);

      await ctx.limits.limits.set({ maxArtifactBytes: 2048 });
      const refused = await refusal(
        push(projectId, owner, { tag: "1.0.0", file }),
      );
      expect(refused.status).toBe(413);
      expect(refused.message).toContain("maxArtifactBytes");

      // Raised without a redeploy: the next push reads the new value.
      await ctx.limits.limits.set({ maxArtifactBytes: 1024 * 1024 });
      const stored = await push(projectId, owner, { tag: "1.0.0", file });
      expect(stored.data.stored).toBe(true);
    });
  });

  it("never refuses a retry of an archive already stored, after the cap was lowered", async ({
    expect,
  }) => {
    const { owner, projectId } = await aProject();
    const file = await packedArtifact({ filler: noise(8000) });
    await push(projectId, owner, { tag: "1.0.0", file });

    await ctx.limits.limits.set({ maxArtifactBytes: 2048 });
    const retry = await push(projectId, owner, { tag: "1.0.0", file });
    expect(retry.data.stored).toBe(false);
  });

  describe("rows per project", () => {
    it("lets a forced push that adds one row and drops one through, over a lowered cap", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: "a" }),
      });
      await push(projectId, owner, {
        tag: "1.0.0",
        file: await workerd("edge"),
      });
      await push(projectId, owner, {
        tag: "0.9.0",
        file: await packedArtifact({ filler: "b" }),
      });
      // Three rows, and a cap of two set afterwards.
      await ctx.limits.limits.set({ maxArtifactsPerProject: 2 });

      // `node,workerd` over the `workerd`-only archive: a new row for `node`,
      // the superseded one dropped. The count does not grow.
      const forced = await push(projectId, owner, {
        tag: "1.0.0",
        force: true,
        file: await nodeAndWorkerd("both"),
      });
      expect(forced.data.stored).toBe(true);
    });

    it("refuses the row past maxArtifactsPerProject, archive or image, and never a push that adds none", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      await ctx.limits.limits.set({ maxArtifactsPerProject: 2 });
      ctx.registry.healthy();

      const first = await packedArtifact({ filler: "first" });
      await push(projectId, owner, { tag: "latest", file: first });
      await push(projectId, owner, { tag: "1.0.0", file: first });

      const archive = await refusal(
        push(projectId, owner, {
          tag: "1.0.1",
          file: await packedArtifact({ filler: "third" }),
        }),
      );
      expect(archive.status).toBe(403);
      expect(archive.message).toContain("holds 2 artifacts");
      expect(archive.message).toContain("Delete old artifacts");

      const image = await refusal(pushImage(projectId, owner));
      expect(image.status).toBe(403);

      // A re-push of the same bytes, a `latest` replace and a `--force` add
      // no row, so a full project still takes them.
      expect(
        (await push(projectId, owner, { tag: "1.0.0", file: first })).data
          .stored,
      ).toBe(false);
      expect(
        (
          await push(projectId, owner, {
            tag: "latest",
            file: await packedArtifact({ filler: "next" }),
          })
        ).data.stored,
      ).toBe(true);
      expect(
        (
          await push(projectId, owner, {
            tag: "1.0.0",
            force: true,
            file: await packedArtifact({ filler: "retagged" }),
          })
        ).data.stored,
      ).toBe(true);
    });
  });

  describe("the archives' total", () => {
    it("refuses a push that would take the total past maxBytesPerProject", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      const first = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: noise(4000) }),
      });
      const used = first.data.artifact.size ?? 0;
      await ctx.limits.limits.set({ maxBytesPerProject: used + 100 });

      const refused = await refusal(
        push(projectId, owner, {
          tag: "1.0.0",
          file: await packedArtifact({ filler: noise(4000) }),
        }),
      );
      expect(refused.status).toBe(413);
      expect(refused.message).toContain("maxBytesPerProject");

      // Replacing `latest` counts only the difference: a slightly smaller
      // build takes its place.
      const replaced = await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: noise(3800) }),
      });
      expect(replaced.data.stored).toBe(true);
    });

    it("counts the superseded archives a forced push drops", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();
      const node = await push(projectId, owner, {
        tag: "1.0.0",
        file: await packedArtifact({ filler: noise(4000) }),
      });
      const edge = await push(projectId, owner, {
        tag: "1.0.0",
        file: await workerd(noise(4000)),
      });
      const used =
        (node.data.artifact.size ?? 0) + (edge.data.artifact.size ?? 0);
      await ctx.limits.limits.set({ maxBytesPerProject: used + 100 });

      // Bigger than the node row it replaces, smaller than both rows it
      // takes over: refused if only the replaced row were freed.
      const file = await nodeAndWorkerd(noise(6000));
      expect(file.size).toBeGreaterThan((node.data.artifact.size ?? 0) + 100);
      expect(file.size).toBeLessThan(used);

      const forced = await push(projectId, owner, {
        tag: "1.0.0",
        force: true,
        file,
      });
      expect(forced.data.stored).toBe(true);
    });

    it("leaves images out of the byte total", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      await push(projectId, owner, {
        tag: "latest",
        file: await packedArtifact({ filler: noise(4000) }),
      });
      await ctx.limits.limits.set({ maxBytesPerProject: 1024 });
      ctx.registry.healthy();

      const image = await pushImage(projectId, owner);
      expect(image.data.stored).toBe(true);
    });
  });
});
