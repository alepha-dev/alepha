import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { StackCommand } from "../commands/StackCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreStackService } from "../services/LoreStackService.ts";

/**
 * `lore stack secrets, route, ps, logs, restart` (#Q2701): `--env` is
 * required for what writes, a value is never printed, and the service verbs
 * go to the member `<stack>.<service>`.
 */
describe("lore stack operations", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
        FROM_ENV: "env-value-secret",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request: unknown }> = [];
    const target = { projectId: 7, stackId: "s1", environmentId: "env-0" };
    const environments: Array<Record<string, unknown>> = [
      {
        id: "env-0",
        env: "production",
        routes: [{ service: "umami", domain: "analytics.bob.dev" }],
        members: [],
      },
    ];
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: { getProjectBySlug: async () => ({ id: 7 }) },
      },
    );
    Object.assign(
      alepha.inject(DateTimeProvider) as unknown as Record<string, unknown>,
      { wait: async () => undefined },
    );
    Object.assign(
      alepha.inject(LoreStackService) as unknown as Record<string, unknown>,
      {
        stacks: {
          listStacks: async () => ({
            items: [
              {
                id: "s1",
                name: "hello",
                environments,
              },
            ],
          }),
        },
        deploys: {
          readStackLogs: async () => ({
            status: "done",
            lines: [{ raw: "listening on 3000" }],
          }),
        },
      },
    );
    const command = alepha.inject(StackCommand);
    const record = (name: string) => async (request: unknown) => {
      calls.push({ name, request });
      return name === "requestLogs"
        ? { request: "r1" }
        : { key: "K", generated: false, command: "c1" };
    };
    Object.assign(command as unknown as Record<string, unknown>, {
      variableApi: {
        setStackVariable: record("set"),
        removeStackVariable: record("unset"),
        listStackVariables: async () => ({
          items: [
            { key: "DB_PASSWORD", valuePrefix: "corr" },
            { key: "APP_SECRET", valuePrefix: "", generated: true },
          ],
        }),
      },
      stackApi: {
        addStackRoute: record("routeAdd"),
        removeStackRoute: record("routeRemove"),
        createStackEnvironment: async (request: { body: { env: string } }) => {
          calls.push({ name: "createEnvironment", request });
          const id = `env-${environments.length}`;
          environments.push({ id, env: request.body.env, routes: [] });
          return { id };
        },
      },
      deployApi: {
        requestStackLogs: record("requestLogs"),
        stackServiceAction: record("action"),
        listStackServices: async () => ({
          revision: 2,
          services: [
            {
              name: "db",
              kind: "service",
              state: "active",
              memoryBytes: 52428800,
              restarts: 0,
              digest: "postgres@sha256:abc",
            },
          ],
          volumes: [{ name: "pgdata", backedUp: false }],
        }),
      },
    });
    const run = async (path: string[], argv: string) => {
      let node: unknown = command;
      for (const part of path) node = (node as Record<string, unknown>)[part];
      await alepha.inject(CliProvider).run(node as never, { argv });
    };
    return { fs, run, printed, calls, target };
  };

  describe("secrets", () => {
    it("refuses to guess the environment", async ({ expect }) => {
      const { run, calls } = create();
      await expect(run(["secretsSet"], "A=b")).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it("creates an environment not deployed yet, since its first deploy needs the secret", async ({
      expect,
    }) => {
      const { run, calls } = create();
      await run(["secretsSet"], "APP_SECRET --generate --env staging");
      expect(calls.map((c) => c.name)).toEqual(["createEnvironment", "set"]);
      expect(calls[1].request).toMatchObject({
        params: { environmentId: "env-1" },
      });
      await run(["routeAdd"], "web --domain staging.bob.dev --env staging");
      expect(calls.map((c) => c.name)).toEqual([
        "createEnvironment",
        "set",
        "routeAdd",
      ]);
    });

    it("sets KEY=VALUE and KEY from the environment, and never prints a value", async ({
      expect,
    }) => {
      const { run, calls, printed, target } = create();
      await run(
        ["secretsSet"],
        "DB_PASSWORD=inline-value-secret --env production",
      );
      process.env.FROM_ENV = "env-value-secret";
      await run(["secretsSet"], "FROM_ENV --env production");
      expect(calls).toEqual([
        {
          name: "set",
          request: {
            params: target,
            body: { key: "DB_PASSWORD", value: "inline-value-secret" },
          },
        },
        {
          name: "set",
          request: {
            params: target,
            body: { key: "FROM_ENV", value: "env-value-secret" },
          },
        },
      ]);
      expect(printed.join("\n")).not.toMatch(
        /inline-value-secret|env-value-secret/,
      );
    });

    it("generates values on the server, and sets every key of a dotenv file", async ({
      expect,
    }) => {
      const { fs, run, calls } = create();
      await run(["secretsSet"], "APP_SECRET --generate --env production");
      await fs.writeFile(`${process.cwd()}/.env.production`, "A=1\nB=2\n");
      await run(["secretsSet"], "--file .env.production --env production");
      expect(calls.map((c) => (c.request as { body: unknown }).body)).toEqual([
        { key: "APP_SECRET", generate: 64 },
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ]);
    });

    it("lists names and masks, and unsets one", async ({ expect }) => {
      const { run, printed, calls, target } = create();
      await run(["secretsList"], "--env production");
      expect(printed).toEqual(
        expect.arrayContaining([
          "DB_PASSWORD  corr…",
          "APP_SECRET  (generated)",
        ]),
      );
      await run(["secretsUnset"], "DB_PASSWORD --env production");
      expect(calls).toEqual([
        {
          name: "unset",
          request: { params: target, query: { key: "DB_PASSWORD" } },
        },
      ]);
    });
  });

  it("routes: add needs --env, list reads them, remove drops one", async ({
    expect,
  }) => {
    const { run, printed, calls, target } = create();
    await expect(
      run(["routeAdd"], "umami analytics.bob.dev"),
    ).rejects.toThrow();
    await run(
      ["routeAdd"],
      "umami --domain analytics.bob.dev --env production",
    );
    await run(["routeList"], "");
    await run(["routeRemove"], "analytics.bob.dev --env production");
    expect(calls).toEqual([
      {
        name: "routeAdd",
        request: {
          params: target,
          body: { service: "umami", domain: "analytics.bob.dev" },
        },
      },
      {
        name: "routeRemove",
        request: { params: target, query: { domain: "analytics.bob.dev" } },
      },
    ]);
    expect(printed).toContain("analytics.bob.dev  umami");
  });

  it("ps shows services and uncovered volumes; logs and restart reach the member", async ({
    expect,
  }) => {
    const { run, printed, calls, target } = create();
    await run(["ps"], "");
    expect(printed.join("\n")).toMatch(/db\s+service\s+active\s+50 MiB/);
    expect(printed).toContain("  not backed up: volume pgdata");
    await run(["logs"], "db --lines 50");
    expect(printed).toContain("listening on 3000");
    await run(["restart"], "db");
    expect(calls).toEqual([
      {
        name: "requestLogs",
        request: { params: target, body: { service: "db", lines: 50 } },
      },
      {
        name: "action",
        request: { params: { ...target, service: "db", verb: "restart" } },
      },
    ]);
  });
});
