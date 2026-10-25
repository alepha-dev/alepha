import { gunzipSync } from "node:zlib";

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
import { LoreStackBundler } from "../services/LoreStackBundler.ts";
import { LoreStackService } from "../services/LoreStackService.ts";

/**
 * `lore stack create, deploy, rollback, destroy, list, revisions` (#Q2700),
 * against a faked Lore: the bundle collects what the compose file mounts,
 * the first deploy of an environment creates it, a deploy is followed to its
 * end, and a failed one fails the command.
 */
describe("lore stack", () => {
  const create = (
    options: { outcome?: "succeeded" | "failed"; environments?: string[] } = {},
  ) => {
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
    const fs = alepha.inject(MemoryFileSystemProvider);
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const calls: Array<{ name: string; request?: unknown }> = [];
    const environments = (options.environments ?? []).map((env, i) => ({
      id: `env-${i}`,
      env,
      routes: [],
      members: [],
    }));
    const stack = () => ({
      id: "s1",
      name: "hello",
      latestRevision: 1,
      environments,
    });
    let polls = 0;

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
        stacks: { listStacks: async () => ({ items: [stack()] }) },
        estates: {
          listProjectEstates: async () => ({
            items: [{ id: "e1", slug: "vps-ovh" }],
          }),
        },
        deploys: {
          listStackDeployments: async () => {
            polls += 1;
            const done = polls > 1;
            return {
              items: [
                {
                  id: "d1",
                  status: done ? (options.outcome ?? "succeeded") : "running",
                  step: done ? undefined : "deploying",
                  error:
                    options.outcome === "failed"
                      ? "image not found"
                      : undefined,
                  plan: done
                    ? JSON.stringify({
                        created: ["db"],
                        changed: [],
                        removed: [],
                      })
                    : undefined,
                },
              ],
            };
          },
        },
      },
    );
    const command = alepha.inject(StackCommand);
    Object.assign(command as unknown as Record<string, unknown>, {
      stackApi: {
        createStack: async (request: unknown) => {
          calls.push({ name: "createStack", request });
          return { id: "s1", name: "hello" };
        },
        uploadStackRevision: async (request: { body: { file: File } }) => {
          calls.push({ name: "upload", request: request.body.file.name });
          return { number: 2 };
        },
        createStackEnvironment: async (request: { body: { env: string } }) => {
          calls.push({ name: "createEnvironment", request: request.body });
          environments.push({
            id: `env-${environments.length}`,
            env: request.body.env,
            routes: [],
            members: [],
          });
          return {};
        },
        deleteStackEnvironment: async (request: unknown) => {
          calls.push({ name: "deleteEnvironment", request });
          return { ok: true };
        },
      },
      deployApi: {
        deployStackEnvironment: async (request: unknown) => {
          calls.push({ name: "deploy", request });
          return { id: "d1", revision: 2 };
        },
        rollbackStackEnvironment: async (request: unknown) => {
          calls.push({ name: "rollback", request });
          return { id: "d1", revision: 1 };
        },
      },
    });
    const run = async (sub: keyof StackCommand, argv: string) => {
      await alepha.inject(CliProvider).run(command[sub] as never, { argv });
    };
    return { alepha, fs, run, printed, calls };
  };

  describe("the bundle", () => {
    it("carries the compose file and every file it mounts, and refuses a missing one before uploading", async ({
      expect,
    }) => {
      const { alepha, fs } = create();
      await fs.writeFile(
        "/app/compose.yml",
        'services:\n  broker:\n    image: eclipse-mosquitto:2\n    volumes: ["./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro", "data:/data"]\n',
      );
      await fs.writeFile("/app/mosquitto.conf", "listener 21883\n");
      const bundler = alepha.inject(LoreStackBundler);
      const bundle = await bundler.bundle("/app/compose.yml");
      expect(bundle.paths).toEqual(["compose.yml", "mosquitto.conf"]);
      const tar = gunzipSync(
        Buffer.from(await bundle.file.arrayBuffer()),
      ).toString("latin1");
      expect(tar).toContain("listener 21883");

      await fs.rm("/app/mosquitto.conf");
      await expect(bundler.bundle("/app/compose.yml")).rejects.toThrow(
        "mounts ./mosquitto.conf, which does not exist",
      );
    });

    it("sends a compose file that mounts nothing as it is", async ({
      expect,
    }) => {
      const { alepha, fs } = create();
      await fs.writeFile(
        "/umami/docker-compose.yml",
        "services:\n  db:\n    image: postgres\n",
      );
      const bundle = await alepha
        .inject(LoreStackBundler)
        .bundle("/umami/docker-compose.yml");
      expect(bundle.file.name).toBe("compose.yml");
    });
  });

  it("create names the stack after the project and sets its default estate", async ({
    expect,
  }) => {
    const { run, calls } = create();
    await run("create", "--estate vps-ovh");
    expect(calls).toEqual([
      {
        name: "createStack",
        request: {
          params: { projectId: 7 },
          body: { name: "hello", estateId: "e1" },
        },
      },
    ]);
  });

  it("deploy uploads the compose file here, creates the environment on its first deploy, follows it, and prints the plan", async ({
    expect,
  }) => {
    const { fs, run, calls, printed } = create();
    await fs.writeFile(
      `${process.cwd()}/compose.yml`,
      "services:\n  db:\n    image: postgres\n",
    );
    await run("deploy", "--env staging");
    expect(calls.map((c) => c.name)).toEqual([
      "upload",
      "createEnvironment",
      "deploy",
    ]);
    expect(calls[1].request).toEqual({ env: "staging" });
    expect(printed.join("\n")).toContain("created: db");
    expect(printed.join("\n")).toContain(
      "Deployed revision 2 to hello/staging.",
    );
  });

  it("a failed deploy fails the command, with the machine's reason", async ({
    expect,
  }) => {
    const { run } = create({ outcome: "failed", environments: ["production"] });
    await expect(run("deploy", "")).rejects.toThrow("image not found");
  });

  it("--dry-run changes nothing", async ({ expect }) => {
    const { run, calls, printed } = create({ environments: ["production"] });
    await run("deploy", "--dry-run");
    expect(calls).toEqual([]);
    expect(printed.join("\n")).toContain("Would deploy hello/production");
  });

  it("rollback deploys an earlier revision and follows it", async ({
    expect,
  }) => {
    const { run, calls } = create({ environments: ["production"] });
    await run("rollback", "--env production --to 1");
    expect(calls[0]).toEqual({
      name: "rollback",
      request: {
        params: { projectId: 7, stackId: "s1", environmentId: "env-0" },
        body: { revision: 1 },
      },
    });
  });

  it("destroy --yes forgets the environment and prints the machine's command", async ({
    expect,
  }) => {
    const { run, calls, printed } = create({ environments: ["staging"] });
    await run("destroy", "--env staging --purge --yes");
    expect(calls.map((c) => c.name)).toEqual(["deleteEnvironment"]);
    expect(printed).toContain("  bay stack destroy hello/staging --purge");
  });
});
