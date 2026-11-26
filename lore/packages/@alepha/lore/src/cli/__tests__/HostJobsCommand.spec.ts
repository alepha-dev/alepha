import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { HostCommand } from "../commands/HostCommand.ts";
import { LoreHostResolver } from "../services/LoreHostResolver.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const JOBS = [
  {
    id: "j2",
    kind: "agent",
    status: "running",
    queuedAt: "2026-11-26T11:00:00.000Z",
    project: { id: 9, title: "Crm", slug: "crm" },
    readable: false,
  },
  {
    id: "j1",
    kind: "agent",
    status: "succeeded",
    queuedAt: "2026-11-26T10:00:00.000Z",
    project: { id: 7, title: "Hello", slug: "hello" },
    readable: true,
    prompt: "work-quest",
  },
];

/**
 * `lore host jobs` (#Q4524): every job of a machine, whatever its project,
 * the twin of `host_jobs`, and `--cancel`, which stops one of them.
 */
describe("lore host jobs", () => {
  const create = (can: string[]) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const command = alepha.inject(HostCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    Object.assign(
      alepha.inject(LoreHostResolver) as unknown as Record<string, unknown>,
      {
        hosts: {
          listMyHosts: async () => ({
            items: [
              {
                id: "e1",
                slug: "box-1",
                project: { id: 7, title: "Hello", slug: "hello" },
                can,
                projects: [],
              },
            ],
          }),
        },
      },
    );
    Object.assign(command as unknown as Record<string, unknown>, {
      hostJobs: {
        listHostJobs: async (request: unknown) => {
          calls.push({ name: "list", request });
          return { items: JOBS };
        },
        cancelHostJob: async (request: unknown) => {
          calls.push({ name: "cancel", request });
          return { ...JOBS[0], status: "running" };
        },
      },
    });
    const run = async (argv: string) => {
      await alepha.inject(CliProvider).run(command.jobs as never, { argv });
    };
    return { run, printed, calls };
  };

  it("lists the machine's jobs with their project, and a job it cannot read without its prompt", async ({
    expect,
  }) => {
    const { run, printed, calls } = create(["host:read"]);
    await run("box-1");
    expect(calls).toEqual([
      {
        name: "list",
        request: { params: { hostId: "e1" }, query: { limit: 50 } },
      },
    ]);
    const text = printed.join("\n");
    expect(text).toMatch(/j2\s+agent running\s+in crm/);
    expect(text).toMatch(/j1\s+work-quest succeeded\s+in hello/);
  });

  it("keeps one status, and prints the rows as JSON when asked", async ({
    expect,
  }) => {
    const { run, printed } = create(["host:read"]);
    await run("box-1 --status running --output json");
    expect(JSON.parse(printed.join("\n"))).toEqual({
      host: "box-1",
      jobs: [JOBS[0]],
    });
  });

  it("stops one job of the machine with --cancel, under host:update", async ({
    expect,
  }) => {
    const { run, printed, calls } = create(["host:read", "host:update"]);
    await run("box-1 --cancel j2");
    expect(calls).toEqual([
      { name: "cancel", request: { params: { hostId: "e1", jobId: "j2" } } },
    ]);
    expect(printed.join("\n")).toContain("Stopping job j2 on box-1");
  });

  it("finds no host to cancel on without host:update", async ({ expect }) => {
    const { run, calls } = create(["host:read"]);
    await run("box-1 --cancel j2").catch(() => undefined);
    expect(calls).toEqual([]);
  });
});
