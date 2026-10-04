import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, it } from "vitest";

import { GitService } from "../server/services/GitService.ts";

const ROOT = "/work/repo-wt";
const git = (dir: string, ...args: string[]) =>
  ["git", "-C", dir, ...args].join(" ");

const setup = () => {
  const alepha = Alepha.create().with({
    provide: ShellProvider,
    use: MemoryShellProvider,
  });
  return {
    git: alepha.inject(GitService),
    shell: alepha.inject(MemoryShellProvider),
  };
};

describe("GitService", () => {
  describe("worktree", () => {
    it("reads the repository, branch, ahead/behind and dirty files", async ({
      expect,
    }) => {
      const { git: service, shell } = setup();
      shell.configure({
        outputs: {
          [git(
            ROOT,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          )]: "/work/repo/.git\n",
          [git(ROOT, "rev-parse", "--abbrev-ref", "HEAD")]: "feature/x\n",
          [git(
            ROOT,
            "rev-list",
            "--left-right",
            "--count",
            "@{upstream}...HEAD",
          )]: "2\t5\n",
          [git(ROOT, "status", "--porcelain")]: " M a.ts\n?? b.ts\n",
        },
      });

      expect(await service.worktree(ROOT)).toEqual({
        repository: "/work/repo",
        worktree: ROOT,
        branch: "feature/x",
        ahead: 5,
        behind: 2,
        dirty: 2,
      });
    });

    it("has no ahead/behind without an upstream, and nothing outside a repository", async ({
      expect,
    }) => {
      const { git: service, shell } = setup();
      shell.configure({
        outputs: {
          [git(
            ROOT,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          )]: "/work/repo/.git",
          [git(ROOT, "rev-parse", "--abbrev-ref", "HEAD")]: "main",
        },
        errors: {
          [git(
            ROOT,
            "rev-list",
            "--left-right",
            "--count",
            "@{upstream}...HEAD",
          )]: "no upstream configured",
          [git(
            "/tmp/plain",
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          )]: "not a git repository",
        },
      });

      const state = await service.worktree(ROOT);
      expect(state?.ahead).toBeUndefined();
      expect(state?.behind).toBeUndefined();
      expect(state?.dirty).toBe(0);
      expect(await service.worktree("/tmp/plain")).toBeUndefined();
    });
  });

  describe("migrations", () => {
    const APP = "/work/repo-wt/apps/api";

    it("flags files added or modified since the merge-base with origin/HEAD, uncommitted ones included", async ({
      expect,
    }) => {
      const { git: service, shell } = setup();
      shell.configure({
        outputs: {
          [git(APP, "remote")]: "origin\n",
          [git(APP, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")]:
            "origin/main\n",
          [git(APP, "merge-base", "HEAD", "origin/main")]: "abc123\n",
          [git(
            APP,
            "diff",
            "--relative",
            "--name-status",
            "--diff-filter=AM",
            "abc123",
            "--",
            "migrations",
          )]:
            "A\tmigrations/postgres/0004_new.sql\nM\tmigrations/postgres/0002_old.sql\n",
          [git(
            APP,
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            "migrations",
          )]: "migrations/postgres/0005_draft.sql\n",
        },
      });

      expect(await service.migrations(APP)).toEqual({
        base: "origin/main",
        files: [
          { path: "migrations/postgres/0002_old.sql", status: "modified" },
          { path: "migrations/postgres/0004_new.sql", status: "added" },
          { path: "migrations/postgres/0005_draft.sql", status: "added" },
        ],
      });
    });

    it("falls back to main without origin/HEAD", async ({ expect }) => {
      const { git: service, shell } = setup();
      shell.configure({
        outputs: {
          [git(APP, "remote")]: "origin",
          [git(APP, "merge-base", "HEAD", "main")]: "def456",
        },
        errors: {
          [git(APP, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")]:
            "not a symbolic ref",
        },
      });

      expect(await service.migrations(APP)).toEqual({
        base: "main",
        files: [],
      });
    });

    it("shows no flag, and no error, without a remote", async ({ expect }) => {
      const { git: service, shell } = setup();

      expect(await service.migrations(APP)).toEqual({ files: [] });
      expect(shell.wasCalled(git(APP, "merge-base", "HEAD", "main"))).toBe(
        false,
      );
    });
  });
});
