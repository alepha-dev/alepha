import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { NamingService } from "../services/NamingService.ts";
import { DockerAdapter } from "./DockerAdapter.ts";
import type { PlatformContext } from "./PlatformAdapter.ts";

describe("DockerAdapter", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const adapter = alepha.inject(DockerAdapter);
    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const naming = alepha.inject(NamingService);

    return { adapter, fs, shell, naming };
  };

  const makeCtx = (
    naming: NamingService,
    overrides: Partial<PlatformContext> = {},
  ): PlatformContext => ({
    project: "myapp",
    env: "local",
    envConfig: { adapter: "docker" },
    apps: [],
    root: "/project",
    naming: naming.forContext("myapp", "local"),
    ...overrides,
  });

  const createMockRun = (): any => {
    const run: any = async (task: any) => {
      if (Array.isArray(task)) {
        await Promise.all(
          task.map((t: any) =>
            typeof t === "object" && t.handler
              ? t.handler()
              : Promise.resolve(),
          ),
        );
      }
      if (typeof task === "object" && task.handler) {
        await task.handler();
      }
    };
    run.pause = () => {};
    run.resume = () => {};
    run.end = () => {};
    return run;
  };

  describe("local mode", () => {
    test("authenticate checks docker is available", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming);
      shell.outputs.set("docker --version", "Docker version 27.0.0");

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      expect(shell.wasCalled("docker --version")).toBe(true);
    });

    test("provision generates docker-compose.yml with postgres for database app", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/docker-compose.yml",
          /postgres/,
        ),
      ).toBe(true);
      expect(shell.wasCalledMatching(/docker compose.*up -d/)).toBe(true);
    });

    test("teardown runs docker compose down", async ({ expect }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming);

      // Pre-populate compose file so teardown finds it
      const composePath = "/project/node_modules/.alepha/docker-compose.yml";
      await fs.mkdir("/project/node_modules/.alepha", { recursive: true });
      await fs.writeFile(composePath, "services:\n  postgres:\n");

      const run = createMockRun();
      await adapter.teardown(ctx, run);

      expect(shell.wasCalledMatching(/docker compose.*down/)).toBe(true);
    });
  });

  describe("remote mode with domain", () => {
    test("provision checks for shared traefik and provisions if missing", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();

      // Traefik not running
      shell.outputs.set(
        "ssh root@1.2.3.4 'docker ps --filter name=alepha-traefik --format '\\''{{.Names}}'\\'''",
        "",
      );

      const ctx = makeCtx(naming, {
        env: "production",
        envConfig: {
          adapter: "docker",
          ip: "1.2.3.4",
          domain: "myapp.com",
        },
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // Should have uploaded traefik compose to /opt/alepha/traefik/
      expect(
        shell.wasCalledMatching(
          /scp.*root@1.2.3.4:\/opt\/alepha\/traefik\/docker-compose.yml/,
        ),
      ).toBe(true);
      // Should have started traefik
      expect(
        shell.wasCalledMatching(/\/opt\/alepha\/traefik.*docker compose up -d/),
      ).toBe(true);
      // Should have uploaded project compose
      expect(
        shell.wasCalledMatching(
          /scp.*root@1.2.3.4:\/opt\/alepha\/myapp-production\/docker-compose.yml/,
        ),
      ).toBe(true);
      // Project compose should have traefik labels but NOT traefik service
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/docker-compose.yml",
          /Host\(`myapp.com`\)/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/docker-compose.yml",
          /container_name: alepha-traefik/,
        ),
      ).toBe(false);
    });

    test("provision skips traefik if already running", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();

      // Traefik already running
      shell.outputs.set(
        "ssh root@1.2.3.4 'docker ps --filter name=alepha-traefik --format '\\''{{.Names}}'\\'''",
        "alepha-traefik",
      );

      const ctx = makeCtx(naming, {
        env: "production",
        envConfig: {
          adapter: "docker",
          ip: "1.2.3.4",
          domain: "myapp.com",
        },
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // Should NOT have uploaded traefik compose
      expect(shell.wasCalledMatching(/scp.*\/opt\/alepha\/traefik/)).toBe(
        false,
      );
    });
  });

  describe("remote mode without domain", () => {
    test("provision skips traefik entirely and exposes port directly", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();

      const ctx = makeCtx(naming, {
        env: "staging",
        envConfig: { adapter: "docker", ip: "1.2.3.4" },
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // No traefik check or provisioning
      expect(shell.wasCalledMatching(/alepha-traefik/)).toBe(false);
      // Project compose should have port exposure
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/docker-compose.yml",
          /3000:3000/,
        ),
      ).toBe(true);
    });
  });

  describe("local up flow (end to end)", () => {
    test("provision generates compose and starts containers for app with postgres + redis", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: true,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // Compose file should contain both postgres and redis
      const composeContent = fs.files.get(
        "/project/node_modules/.alepha/docker-compose.yml",
      );
      expect(composeContent).toBeDefined();
      const yaml = composeContent!.toString();
      expect(yaml).toContain("postgres:");
      expect(yaml).toContain("redis:");
      expect(yaml).toContain("POSTGRES_DB: myapp_local");

      // Docker compose up should have been called
      expect(shell.wasCalledMatching(/docker compose.*up -d/)).toBe(true);
    });

    test("provision skips when no resources needed", async ({ expect }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // No compose file written, no docker compose called
      expect(
        fs.wasWritten("/project/node_modules/.alepha/docker-compose.yml"),
      ).toBe(false);
      expect(shell.wasCalledMatching(/docker compose/)).toBe(false);
    });

    test("provision skips postgres when DATABASE_URL set", async ({
      expect,
    }) => {
      const { adapter, fs, naming } = createTestEnv();

      // Write .env.local with DATABASE_URL
      await fs.writeFile(
        "/project/.env.local",
        "DATABASE_URL=postgresql://external:5432/db",
      );

      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "",
            entry: { root: "/project", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // No compose file should be written (only resource was postgres, which is skipped)
      expect(
        fs.wasWritten("/project/node_modules/.alepha/docker-compose.yml"),
      ).toBe(false);
    });
  });
});
