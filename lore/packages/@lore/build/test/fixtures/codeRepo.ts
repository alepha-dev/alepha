import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ProjectController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";

import type { CodeRepository } from "../../src/api/entities/codeRepositories.ts";
import {
  CodeRepositoryService,
  LocalGitBackend,
  LoreBuildApi,
} from "../../src/api/index.ts";
import { createTestMemberByProjectId } from "../../src/testing/index.ts";
import { D1CeilingProvider } from "./D1CeilingProvider.ts";

/**
 * A booted Build on `LocalGitBackend` in a temporary `DATA_DIR`, and a way
 * to write a git history with fixed dates into one of its repositories
 * (#E167's specs: the index, the diff, compare, blame).
 */
export interface CodeRepoContext {
  alepha: Alepha;
  dir: string;
  owner: { id: string; roles: string[] };
  projectId: number;
  projectSlug: string;
  repository: CodeRepository;
  backend: LocalGitBackend;
  /**
   * The working copy that pushes into `repository`.
   */
  history: GitHistory;
  /**
   * A new user seated in the project on a preset rank (`viewer`,
   * `member`, `admin`).
   */
  addMember: (rank: string) => Promise<{ id: string; roles: string[] }>;
  stop: () => Promise<void>;
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

export const bootCodeRepo = async (
  options: {
    d1?: boolean;
    slug?: string;
    /**
     * Classes to construct before `start()`: a spec's repository probe.
     */
    probes?: Array<new () => object>;
  } = {},
): Promise<CodeRepoContext> => {
  const dir = mkdtempSync(join(tmpdir(), "lore-code-repo-"));
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATA_DIR: join(dir, "data"),
    },
  });
  if (options.d1) {
    alepha.with({ provide: DatabaseProvider, use: D1CeilingProvider });
  }
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreBuildApi);
  for (const probe of options.probes ?? []) alepha.inject(probe);
  await alepha.start();

  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  const owner = { id: created.data.id, roles: created.data.roles };
  const project = await alepha.inject(ProjectController).createProject.fetch(
    {
      body: {
        title: `Code ${crypto.randomUUID().slice(0, 8)}`,
        capabilities: [
          {
            key: "build" as const,
            options: { repositories: true, quality: true },
          },
        ],
      },
    },
    { user: owner },
  );
  const repository = await alepha.inject(CodeRepositoryService).create({
    projectId: project.data.id,
    slug: options.slug ?? "api",
    createdBy: owner.id,
  });
  const backend = alepha.inject(LocalGitBackend);
  const history = new GitHistory(
    join(dir, "work"),
    backend.pathOf(repository.backendRef),
  );
  return {
    alepha,
    dir,
    owner,
    projectId: project.data.id,
    projectSlug: project.data.slug!,
    repository,
    backend,
    history,
    addMember: async (rank) => {
      await createPresetRanks(alepha, project.data.id).catch(() => undefined);
      const other = alepha.inject(FakeProvider).generate(userDataSchema);
      const made = await alepha
        .inject(AdminUserController)
        .createUser.fetch(
          { body: { ...other, roles: ["user"] } },
          { user: adminUser },
        );
      await createTestMemberByProjectId(alepha, project.data.id, made.data.id, {
        rank,
      });
      return { id: made.data.id, roles: made.data.roles };
    },
    stop: async () => {
      await alepha.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

/**
 * A working copy whose every commit has its own fixed date, an hour after
 * the last, so a history reads in one order on every machine.
 */
export class GitHistory {
  public readonly work: string;
  public readonly remote: string;
  protected clock = 1_700_000_000;

  constructor(work: string, remote: string) {
    this.work = work;
    this.remote = remote;
    mkdirSync(work, { recursive: true });
    this.git("init", "--quiet", "-b", "main");
  }

  public git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.work,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: this.work,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Ada Lore",
        GIT_AUTHOR_EMAIL: "ada@example.com",
        GIT_COMMITTER_NAME: "Ada Lore",
        GIT_COMMITTER_EMAIL: "ada@example.com",
        GIT_AUTHOR_DATE: `${this.clock} +0000`,
        GIT_COMMITTER_DATE: `${this.clock} +0000`,
      },
    }).trim();
  }

  public write(files: Record<string, string | null>) {
    for (const [path, content] of Object.entries(files)) {
      const full = join(this.work, path);
      if (content === null) {
        rmSync(full, { force: true });
      } else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
  }

  /**
   * Write `files` (null deletes), commit everything with `message`, and
   * answer the commit's sha.
   */
  public commit(message: string, files: Record<string, string | null> = {}) {
    this.clock += 3600;
    this.write(files);
    this.git("add", "-A");
    this.git("commit", "--quiet", "--allow-empty", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  public merge(branch: string, message: string) {
    this.clock += 3600;
    this.git("merge", "--quiet", "--no-ff", "-m", message, branch);
    return this.git("rev-parse", "HEAD");
  }

  public checkout(...args: string[]) {
    this.git("checkout", "--quiet", ...args);
  }

  /**
   * Push every branch and tag into the repository, by path: the backend's
   * own bare repository, no HTTP and no recorder.
   */
  public push() {
    this.git("push", "--quiet", "--force", this.remote, "--all");
    this.git("push", "--quiet", "--force", this.remote, "--tags");
  }
}
