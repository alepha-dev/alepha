import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, it } from "vitest";

import { CiService, type GhRun } from "./CiService.ts";

const run = (overrides: Partial<GhRun>): GhRun => ({
  id: 1,
  name: "Verify",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/o/r/actions/runs/1",
  head_sha: "abc",
  head_branch: "main",
  event: "push",
  created_at: "2026-09-10T20:00:00Z",
  updated_at: "2026-09-10T20:05:00Z",
  ...overrides,
});

const setup = (installed = true) => {
  const alepha = Alepha.create().with({
    provide: ShellProvider,
    use: MemoryShellProvider,
  });
  const shell = alepha.inject(MemoryShellProvider);
  if (installed) {
    shell.installedCommands.add("gh");
  }
  return { ci: alepha.inject(CiService), shell };
};

describe("CiService", () => {
  it("prefers the branch's own push over a follow-up workflow run", ({
    expect,
  }) => {
    const { ci } = setup();

    const picked = ci.pick(
      [
        run({ id: 3, name: "Deploy latest", event: "workflow_run" }),
        run({ id: 2, name: "Verify", event: "push" }),
        run({ id: 1, head_branch: "other" }),
      ],
      "main",
    );

    expect(picked?.id).toBe(2);
  });

  it("counts a running job by the share of its steps that finished", ({
    expect,
  }) => {
    const { ci } = setup();

    const progress = ci.progress([
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "success" },
      {
        status: "in_progress",
        conclusion: null,
        steps: [
          { status: "completed" },
          { status: "in_progress" },
          { status: "queued" },
          { status: "queued" },
        ],
      },
      { status: "queued", conclusion: null },
    ]);

    // (1 + 1 + 1/4 + 0) / 4
    expect(progress).toBe(56);
  });

  it("reads the latest run per branch, with progress while it runs", async ({
    expect,
  }) => {
    const { ci, shell } = setup();
    shell.outputs.set(
      "gh api repos/o/r/actions/runs?per_page=50",
      JSON.stringify({
        workflow_runs: [
          run({
            id: 7,
            head_branch: "worktree-loom",
            status: "in_progress",
            conclusion: null,
          }),
          run({ id: 6, head_branch: "main" }),
        ],
      }),
    );
    shell.outputs.set(
      "gh api repos/o/r/actions/runs/7/jobs?per_page=100",
      JSON.stringify({
        jobs: [
          { status: "completed", conclusion: "success" },
          { status: "queued", conclusion: null },
        ],
      }),
    );

    const runs = await ci.latest("o/r", ["main", "worktree-loom", "none"]);

    expect(runs?.get("main")).toMatchObject({ id: 6, conclusion: "success" });
    expect(runs?.get("main")?.progress).toBeUndefined();
    expect(runs?.get("worktree-loom")).toMatchObject({
      id: 7,
      status: "in_progress",
      progress: 50,
      jobs: { total: 2, completed: 1, failed: 0 },
    });
    expect(runs?.has("none")).toBe(false);
  });

  it("answers nothing when gh is not installed", async ({ expect }) => {
    const { ci, shell } = setup(false);

    expect(await ci.latest("o/r", ["main"])).toBeUndefined();
    expect(shell.calls).toHaveLength(0);
  });
});
