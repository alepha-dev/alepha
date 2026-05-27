import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";
import { VercelAdapter } from "../adapters/VercelAdapter.ts";
import { NamingService } from "../services/NamingService.ts";
import { VercelApi } from "../services/VercelApi.ts";
import { VercelCli } from "../services/VercelCli.ts";

/**
 * In-memory VercelApi for testing.
 *
 * Stores resources in maps and implements the same interface
 * without making any HTTP calls.
 */
class MemoryVercelApi extends VercelApi {
  public projects: Array<{ id: string; name: string; accountId: string }> = [];
  public deployments: Map<
    string,
    Array<{
      uid: string;
      name: string;
      url: string;
      created?: number;
      target?: string;
    }>
  > = new Map();
  public envVars: Map<
    string,
    Array<{
      id: string;
      key: string;
      value?: string;
      type: string;
      target: string[];
    }>
  > = new Map();

  public override async resolveToken(): Promise<string> {
    return "test-token";
  }

  public override async listProjects() {
    return this.projects;
  }

  public override async getProject(nameOrId: string) {
    return this.projects.find((p) => p.name === nameOrId || p.id === nameOrId);
  }

  public override async createProject(name: string) {
    const project = { id: `proj-${name}`, name, accountId: "test-account" };
    this.projects.push(project);
    return project;
  }

  public override async deleteProject(nameOrId: string) {
    this.projects = this.projects.filter(
      (p) => p.name !== nameOrId && p.id !== nameOrId,
    );
  }

  public override async listDeployments(projectId: string) {
    return this.deployments.get(projectId) ?? [];
  }

  public override async listEnvVars(projectId: string) {
    return this.envVars.get(projectId) ?? [];
  }

  public override async upsertEnvVars(
    projectId: string,
    vars: Array<{ key: string; value: string; target: string[] }>,
  ) {
    const existing = this.envVars.get(projectId) ?? [];
    for (const v of vars) {
      const idx = existing.findIndex((e) => e.key === v.key);
      const entry = {
        id: `env-${v.key}`,
        key: v.key,
        value: v.value,
        type: "encrypted",
        target: v.target,
      };
      if (idx >= 0) {
        existing[idx] = entry;
      } else {
        existing.push(entry);
      }
    }
    this.envVars.set(projectId, existing);
  }

  public override async deleteEnvVar(projectId: string, envVarId: string) {
    const existing = this.envVars.get(projectId) ?? [];
    this.envVars.set(
      projectId,
      existing.filter((e) => e.id !== envVarId),
    );
  }
}

/**
 * In-memory VercelCli for testing.
 *
 * Stubs CLI operations without spawning processes.
 */
class MemoryVercelCli extends VercelCli {
  public authToken = "test-token";
  public lastDeployDir?: string;
  public lastDeployOptions?: { prod?: boolean; token?: string };

  public override async ensureInstalled(): Promise<void> {}

  public override async getAuthToken(): Promise<string> {
    return this.authToken;
  }

  public override async whoami(): Promise<string> {
    return "test-user";
  }

  public override async login(): Promise<void> {}

  public override async deploy(
    distDir: string,
    options: { prod?: boolean; token?: string },
  ): Promise<string | undefined> {
    this.lastDeployDir = distDir;
    this.lastDeployOptions = options;
    return "https://my-app.vercel.app";
  }
}

