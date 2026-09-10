import { $env, $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * A Claude Code process and the directory it runs in.
 */
export interface ClaudeProcess {
  pid: number;
  cwd: string;
}

/**
 * The newest transcript Claude Code keeps for a directory.
 */
export interface ClaudeTranscript {
  sessionId: string;
  title?: string;
  lastActivityAt: number;
}

/**
 * Claude Code, from the traces it leaves on the machine. Nothing here talks
 * to Claude.
 *
 * - **The worktree lock.** A worktree Claude Code creates is locked with
 *   `claude session <name> (pid <n> start <date>)`. The pid says whether the
 *   session is still running. The start date is UTC while `ps` prints local
 *   time, so the pid and the process name are what is compared, not the date.
 * - **Process working directories.** A session started in the main checkout
 *   locks nothing; `lsof` finds the Claude process by where it runs.
 * - **Transcripts.** `~/.claude/projects/<path with every non-alphanumeric
 *   character as "-">/<session>.jsonl`. The newest one's modification time is
 *   the session's last activity, and its `custom-title` record is the name
 *   shown in the app. Transcripts run to megabytes, so the title is found
 *   with `grep` rather than by reading the file.
 */
export class ClaudeService {
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly log = $logger();

  protected readonly env = $env(
    z.object({
      HOME: z.text({ default: "", secret: false }),
    }),
  );

  protected readonly titleCache = new Map<
    string,
    { mtimeMs: number; title?: string }
  >();

  public parseLock(
    reason: string | undefined,
  ): { session: string; pid: number } | undefined {
    const match = /^claude session (.+?) \(pid (\d+)(?: start [^)]*)?\)$/.exec(
      reason ?? "",
    );
    return match ? { session: match[1], pid: Number(match[2]) } : undefined;
  }

  /**
   * Which of these pids are running Claude processes. `ps` exits 1 when none
   * of them exist, which is an answer, not a failure.
   */
  public async alive(pids: number[]): Promise<Set<number>> {
    const alive = new Set<number>();
    if (pids.length === 0) {
      return alive;
    }
    const result = await this.shell
      .capture(["ps", "-o", "pid=,comm=", "-p", pids.join(",")], {
        timeout: 5_000,
      })
      .catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
    for (const line of result.stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (match && /claude/i.test(match[2])) {
        alive.add(Number(match[1]));
      }
    }
    return alive;
  }

  public async processes(): Promise<ClaudeProcess[]> {
    const result = await this.shell
      .capture(["lsof", "-nP", "-a", "-c", "claude", "-d", "cwd", "-F", "pn"], {
        timeout: 5_000,
      })
      .catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
    const processes: ClaudeProcess[] = [];
    let pid = 0;
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("p")) {
        pid = Number(line.slice(1));
      } else if (line.startsWith("n") && pid) {
        processes.push({ pid, cwd: line.slice(1) });
      }
    }
    return processes;
  }

  /**
   * The directory Claude Code keeps transcripts in for a working directory.
   */
  public projectDir(path: string): string {
    return this.fs.join(
      String(this.env.HOME),
      ".claude",
      "projects",
      path.replace(/[^a-zA-Z0-9]/g, "-"),
    );
  }

  public async transcript(path: string): Promise<ClaudeTranscript | undefined> {
    const dir = this.projectDir(path);
    if (!(await this.fs.exists(dir))) {
      return undefined;
    }
    let newest: { file: string; mtimeMs: number } | undefined;
    for (const name of await this.fs.ls(dir)) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const file = this.fs.join(dir, name);
      const { mtimeMs } = await this.fs.stat(file);
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { file, mtimeMs };
      }
    }
    if (!newest) {
      return undefined;
    }
    const name = newest.file.slice(newest.file.lastIndexOf("/") + 1);
    return {
      sessionId: name.replace(/\.jsonl$/, ""),
      title: await this.title(newest.file, newest.mtimeMs),
      lastActivityAt: newest.mtimeMs,
    };
  }

  protected async title(
    file: string,
    mtimeMs: number,
  ): Promise<string | undefined> {
    const cached = this.titleCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.title;
    }
    const result = await this.shell
      .capture(["grep", "-F", '"type":"custom-title"', file], {
        timeout: 5_000,
      })
      .catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
    let title: string | undefined;
    for (const line of result.stdout.split("\n")) {
      try {
        const record = JSON.parse(line) as { customTitle?: string };
        title = record.customTitle ?? title;
      } catch {
        // A partial line from a transcript being written; the next poll reads it whole.
      }
    }
    this.titleCache.set(file, { mtimeMs, title });
    return title;
  }
}
