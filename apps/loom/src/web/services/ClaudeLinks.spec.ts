import { describe, it } from "vitest";

import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";
import { ClaudeLinks } from "./ClaudeLinks.ts";

const worktree = (overrides: Partial<WorktreeState> = {}): WorktreeState => ({
  path: "/repo/.claude/worktrees/loom",
  name: "loom",
  isMain: false,
  branch: "worktree-loom",
  head: "bbbbbbbbbbbbbbbb",
  stashes: 0,
  installed: true,
  quests: [{ shortId: 2253 }],
  claude: { activity: "ended", pids: [] },
  devServers: [],
  status: {
    staged: 0,
    modified: 2,
    untracked: 1,
    conflicted: 0,
    ahead: 0,
    behind: 0,
    upstream: "origin/worktree-loom",
  },
  divergence: { base: "origin/main", ahead: 3, behind: 1 },
  ...overrides,
});

describe("ClaudeLinks", () => {
  it("opens a new desktop Code session in the folder, with the prompt", ({
    expect,
  }) => {
    const links = new ClaudeLinks();

    const url = new URL(
      links.newSession("/Users/me/my repo", "Hello & bye\nsecond line"),
    );

    expect(url.protocol).toBe("claude:");
    expect(url.host).toBe("code");
    expect(url.pathname).toBe("/new");
    // Decoded the way the desktop app decodes it: `new URL().searchParams`.
    expect(url.searchParams.get("folder")).toBe("/Users/me/my repo");
    expect(url.searchParams.get("q")).toBe("Hello & bye\nsecond line");
    expect(new URL(links.newSession("/repo")).searchParams.has("q")).toBe(
      false,
    );
  });

  it("points a session at the worktree, and says nothing for main", ({
    expect,
  }) => {
    const links = new ClaudeLinks();

    expect(links.where(worktree())).toContain(
      "worktree loom at /repo/.claude/worktrees/loom (branch worktree-loom)",
    );
    expect(links.where(worktree({ isMain: true }))).toBe("");
  });

  it("offers a CI investigation only for a failed run", ({ expect }) => {
    const links = new ClaudeLinks();
    const ci = {
      id: 1,
      name: "Verify",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/o/r/actions/runs/1",
      headSha: "aaaaaaaaaaaaaaaa",
      startedAt: "",
      updatedAt: "",
      jobs: { total: 17, completed: 17, failed: 8 },
    };

    const prompt = links.investigateCi(worktree({ ci }));

    expect(prompt).toContain("branch worktree-loom");
    // The session opens in the main checkout; the prompt names the worktree.
    expect(prompt).toContain("worktree loom at /repo/.claude/worktrees/loom");
    expect(prompt).toContain("8 of 17 jobs failed");
    expect(prompt).toContain("https://github.com/o/r/actions/runs/1");
    expect(prompt).toContain("not this worktree's HEAD");
    expect(
      links.investigateCi(worktree({ ci: { ...ci, conclusion: "success" } })),
    ).toBeUndefined();
    expect(links.investigateCi(worktree())).toBeUndefined();
  });

  it("states what Loom sees before asking to clean up, and forbids losing work", ({
    expect,
  }) => {
    const links = new ClaudeLinks();

    const prompt = links.cleanUp(
      worktree({
        stashes: 2,
        claude: {
          activity: "stale",
          pids: [],
          lock: { session: "loom", pid: 42, alive: false },
        },
      }),
      "origin/main",
    );

    expect(prompt).toContain("3 commits ahead of origin/main, 1 behind");
    expect(prompt).toContain("2 modified, 0 staged, 1 untracked");
    expect(prompt).toContain("2 stash entries");
    expect(prompt).toContain("the lock is stale");
    expect(prompt).toContain("#Q2253");
    expect(prompt).toContain("stop without removing anything");
  });
});
