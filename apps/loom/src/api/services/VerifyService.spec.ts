import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { VerifyService } from "./VerifyService.ts";

const ROOT = "/tmp/alepha-exclusive-501";
const QUEUE = `${ROOT}/alepha-monorepo-verify-c9746dc0c656f07f`;

const setup = async () => {
  const alepha = Alepha.create({ env: { ALEPHA_EXCLUSIVE_DIR: ROOT } })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);

  const ticket = (pid: number, cwd: string, holding: boolean) =>
    JSON.stringify({
      pid,
      key: "alepha-monorepo:verify",
      command: "verify",
      cwd,
      startedAt: Date.UTC(2026, 8, 11, 0, 52),
      heartbeatAt: Date.UTC(2026, 8, 11, 0, 54),
      holding,
    });
  // Names sort in arrival order, as ExclusiveProvider writes them.
  await fs.writeFile(
    `${QUEUE}/0001-0000000100-aa.json`,
    ticket(100, "/repo/.claude/worktrees/a", true),
  );
  await fs.writeFile(
    `${QUEUE}/0002-0000000200-bb.json`,
    ticket(200, "/repo", false),
  );
  await fs.writeFile(
    `${QUEUE}/0003-0000000300-cc.json`,
    ticket(300, "/repo/.claude/worktrees/gone", false),
  );
  // Spec leftovers of ExclusiveProvider's own suite live beside the real
  // queue and are not verify runs.
  await fs.writeFile(
    `${ROOT}/alepha-exclusive-race-1234-abcd/0001-0000000400-dd.json`,
    ticket(400, "/x", true),
  );

  shell.outputs.set(
    "ps -axo pid=,ppid=,etime=,command=",
    [
      "  100     1   02:30 node alepha verify",
      "  101   100   01:03 node /opt/homebrew/lib/node_modules/corepack/dist/yarn.js test",
      "  200     1   00:40 node alepha verify",
      "  400     1   00:10 node spec",
    ].join("\n"),
  );

  return { service: alepha.inject(VerifyService) };
};

describe("VerifyService", () => {
  it("reads the holder, its step and the line behind it, and skips dead tickets", async ({
    expect,
  }) => {
    const { service } = await setup();

    const runs = await service.runs();

    expect(runs).toEqual([
      {
        cwd: "/repo/.claude/worktrees/a",
        run: {
          pid: 100,
          holding: true,
          position: 0,
          step: "test",
          // (install 2 + lint 8 + checks 18 + 63s of test) / 186
          progress: 49,
          startedAt: "2026-09-11T00:52:00.000Z",
        },
      },
      {
        cwd: "/repo",
        run: {
          pid: 200,
          holding: false,
          position: 1,
          step: undefined,
          progress: undefined,
          startedAt: "2026-09-11T00:52:00.000Z",
        },
      },
    ]);
  });

  it("names the parallel checks as one step and never reports 100 while running", async ({
    expect,
  }) => {
    const { service } = await setup();
    const ps = (etime: string, command: string) => ({
      pid: 9,
      ppid: 1,
      elapsedMs: service.parseElapsed(etime),
      command,
    });

    expect(
      service.step(
        [
          ps("00:05", "node yarn.js typecheck"),
          ps("00:09", "node yarn.js check:deps"),
        ],
        1,
      ),
    ).toEqual({ name: "checks", progress: 10 });
    expect(service.step([ps("09:00", "node yarn.js test:bun")], 1)).toEqual({
      name: "test:bun",
      progress: 99,
    });
    expect(service.step([], 1)).toBeUndefined();
  });

  it("parses ps elapsed times with hours and days", ({ expect }) => {
    const alepha = Alepha.create();
    const service = alepha.inject(VerifyService);

    expect(service.parseElapsed("01:03")).toBe(63_000);
    expect(service.parseElapsed("02:01:03")).toBe(7_263_000);
    expect(service.parseElapsed("1-00:00:01")).toBe(86_401_000);
  });
});
