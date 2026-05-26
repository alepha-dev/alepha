import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";
import { platformOptions } from "../atoms/platformOptions.ts";
import { PlatformInspector } from "../services/PlatformInspector.ts";

describe("PlatformInspector", () => {
  const createTestEnv = (config: Record<string, any> = {}) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const inspector = alepha.inject(PlatformInspector);

    alepha.set(platformOptions, config as any);

    return { alepha, fs, inspector };
  };

  test("throws when platform is not configured in CI", async ({ expect }) => {
    process.env.CI = "1";
    try {
      const { inspector } = createTestEnv({});
      await expect(inspector.resolveConfig("/project")).rejects.toThrowError(
        AlephaError,
      );
    } finally {
      delete process.env.CI;
    }
  });

  test("throws when project name is missing", async ({ expect }) => {
    const { inspector } = createTestEnv({
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await expect(inspector.resolveConfig("/project")).rejects.toThrowError(
      AlephaError,
    );
  });

  test("reads project name from package.json", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "@acme/portal" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.project).toBe("acme-portal");
  });

  test("uses config name over package.json", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      name: "my-custom-name",
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "ignored" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.project).toBe("my-custom-name");
  });

  test("resolves default env to production", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.defaultEnv).toBe("production");
  });

  test("resolves custom default env", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      default: "staging",
      environments: {
        staging: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.defaultEnv).toBe("staging");
  });

  test("throws on unknown environment", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    await expect(
      inspector.resolveEnvironment("/project", "nope"),
    ).rejects.toThrowError(/Unknown environment "nope"/);
  });

  test("detects standalone mode when apps is empty", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.isMonorepo).toBe(false);
  });

  test("detects monorepo mode when apps is set", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      apps: ["apps/web", "apps/api"],
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );
    await fs.writeFile(
      "/project/apps/web/package.json",
      JSON.stringify({ name: "web" }),
    );
    await fs.writeFile(
      "/project/apps/api/package.json",
      JSON.stringify({ name: "api" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.isMonorepo).toBe(true);
    expect(config.appPaths).toEqual(["apps/web", "apps/api"]);
  });

  test("throws when monorepo app has no package.json name", async ({
    expect,
  }) => {
    const { inspector, fs } = createTestEnv({
      apps: ["apps/web"],
      environments: {
        production: { adapter: "cloudflare" },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );
    await fs.writeFile("/project/apps/web/package.json", JSON.stringify({}));

    await expect(inspector.resolveConfig("/project")).rejects.toThrowError(
      /Missing "name".*apps\/web/,
    );
  });
});
