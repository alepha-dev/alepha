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

import { MonitorCommand } from "../commands/MonitorCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const MONITOR_ID = "01900000-0000-7000-8000-000000000001";
const APP_ID = "01900000-0000-7000-8000-000000000002";

const stored = {
  id: MONITOR_ID,
  name: "Website",
  kind: "http",
  target: "https://example.app",
  intervalSecs: 60,
  timeoutSecs: 10,
  confirmations: 2,
  expect: { status: 200, keyword: "ok" },
  notifications: { email: true, recipients: ["ops@example.app"] },
  active: true,
  status: "up",
  statusSince: "2026-11-13T10:00:00.000Z",
};

/**
 * `lore monitor` (#Q3591): what each verb sends, and what it refuses before
 * sending anything.
 */
describe("lore monitor", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const sent: Array<[string, unknown]> = [];
    const command = alepha.inject(MonitorCommand);
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: { getProjectBySlug: async () => ({ id: 7 }) },
      },
    );
    const record =
      (name: string, answer: (request: any) => unknown) =>
      async (request: unknown) => {
        sent.push([name, request]);
        return answer(request);
      };
    Object.assign(command as unknown as Record<string, unknown>, {
      // The app copy a new monitor belongs to (#Q3657). `bare` has no address.
      appApi: {
        getApp: record("getApp", (request) => ({
          id: APP_ID,
          app: request.params.app,
          env: request.params.env,
          url:
            request.params.app === "bare"
              ? undefined
              : "https://acme.example.app",
        })),
      },
      monitorApi: {
        listMonitors: record("listMonitors", () => ({
          items: [{ ...stored, uptimePct: 99.5, beats: [] }],
          estimated: false,
        })),
        getMonitorDetail: record("getMonitorDetail", () => ({
          monitor: stored,
          beats: [],
          uptime: [{ window: "24h", uptimePct: 100 }],
          points: [],
          incidents: [],
          estimated: false,
        })),
        createMonitor: record("createMonitor", (request) => ({
          monitor: { ...stored, ...request.body, id: MONITOR_ID },
          token: request.body.kind === "push" ? "push-secret" : undefined,
        })),
        updateMonitor: record("updateMonitor", (request) => ({
          ...stored,
          ...request.body,
        })),
        setMonitorActive: record("setMonitorActive", (request) => ({
          ...stored,
          active: request.body.active,
          status: request.body.active ? "pending" : "paused",
        })),
        deleteMonitor: record("deleteMonitor", () => ({ ok: true })),
      },
    });
    const run = async (sub: keyof MonitorCommand, argv: string) => {
      await alepha
        .inject(CliProvider)
        .run(command[sub] as MonitorCommand["list"], { argv });
    };
    return { run, printed, sent };
  };

  it("lists the project's monitors with status and uptime", async ({
    expect,
  }) => {
    const { run, printed, sent } = create();
    await run("list", "--window 7d");
    expect(sent).toEqual([
      ["listMonitors", { params: { projectId: 7 }, query: { window: "7d" } }],
    ]);
    expect(printed.join("\n")).toMatch(
      new RegExp(`${MONITOR_ID}.*Website.*up.*99\\.50%`),
    );
  });

  it("updates only the flags passed, merging expect key by key", async ({
    expect,
  }) => {
    const { run, sent } = create();
    await run(
      "update",
      `${MONITOR_ID} --interval-secs 300 --keyword healthy --no-email`,
    );
    expect(sent.at(-1)).toEqual([
      "updateMonitor",
      {
        params: { monitorId: MONITOR_ID },
        body: {
          name: "Website",
          kind: "http",
          target: "https://example.app",
          intervalSecs: 300,
          timeoutSecs: 10,
          confirmations: 2,
          expect: { status: 200, keyword: "healthy" },
          notifications: { email: false, recipients: ["ops@example.app"] },
        },
      },
    ]);
  });

  it("refuses a tcp create without a target before calling Lore", async ({
    expect,
  }) => {
    const { run, sent } = create();
    await expect(
      run("create", "--app acme --env production --name Db --kind tcp"),
    ).rejects.toThrow("needs --target");
    expect(sent).toEqual([]);
  });

  it("creates an http monitor on the app copy, checking its address", async ({
    expect,
  }) => {
    const { run, sent } = create();
    await run("create", "--app acme --env production --name Site --kind http");
    expect(sent[1]).toEqual([
      "createMonitor",
      {
        params: { projectId: 7 },
        body: expect.objectContaining({
          appInstanceId: APP_ID,
          name: "Site",
          kind: "http",
          target: "https://acme.example.app",
        }),
      },
    ]);
  });

  it("refuses an http monitor on a copy with no address and no --target", async ({
    expect,
  }) => {
    const { run, sent } = create();
    await expect(
      run("create", "--app bare --env production --name Site --kind http"),
    ).rejects.toThrow("has no address");
    expect(sent.map(([name]) => name)).toEqual(["getApp"]);
  });

  it("prints a push monitor's token once", async ({ expect }) => {
    const { run, printed, sent } = create();
    await run(
      "create",
      "--app acme --env production --name Backup --kind push --interval-secs 86400 --recipient a@example.app --recipient b@example.app",
    );
    expect(sent[1]).toEqual([
      "createMonitor",
      {
        params: { projectId: 7 },
        body: {
          name: "Backup",
          kind: "push",
          target: "",
          intervalSecs: 86_400,
          expect: {},
          notifications: {
            email: true,
            recipients: ["a@example.app", "b@example.app"],
          },
          appInstanceId: APP_ID,
        },
      },
    ]);
    expect(printed.join("\n")).toContain("shown once: push-secret");
  });

  it("pauses and resumes, and deletes only with --yes", async ({ expect }) => {
    const { run, sent, printed } = create();
    await run("pause", MONITOR_ID);
    await run("resume", MONITOR_ID);
    expect(sent.map(([name, request]) => [name, request])).toEqual([
      [
        "setMonitorActive",
        { params: { monitorId: MONITOR_ID }, body: { active: false } },
      ],
      [
        "setMonitorActive",
        { params: { monitorId: MONITOR_ID }, body: { active: true } },
      ],
    ]);
    expect(printed.join("\n")).toContain("Paused Website");

    await expect(run("delete", MONITOR_ID)).rejects.toThrow("Pass --yes");
    expect(sent).toHaveLength(2);
    await run("delete", `${MONITOR_ID} --yes`);
    expect(sent.at(-1)).toEqual([
      "deleteMonitor",
      { params: { monitorId: MONITOR_ID } },
    ]);
  });
});