describe("VercelAdapter", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: VercelApi, use: MemoryVercelApi })
      .with({ provide: VercelCli, use: MemoryVercelCli });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const adapter = alepha.inject(VercelAdapter);
    const naming = alepha.inject(NamingService);
    const api = alepha.inject(MemoryVercelApi);
    const cli = alepha.inject(MemoryVercelCli);

    // Pre-seed package.json so ensureDependency finds vercel already installed
    fs.files.set(
      "/project/package.json",
      Buffer.from(
        JSON.stringify({
          name: "test",
          devDependencies: { vercel: "^35.0.0" },
        }),
      ),
    );

    return { alepha, fs, shell, dateTime, adapter, naming, api, cli };
  };

  const makeCtx = (
    naming: NamingService,
    overrides: Partial<PlatformContext> = {},
  ): PlatformContext => ({
    project: "acme-portal",
    env: "production",
    envConfig: { adapter: "vercel" },
    entry: { root: "/project", server: "src/main.ts" },
    resources: {
      hasDatabase: false,
      hasBucket: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
    },
    root: "/project",
    naming: naming.forContext("acme-portal", "production"),
    ...overrides,
  });

  describe("authenticate", () => {
    test("skips login when token exists and whoami succeeds", async ({
      expect,
    }) => {
      const { adapter, naming, cli } = createTestEnv();
      const ctx = makeCtx(naming);

      let loginCalled = false;
      const originalLogin = cli.login.bind(cli);
      cli.login = async () => {
        loginCalled = true;
        return originalLogin();
      };

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      expect(loginCalled).toBe(false);
    });

    test("cache fresh: second call skips recordLogin", async ({ expect }) => {
      const { adapter, fs, dateTime, naming } = createTestEnv();
      const ctx = makeCtx(naming);

      dateTime.pause();

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      // First call should have written the cache file
      const cachePath = "/project/node_modules/.alepha/platform.json";
      expect(fs.wasWritten(cachePath)).toBe(true);

      // Reset tracking to detect second write
      fs.writeFileCalls.length = 0;
      await adapter.authenticate(ctx, run);

      // Second call — cache is fresh, recordLogin is skipped
      expect(fs.wasWritten(cachePath)).toBe(false);
    });
  });

  describe("secrets", () => {
    test("pushes non-excluded env vars via VercelApi.upsertEnvVars", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // Pre-seed the project so upsertEnvVars has a target
      api.projects.push({
        id: "proj-acme",
        name: "acme-portal-production",
        accountId: "test-account",
      });

      // Write .env.production with a mix of secrets and excluded vars
      await fs.writeFile(
        "/project/.env.production",
        [
          "GOOGLE_API_KEY=sk-123",
          "APP_SECRET=my-secret",
          "VITE_PUBLIC_KEY=public-abc",
          "NODE_ENV=production",
          "",
        ].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      const pushed = api.envVars.get("acme-portal-production") ?? [];
      const pushedKeys = pushed.map((v) => v.key);

      // Should include non-excluded vars
      expect(pushedKeys).toContain("GOOGLE_API_KEY");
      expect(pushedKeys).toContain("APP_SECRET");

      // Excluded vars should NOT be pushed
      expect(pushedKeys).not.toContain("VITE_PUBLIC_KEY");
      expect(pushedKeys).not.toContain("NODE_ENV");
    });

    test("filters out VITE_* and NODE_ENV", async ({ expect }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      api.projects.push({
        id: "proj-acme",
        name: "acme-portal-production",
        accountId: "test-account",
      });

      await fs.writeFile(
        "/project/.env.production",
        [
          "VITE_API_URL=https://api.example.com",
          "VITE_PUBLIC_KEY=abc",
          "NODE_ENV=production",
          "REAL_SECRET=keep-me",
          "",
        ].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      const pushed = api.envVars.get("acme-portal-production") ?? [];
      const pushedKeys = pushed.map((v) => v.key);

      expect(pushedKeys).toEqual(["REAL_SECRET"]);
    });

    test("skips when no env file exists", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      let upsertCalled = false;
      const originalUpsert = api.upsertEnvVars.bind(api);
      api.upsertEnvVars = async (
        ...args: Parameters<typeof api.upsertEnvVars>
      ) => {
        upsertCalled = true;
        return originalUpsert(...args);
      };

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      expect(upsertCalled).toBe(false);
    });
  });

  describe("inspect", () => {
    test("returns project state with deployment info", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // Pre-seed project and deployments
      api.projects.push({
        id: "proj-acme",
        name: "acme-portal-production",
        accountId: "test-account",
      });
      api.deployments.set("proj-acme", [
        {
          uid: "dpl-abc123",
          name: "acme-portal-production",
          url: "acme-portal-production.vercel.app",
          created: 1700000000000,
          target: "production",
        },
      ]);

      const run = createMockRun();
      const state = await adapter.inspect(ctx, run);

      expect(state.workers).toHaveLength(1);
      expect(state.workers[0].name).toBe("acme-portal-production");
      expect(state.workers[0].exists).toBe(true);
      expect(state.workers[0].version).toBe("dpl-abc123");
    });

    test("returns env var deployment status", async ({ expect }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      api.projects.push({
        id: "proj-acme",
        name: "acme-portal-production",
        accountId: "test-account",
      });

      // Some env vars deployed, some not
      api.envVars.set("acme-portal-production", [
        {
          id: "env-1",
          key: "GOOGLE_API_KEY",
          type: "encrypted",
          target: ["production"],
        },
      ]);

      await fs.writeFile(
        "/project/.env.production",
        ["GOOGLE_API_KEY=sk-123", "MISSING_SECRET=value", ""].join("\n"),
      );

      const run = createMockRun();
      const state = await adapter.inspect(ctx, run);

      expect(state.secrets).toHaveLength(2);

      const deployed = state.secrets.find((s) => s.name === "GOOGLE_API_KEY");
      expect(deployed?.deployed).toBe(true);

      const missing = state.secrets.find((s) => s.name === "MISSING_SECRET");
      expect(missing?.deployed).toBe(false);
    });
  });

  describe("teardown", () => {
    test("deletes projects via VercelApi.deleteProject", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // Pre-seed project
      api.projects.push({
        id: "proj-acme",
        name: "acme-portal-production",
        accountId: "test-account",
      });

      const run = createMockRun();
      await adapter.teardown(ctx, run);

      expect(api.projects).toHaveLength(0);
    });
  });
});

/**
 * Create a mock RunnerMethod that just executes handlers directly.
 */
function createMockRun(): any {
  const run: any = async (task: any) => {
    if (Array.isArray(task)) {
      await Promise.all(
        task.map((t) =>
          typeof t === "object" && t.handler ? t.handler() : Promise.resolve(),
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
}
