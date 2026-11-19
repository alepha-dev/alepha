import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { FileStorageProvider } from "alepha/bucket";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ArtifactsGitBackend,
  CodeBackupJobs,
  CodeRepositoryController,
  GitBackend,
  LoreBuildApi,
} from "../src/api/index.ts";
import { codeRepositories } from "../src/schemas/index.ts";

/**
 * The nightly backup (#Q3946): a bundle per repository that `git clone`
 * reads back, skipped when nothing moved, the last seven kept. The
 * Artifacts path (a v0 fetch with no side-band, written behind a bundle
 * header) runs against this spec's own server, whose git route serves the
 * same smart HTTP Artifacts does.
 */
const run = promisify(execFile);
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

class Rows {
  repositories = $repository(codeRepositories);
}

describe("CodeBackupJobs", () => {
  let alepha: Alepha;
  let dataDir: string;
  let work: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lore-backup-data-"));
    work = await mkdtemp(join(tmpdir(), "lore-backup-work-"));
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
        DATA_DIR: dataDir,
      },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreBuildApi);
    alepha.inject(Rows);
    // Built here, never by the Node runtime: the Artifacts path's spec
    // drives it against this server.
    alepha.inject(ArtifactsGitBackend);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
    await rm(dataDir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  const git = (args: string[], cwd = work) =>
    run("git", ["-c", "credential.helper=", ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: work,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "lore",
        GIT_AUTHOR_EMAIL: "lore@example.com",
        GIT_COMMITTER_NAME: "lore",
        GIT_COMMITTER_EMAIL: "lore@example.com",
      },
    });

  /**
   * A project with a repository holding two commits and a tag.
   */
  const aRepository = async () => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const owner = { id: created.data.id, roles: created.data.roles };
    const key = (
      await alepha
        .inject(ApiKeyController)
        .createApiKey.fetch({ body: { name: "git" } }, { user: owner })
    ).data.token;
    const project = await alepha.inject(ProjectController).createProject.fetch(
      {
        body: {
          title: `Backup ${crypto.randomUUID().slice(0, 8)}`,
          capabilities: [{ key: "build" as const }],
        },
      },
      { user: owner },
    );
    const repo = await alepha
      .inject(CodeRepositoryController)
      .createCodeRepository.fetch(
        { params: { projectId: project.data.id }, body: { slug: "api" } },
        { user: owner },
      );
    const remote = new URL(repo.data.cloneUrl);
    remote.username = "x";
    remote.password = key;
    const source = join(work, `source-${crypto.randomUUID().slice(0, 6)}`);
    await git(["init", "--quiet", "-b", "main", source]);
    for (const name of ["one", "two"]) {
      await writeFile(join(source, `${name}.txt`), name);
      await git(["add", "."], source);
      await git(["commit", "--quiet", "-m", name], source);
    }
    await git(["tag", "v1"], source);
    await git(["push", "--quiet", remote.toString(), "main", "v1"], source);
    const row = (await alepha.inject(Rows).repositories.findMany({})).find(
      (it) => it.id === repo.data.id,
    )!;
    const { stdout } = await git(["rev-parse", "HEAD"], source);
    return {
      row,
      source,
      remote,
      key,
      cloneUrl: repo.data.cloneUrl,
      head: stdout.trim(),
    };
  };

  /**
   * Download a stored bundle and clone it.
   */
  const cloneBundle = async (container: string, file: string) => {
    const stored = await alepha
      .inject(FileStorageProvider)
      .download(container, file);
    const path = join(work, file);
    await writeFile(path, new Uint8Array(await stored.arrayBuffer()));
    const dir = join(work, `restored-${crypto.randomUUID().slice(0, 6)}`);
    await git(["clone", "--quiet", path, dir]);
    const { stdout: head } = await git(["rev-parse", "HEAD"], dir);
    const { stdout: tags } = await git(["tag"], dir);
    return { head: head.trim(), tags: tags.trim() };
  };

  it("writes a bundle git clones back, then skips while nothing moved", async ({
    expect,
  }) => {
    const { row, head } = await aRepository();
    const jobs = alepha.inject(CodeBackupJobs);

    const file = await jobs.backup(row);
    const again = await jobs.backup(row);

    expect(file).toMatch(/^\d{12}-[0-9a-f]{12}\.bundle$/);
    expect(again).toBeUndefined();
    const restored = await cloneBundle(jobs.container(row), file!);
    expect(restored.head).toBe(head);
    expect(restored.tags).toBe("v1");
  });

  it("keeps the last seven bundles", async ({ expect }) => {
    const { row, source, remote } = await aRepository();
    const jobs = alepha.inject(CodeBackupJobs);
    const storage = alepha.inject(FileStorageProvider);
    const container = jobs.container(row);
    for (let day = 1; day <= 8; day++) {
      const name = `2026010${day}0300-00000000000${day}.bundle`;
      await storage.upload(container, new File(["old"], name), name);
    }
    await writeFile(join(source, "three.txt"), "three");
    await git(["add", "."], source);
    await git(["commit", "--quiet", "-m", "three"], source);
    await git(["push", "--quiet", remote.toString(), "main"], source);

    const file = await jobs.backup(row);

    const kept = (await storage.list(container)).sort();
    expect(kept).toHaveLength(7);
    expect(kept).toContain(file);
    expect(kept).not.toContain("202601010300-000000000001.bundle");
  });

  it("bundles over smart HTTP as on Artifacts: v0, no side-band, the pack behind a header", async ({
    expect,
  }) => {
    const { row, cloneUrl, key, head } = await aRepository();
    const artifacts = alepha.inject(ArtifactsGitBackend);
    // Artifacts' remote and token, played by this server's git route.
    artifacts.token = async () => ({
      remote: cloneUrl,
      token: key,
      expiresAt: Date.now() + 60_000,
    });

    const refs = await artifacts.refs(row.backendRef);
    const stream = await artifacts.bundle(row.backendRef, refs);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const path = join(work, "artifacts.bundle");
    await writeFile(path, bytes);
    const dir = join(work, "from-artifacts");
    await git(["clone", "--quiet", path, dir]);

    expect(refs.map((tip) => tip.name).sort()).toEqual([
      "HEAD",
      "refs/heads/main",
      "refs/tags/v1",
    ]);
    const { stdout } = await git(["rev-parse", "HEAD"], dir);
    expect(stdout.trim()).toBe(head);
    expect(alepha.inject(GitBackend).kind).toBe("local");
  });
});
