import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  type ShellCommandResult,
  ShellProvider,
  type ShellRunOptions,
} from "alepha/system";
import { describe, it } from "vitest";

import { ProjectStateService } from "./ProjectStateService.ts";

/**
 * A shell whose answers can depend on the directory a command runs in, since
 * every worktree runs the same `git status`.
 */
class RootedShellProvider extends MemoryShellProvider {
  public rooted = new Map<string, string>();

  public override async capture(
    command: string | string[],
    options: ShellRunOptions = {},
  ): Promise<ShellCommandResult> {
    const key = Array.isArray(command) ? command.join(" ") : command;
    const answer = this.rooted.get(`${options.root}|${key}`);
    if (answer !== undefined) {
      this.calls.push({ command: key, options });
      return { stdout: answer, stderr: "", exitCode: 0 };
    }
    return super.capture(command, options);
  }
}

const MAIN = "/repo";
const LOOM = "/repo/.claude/worktrees/loom";

const setup = async () => {
  const alepha = Alepha.create({ env: { HOME: "/home/me" } })
    .with({ provide: ShellProvider, use: RootedShellProvider })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
  const shell = alepha.inject(RootedShellProvider);
  const fs = alepha.inject(MemoryFileSystemProvider);

  shell.outputs.set(
    "git worktree list --porcelain",
    [
      `worktree ${MAIN}`,
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      `worktree ${LOOM}`,
      "HEAD bbb",
      "branch refs/heads/worktree-loom",
      "locked claude session loom (pid 42 start Thu Sep 10 19:30:54 2026)",
      "",
    ].join("\n"),
  );
  shell.outputs.set(
    "git symbolic-ref --quiet --short refs/remotes/origin/HEAD",
    "origin/main\n",
  );
  shell.outputs.set("ps -o pid=,comm= -p 42", "42 /x/MacOS/claude\n");
  shell.outputs.set(
    "lsof -nP -iTCP -sTCP:LISTEN -F pcn",
    ["p7", "cnode", "n127.0.0.1:3312"].join("\n"),
  );
  shell.outputs.set(
    "lsof -nP -a -d cwd -p 7 -F pn",
    ["p7", "fcwd", `n${LOOM}/apps/loom`].join("\n"),
  );
  shell.outputs.set(
    "lsof -nP -a -c claude -d cwd -F pn",
    ["p42", "fcwd", `n${MAIN}`].join("\n"),
  );
  shell.rooted.set(
    `${LOOM}|git status --porcelain=v2 --branch`,
    "# branch.ab +0 -0\n1 .M N... 1 1 1 a b f.ts\n? new.ts\n",
  );
  shell.rooted.set(
    `${LOOM}|git rev-list --left-right --count origin/main...HEAD`,
    "1\t3\n",
  );
  shell.rooted.set(
    `${LOOM}|git log --format=%B --max-count=200 origin/main..HEAD`,
    "feat(loom): dashboard (#Q2224)\n\nfix: typo (#Q2224)\n",
  );
  await fs.writeFile(`${LOOM}/.git`, "gitdir: /repo/.git/worktrees/loom\n");
  await fs.writeFile("/repo/.git/worktrees/loom/commondir", "../..\n");
  fs.mtimes.set("/repo/.git/worktrees/loom/commondir", Date.UTC(2026, 8, 10));

  return { alepha, service: alepha.inject(ProjectStateService) };
};

describe("ProjectStateService", () => {
  it("assigns a path to the deepest worktree that contains it", async ({
    expect,
  }) => {
    const { service } = await setup();

    expect(service.owner(`${LOOM}/apps/loom`, [MAIN, LOOM])).toBe(LOOM);
    expect(service.owner(`${MAIN}/apps/lore`, [MAIN, LOOM])).toBe(MAIN);
    expect(service.owner("/elsewhere", [MAIN, LOOM])).toBeUndefined();
    // A sibling whose name starts the same is not inside.
    expect(service.owner("/repo-2/src", [MAIN, LOOM])).toBeUndefined();
    // A process left in a Claude worktree that was removed is nobody's.
    expect(
      service.owner("/repo/.claude/worktrees/removed/apps", [MAIN, LOOM]),
    ).toBeUndefined();
  });

  it("calls a session working only while its transcript moves", async ({
    expect,
  }) => {
    const { alepha, service } = await setup();
    const now = alepha.inject(DateTimeProvider).nowMillis();

    expect(service.activity(true, false, now - 10_000)).toBe("working");
    expect(service.activity(true, true, now - 600_000)).toBe("waiting");
    expect(service.activity(true, false, undefined)).toBe("waiting");
    expect(service.activity(false, true, now - 10_000)).toBe("stale");
    expect(service.activity(false, false, now - 600_000)).toBe("ended");
    expect(service.activity(false, false, undefined)).toBe("none");
  });

  it("collects main first, then each worktree with what it holds", async ({
    expect,
  }) => {
    const { service } = await setup();

    const state = await service.collect({
      id: "repo",
      name: "repo",
      path: MAIN,
    });

    expect(state.base).toBe("origin/main");
    expect(state.worktrees.map((it) => it.name)).toEqual(["repo", "loom"]);

    const [main, loom] = state.worktrees;
    expect(main.isMain).toBe(true);
    expect(main.claude.pids).toEqual([42]);
    expect(main.divergence).toBeUndefined();

    expect(loom).toMatchObject({
      isMain: false,
      branch: "worktree-loom",
      createdAt: "2026-09-10T00:00:00.000Z",
      status: { modified: 1, untracked: 1 },
      divergence: { base: "origin/main", ahead: 3, behind: 1 },
      quests: [{ shortId: 2224 }],
      claude: {
        activity: "waiting",
        lock: { session: "loom", pid: 42, alive: true },
        pids: [],
      },
      devServers: [{ pid: 7, port: 3312, cwd: `${LOOM}/apps/loom` }],
    });
    // No gh, no remote: CI is simply absent.
    expect(loom.ci).toBeUndefined();
    expect(state.sources).toEqual({ gh: false, lore: false });
  });
});
