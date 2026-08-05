import { Alepha } from "alepha";
import { files } from "alepha/api/files";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ConflictError } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { artifacts, isMutableTag } from "../src/api/entities/artifacts.ts";
import { projects } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import { ArtifactService } from "../src/api/services/ArtifactService.ts";

class Probe {
  projects = $repository(projects);
  artifacts = $repository(artifacts);
  files = $repository(files);
}

/**
 * Boots the app, a project, and two already-uploaded files.
 *
 * The `files` rows are written directly rather than pushed through the upload
 * endpoint: what is under test is the registry sitting on top of stored bytes,
 * and driving multipart here would test the framework's upload path again.
 * Two of them, because every interesting case is "push different bytes under
 * the same tag".
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaServerCors);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  const service = alepha.inject(ArtifactService);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await probe.projects.create({
    title: "Test",
    createdBy: owner.id,
  });

  const makeFile = async (name: string) =>
    (
      await probe.files.create({
        blobId: `blob-${name}`,
        bucket: ArtifactService.BUCKET,
        name: `hello-${name}.tar.gz`,
        size: 1024,
        mimeType: "application/gzip",
      })
    ).id;

  return {
    service,
    probe,
    projectId: project.id,
    fileA: await makeFile("a"),
    fileB: await makeFile("b"),
  };
};

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

/**
 * The tag rules, before any service sits on top.
 *
 * `isMutableTag` is the whole retention policy in one predicate — everything
 * else (replace-in-place vs refuse) reads off it — so it is worth pinning
 * directly rather than only through the service that consumes it.
 */
describe("artifacts entity", () => {
  it("should treat only `latest` as mutable", () => {
    expect(isMutableTag("latest")).toBe(true);
    expect(isMutableTag("1.2.3")).toBe(false);
    expect(isMutableTag("nightly")).toBe(false);
    expect(isMutableTag("Latest")).toBe(false);
  });

  it("should key uniqueness on project + app + tag, not environment", () => {
    const indexes = (artifacts.options.indexes ?? []) as Array<{
      columns: string[];
      unique?: boolean;
    }>;
    const unique = indexes.find((index) => index.unique);

    expect(unique).toBeDefined();
    expect(unique?.columns).toEqual(["projectId", "app", "tag"]);
  });
});

/**
 * The retention rule, which is the whole point of tagging.
 *
 * `latest` collapsing to one row is what stops the registry growing without
 * bound; a pinned tag refusing to move is what lets a deploy to production
 * claim it is shipping the bytes staging tested. Both halves are load-bearing
 * and neither is enforced by the schema alone.
 */
describe("ArtifactService", () => {
  it("should replace bytes in place for a mutable tag", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    const first = await service.register({
      projectId,
      app: "hello",
      tag: "latest",
      sha256: SHA_A,
      fileId: fileA,
    });
    const second = await service.register({
      projectId,
      app: "hello",
      tag: "latest",
      sha256: SHA_B,
      fileId: fileB,
    });

    expect(second.id).toBe(first.id);
    expect(second.sha256).toBe(SHA_B);
    expect(await service.listByProject(projectId)).toHaveLength(1);
  });

  it("should refuse to overwrite a pinned tag", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    await service.register({
      projectId,
      app: "hello",
      tag: "1.2.3",
      sha256: SHA_A,
      fileId: fileA,
    });

    await expect(
      service.register({
        projectId,
        app: "hello",
        tag: "1.2.3",
        sha256: SHA_B,
        fileId: fileB,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("should overwrite a pinned tag when forced", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    await service.register({
      projectId,
      app: "hello",
      tag: "1.2.3",
      sha256: SHA_A,
      fileId: fileA,
    });
    const forced = await service.register({
      projectId,
      app: "hello",
      tag: "1.2.3",
      sha256: SHA_B,
      fileId: fileB,
      force: true,
    });

    expect(forced.sha256).toBe(SHA_B);
    expect(await service.listByProject(projectId)).toHaveLength(1);
  });

  it("should keep different apps and tags apart", async () => {
    const { service, projectId, fileA, fileB } = await setup();

    await service.register({
      projectId,
      app: "hello",
      tag: "latest",
      sha256: SHA_A,
      fileId: fileA,
    });
    await service.register({
      projectId,
      app: "other",
      tag: "latest",
      sha256: SHA_B,
      fileId: fileB,
    });

    expect(await service.listByProject(projectId)).toHaveLength(2);
  });

  it("should resolve an artifact by tag", async () => {
    const { service, projectId, fileA } = await setup();

    await service.register({
      projectId,
      app: "hello",
      tag: "1.2.3",
      sha256: SHA_A,
      fileId: fileA,
    });

    expect((await service.resolve(projectId, "hello", "1.2.3"))?.sha256).toBe(
      SHA_A,
    );
    expect(await service.resolve(projectId, "hello", "9.9.9")).toBeUndefined();
  });

  it("should reject a file stored in another bucket", async () => {
    const { service, probe, projectId } = await setup();

    const stray = await probe.files.create({
      blobId: "blob-stray",
      bucket: "archive-blobs",
      name: "not-an-artifact.png",
      size: 10,
      mimeType: "image/png",
    });

    await expect(
      service.register({
        projectId,
        app: "hello",
        tag: "latest",
        sha256: SHA_A,
        fileId: stray.id,
      }),
    ).rejects.toThrow(/bucket/i);
  });

  it("should reject a malformed digest", async () => {
    const { service, projectId, fileA } = await setup();

    await expect(
      service.register({
        projectId,
        app: "hello",
        tag: "latest",
        sha256: "nope",
        fileId: fileA,
      }),
    ).rejects.toThrow(/sha256/i);
  });
});
