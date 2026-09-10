import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, it } from "vitest";

import { GitService } from "./GitService.ts";

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
  it("parses the worktree list, locks and prunable entries included", ({
    expect,
  }) => {
    const { git } = setup();

    const entries = git.parseWorktrees(
      [
        "worktree /repo",
        "HEAD aaa",
        "branch refs/heads/main",
        "",
        "worktree /repo/.claude/worktrees/loom",
        "HEAD bbb",
        "branch refs/heads/worktree-loom",
        "locked claude session loom (pid 78965 start Thu Sep 10 19:30:54 2026)",
        "",
        "worktree /repo/.claude/worktrees/gone",
        "HEAD ccc",
        "detached",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
    );

    expect(entries).toEqual([
      {
        path: "/repo",
        head: "aaa",
        branch: "main",
        bare: false,
        detached: false,
      },
      {
        path: "/repo/.claude/worktrees/loom",
        head: "bbb",
        branch: "worktree-loom",
        bare: false,
        detached: false,
        lockReason:
          "claude session loom (pid 78965 start Thu Sep 10 19:30:54 2026)",
      },
      {
        path: "/repo/.claude/worktrees/gone",
        head: "ccc",
        bare: false,
        detached: true,
        prunable: "gitdir file points to non-existent location",
      },
    ]);
  });

  it("counts staged, modified, untracked and conflicted entries", ({
    expect,
  }) => {
    const { git } = setup();

    const status = git.parseStatus(
      [
        "# branch.oid abc",
        "# branch.head worktree-loom",
        "# branch.upstream origin/worktree-loom",
        "# branch.ab +3 -1",
        "1 M. N... 100644 100644 100644 a b src/staged.ts",
        "1 .M N... 100644 100644 100644 a b src/modified.ts",
        "1 MM N... 100644 100644 100644 a b src/both.ts",
        "2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts",
        "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
        "? scratch.txt",
        "? other.txt",
      ].join("\n"),
    );

    expect(status).toEqual({
      staged: 3,
      modified: 2,
      untracked: 2,
      conflicted: 1,
      upstream: "origin/worktree-loom",
      ahead: 3,
      behind: 1,
    });
  });

  it("reads divergence as behind on the left and ahead on the right", async ({
    expect,
  }) => {
    const { git, shell } = setup();
    shell.outputs.set(
      "git rev-list --left-right --count origin/main...HEAD",
      "4\t2\n",
    );

    expect(await git.divergence("/repo/wt", "origin/main")).toEqual({
      base: "origin/main",
      ahead: 2,
      behind: 4,
    });
  });

  it("counts stash entries per branch", async ({ expect }) => {
    const { git, shell } = setup();
    shell.outputs.set(
      "git stash list --format=%gs",
      [
        "WIP on main: 1a2b3c4 fix",
        "On worktree-loom: loom leftover",
        "On worktree-loom: another",
      ].join("\n"),
    );

    const stashes = await git.stashes("/repo");

    expect(stashes.get("main")).toBe(1);
    expect(stashes.get("worktree-loom")).toBe(2);
  });

  it("names a GitHub remote as owner/repo, over ssh and https", async ({
    expect,
  }) => {
    const { git, shell } = setup();

    shell.outputs.set(
      "git remote get-url origin",
      "git@github.com:alepha-dev/alepha.git\n",
    );
    expect(await git.github("/repo")).toBe("alepha-dev/alepha");

    shell.outputs.set(
      "git remote get-url origin",
      "https://github.com/feunard/club\n",
    );
    expect(await git.github("/repo")).toBe("feunard/club");

    shell.outputs.set(
      "git remote get-url origin",
      "git@gitlab.com:someone/else.git\n",
    );
    expect(await git.github("/repo")).toBeUndefined();
  });

  it("runs every command without optional locks", async ({ expect }) => {
    const { git, shell } = setup();

    await git.status("/repo/wt");

    // A status holding index.lock would fail an agent's `git add` in the
    // same worktree.
    const [call] = shell.calls;
    expect(call.options.env?.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(call.options.root).toBe("/repo/wt");
  });
});
