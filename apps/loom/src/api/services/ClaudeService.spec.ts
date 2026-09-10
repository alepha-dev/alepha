import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ClaudeService } from "./ClaudeService.ts";

const setup = () => {
  const alepha = Alepha.create({ env: { HOME: "/home/me" } })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
  return {
    claude: alepha.inject(ClaudeService),
    shell: alepha.inject(MemoryShellProvider),
    fs: alepha.inject(MemoryFileSystemProvider),
  };
};

describe("ClaudeService", () => {
  it("reads the session and pid from Claude Code's worktree lock", ({
    expect,
  }) => {
    const { claude } = setup();

    expect(
      claude.parseLock(
        "claude session loom-dashboard (pid 78965 start Thu Sep 10 19:30:54 2026)",
      ),
    ).toEqual({ session: "loom-dashboard", pid: 78965 });
    expect(claude.parseLock("locked by hand")).toBeUndefined();
    expect(claude.parseLock(undefined)).toBeUndefined();
  });

  it("counts a pid as alive only when it is a Claude process", async ({
    expect,
  }) => {
    const { claude, shell } = setup();
    shell.outputs.set(
      "ps -o pid=,comm= -p 10,20,30",
      [
        "   10 /Applications/Claude.app/Contents/MacOS/claude",
        "   20 /bin/zsh",
      ].join("\n"),
    );

    // 20 was reused by a shell; 30 is gone.
    expect([...(await claude.alive([10, 20, 30]))]).toEqual([10]);
  });

  it("names the transcript directory the way Claude Code escapes a path", ({
    expect,
  }) => {
    const { claude } = setup();

    expect(
      claude.projectDir("/Users/nfo/git/alepha/.claude/worktrees/loom"),
    ).toBe(
      "/home/me/.claude/projects/-Users-nfo-git-alepha--claude-worktrees-loom",
    );
  });

  it("takes the newest transcript, and its last custom title", async ({
    expect,
  }) => {
    const { claude, shell, fs } = setup();
    const dir = claude.projectDir("/repo/wt");
    await fs.writeFile(`${dir}/old.jsonl`, "{}\n");
    await fs.writeFile(`${dir}/new.jsonl`, "{}\n");
    fs.mtimes.set(`${dir}/old.jsonl`, 1_000);
    fs.mtimes.set(`${dir}/new.jsonl`, 2_000);
    shell.outputs.set(
      `grep -F "type":"custom-title" ${dir}/new.jsonl`,
      [
        '{"type":"custom-title","customTitle":"First name"}',
        '{"type":"custom-title","customTitle":"Loom dashboard"}',
      ].join("\n"),
    );

    shell.outputs.set(
      `tail -c 262144 ${dir}/new.jsonl`,
      [
        // The tail starts mid-record; that line must not break the read.
        'ut_tokens":1,"cache_read_input_tokens":5}}}',
        '{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":2,"cache_creation_input_tokens":1908,"cache_read_input_tokens":875502,"output_tokens":177}}}',
        '{"type":"user","message":{"content":"next"}}',
      ].join("\n"),
    );

    expect(await claude.transcript("/repo/wt")).toEqual({
      sessionId: "new",
      title: "Loom dashboard",
      lastActivityAt: 2_000,
      // input + cache writes + cache reads of the last assistant turn.
      contextTokens: 877_412,
      model: "claude-opus-5",
    });
  });

  it("finds Claude processes by their working directory", async ({
    expect,
  }) => {
    const { claude, shell } = setup();
    shell.outputs.set(
      "lsof -nP -a -c claude -d cwd -F pn",
      [
        "p10",
        "fcwd",
        "n/repo",
        "p11",
        "fcwd",
        "n/repo/.claude/worktrees/a",
      ].join("\n"),
    );

    expect(await claude.processes()).toEqual([
      { pid: 10, cwd: "/repo" },
      { pid: 11, cwd: "/repo/.claude/worktrees/a" },
    ]);
  });
});
