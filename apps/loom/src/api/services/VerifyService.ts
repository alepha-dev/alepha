import { tmpdir, userInfo } from "node:os";

import { $env, $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import type { VerifyRun } from "../schemas/verifyRunSchema.ts";

/**
 * One ticket in `ExclusiveProvider`'s queue, as it writes it.
 */
export interface VerifyTicket {
  pid: number;
  key: string;
  command: string;
  cwd: string;
  startedAt: number;
  heartbeatAt: number;
  holding: boolean;
}

/**
 * One line of `ps -axo pid=,ppid=,etime=,command=`.
 */
export interface VerifyProcess {
  pid: number;
  ppid: number;
  elapsedMs: number;
  command: string;
}

/**
 * Local `yarn v` runs, read from the machine-wide queue `alepha verify` takes
 * a slot in.
 *
 * `ExclusiveProvider` keeps one JSON ticket per run under
 * `$TMPDIR/alepha-exclusive-<uid>/<package>-verify-<hash>/`, named so that
 * sorting by name is arrival order, with `holding` set on the run inside the
 * slot. A ticket whose pid is gone is ignored: the provider sweeps those on
 * the owner's pid, and a dead one is not a run.
 *
 * The holder's step comes from its direct children: the verify pipeline runs
 * each step as `yarn <script>` (`yarn` alone to install, then `lint`, the
 * six checks in parallel, `test`, `test:bun`). Progress is an estimate from
 * {@link steps}, the durations one `yarn v` took on this machine, capped
 * below 100 until the run is gone.
 */
export class VerifyService {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly env = $env(
    z.object({
      ALEPHA_EXCLUSIVE_DIR: z.text({
        default: "",
        secret: false,
        description:
          "Where alepha's exclusive command queues live, when not under the temp dir. Read the same way ExclusiveProvider reads it.",
      }),
    }),
  );

  /**
   * The pipeline's steps in order, with the seconds each took in one run on
   * this machine (2026-09-11: install 1s, lint 8s, checks 18s, test 155s,
   * test:bun 2s).
   */
  protected readonly steps = [
    { name: "install", seconds: 2, match: /yarn(\.js)?(\s+install)?\s*$/ },
    { name: "lint", seconds: 8, match: /\slint\s*$/ },
    { name: "checks", seconds: 18, match: /\s(typecheck|check:[\w-]+)\s*$/ },
    { name: "test", seconds: 155, match: /\stest\s*$/ },
    { name: "test:bun", seconds: 3, match: /\stest:bun\s*$/ },
  ];

  /**
   * Where the queues live. `ExclusiveProvider` honours `ALEPHA_EXCLUSIVE_DIR`
   * first, and so does this.
   */
  public queueRoot(): string {
    return (
      String(this.env.ALEPHA_EXCLUSIVE_DIR) ||
      this.fs.join(tmpdir(), `alepha-exclusive-${userInfo().uid}`)
    );
  }

  /**
   * Every live run, holder first then in line, with the directory it was
   * started from.
   */
  public async runs(): Promise<Array<{ cwd: string; run: VerifyRun }>> {
    const root = this.queueRoot();
    if (!(await this.fs.exists(root))) {
      return [];
    }
    const queues = (await this.fs.ls(root)).filter((name) =>
      /-verify-[0-9a-f]+$/.test(name),
    );
    if (queues.length === 0) {
      return [];
    }

    const processes = await this.processes();
    const alive = new Set(processes.map((it) => it.pid));
    const runs: Array<{ cwd: string; run: VerifyRun }> = [];

    for (const queue of queues) {
      const dir = this.fs.join(root, queue);
      const tickets: VerifyTicket[] = [];
      for (const file of (await this.fs.ls(dir)).sort()) {
        if (!file.endsWith(".json")) {
          continue;
        }
        try {
          const ticket = JSON.parse(
            await this.fs.readTextFile(this.fs.join(dir, file)),
          ) as VerifyTicket;
          if (alive.has(ticket.pid)) {
            tickets.push(ticket);
          }
        } catch {
          // A ticket being written or swept this very moment.
        }
      }

      let position = 0;
      for (const ticket of [...tickets].sort(
        (a, b) => Number(b.holding) - Number(a.holding),
      )) {
        const step = ticket.holding
          ? this.step(processes, ticket.pid)
          : undefined;
        runs.push({
          cwd: ticket.cwd,
          run: {
            pid: ticket.pid,
            holding: ticket.holding,
            position: ticket.holding ? 0 : ++position,
            step: step?.name,
            progress: step?.progress,
            startedAt: this.dateTime.toISOString(ticket.startedAt),
          },
        });
      }
    }
    return runs;
  }

  /**
   * The holder's current step and the estimated progress through the whole
   * pipeline, from its direct children.
   */
  public step(
    processes: VerifyProcess[],
    pid: number,
  ): { name: string; progress: number } | undefined {
    let current = -1;
    let elapsedMs = 0;
    for (const child of processes.filter((it) => it.ppid === pid)) {
      const index = this.steps.findIndex((step) =>
        step.match.test(child.command),
      );
      if (index > current) {
        current = index;
        elapsedMs = child.elapsedMs;
      } else if (index === current) {
        elapsedMs = Math.max(elapsedMs, child.elapsedMs);
      }
    }
    if (current === -1) {
      return undefined;
    }
    const total = this.steps.reduce((sum, step) => sum + step.seconds, 0);
    const done = this.steps
      .slice(0, current)
      .reduce((sum, step) => sum + step.seconds, 0);
    const within = Math.min(elapsedMs / 1000, this.steps[current].seconds);
    return {
      name: this.steps[current].name,
      progress: Math.min(99, Math.round(((done + within) / total) * 100)),
    };
  }

  /**
   * `etime` as ps prints it: `[[dd-]hh:]mm:ss`.
   */
  public parseElapsed(etime: string): number {
    const [days, rest] = etime.includes("-")
      ? [Number(etime.split("-")[0]), etime.split("-")[1]]
      : [0, etime];
    const parts = rest.split(":").map(Number);
    while (parts.length < 3) {
      parts.unshift(0);
    }
    const [hours, minutes, seconds] = parts;
    return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
  }

  protected async processes(): Promise<VerifyProcess[]> {
    const result = await this.shell
      .capture(["ps", "-axo", "pid=,ppid=,etime=,command="], {
        timeout: 5_000,
      })
      .catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
    const processes: VerifyProcess[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (match) {
        processes.push({
          pid: Number(match[1]),
          ppid: Number(match[2]),
          elapsedMs: this.parseElapsed(match[3]),
          command: match[4],
        });
      }
    }
    return processes;
  }
}
