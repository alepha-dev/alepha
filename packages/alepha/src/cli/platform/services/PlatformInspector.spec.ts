import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";
import { Asker } from "../../../command/helpers/Asker.ts";
import { platformOptions } from "../../atoms/platformOptions.ts";
import { PlatformInspector } from "./PlatformInspector.ts";

class TestAsker extends Asker {
  protected answers: string[] = [];
  protected answerIndex = 0;

  /**
   * Queue answers for the wizard prompts.
   */
  setAnswers(...answers: string[]) {
    this.answers = answers;
    this.answerIndex = 0;
  }

  protected override createPromptInterface() {
    return {
      question: async () => this.answers[this.answerIndex++] ?? "",
      close: () => {},
    } as any;
  }
}

describe("PlatformInspector", () => {
  const createTestEnv = (config: Record<string, any> = {}) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: Asker, use: TestAsker });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const inspector = alepha.inject(PlatformInspector);
    const asker = alepha.inject(TestAsker);

    // Set platform options
    alepha.set(platformOptions, config);

    return { alepha, fs, inspector, asker };
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
    const { inspector, fs } = createTestEnv({
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
      },
    });

    // No package.json
    await expect(inspector.resolveConfig("/project")).rejects.toThrowError(
      AlephaError,
    );
  });

  test("reads project name from package.json", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
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
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "ignored" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.project).toBe("my-custom-name");
  });

  test("resolves default env to prod", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
      },
    });

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    const config = await inspector.resolveConfig("/project");
    expect(config.defaultEnv).toBe("prod");
  });

  test("resolves custom default env", async ({ expect }) => {
    const { inspector, fs } = createTestEnv({
      platform: {
        default: "staging",
        environments: {
          staging: { adapter: "cloudflare" },
        },
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
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
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
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
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
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
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
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
        },
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

  test("wizard creates config and resolves when no platform config", async ({
    expect,
  }) => {
    const { inspector, fs, asker } = createTestEnv({});

    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "my-app" }),
    );

    // Wizard answers: adapter
    asker.setAnswers("cloudflare");

    const config = await inspector.resolveConfig("/project");

    expect(config.project).toBe("my-app");
    expect(config.defaultEnv).toBe("prod");
    expect(config.environments.prod.adapter).toBe("cloudflare");
    expect(fs.wasWritten("/project/alepha.config.ts")).toBe(true);
  });

  test("wizard asks for name when package.json has none", async ({
    expect,
  }) => {
    const { inspector, fs, asker } = createTestEnv({});

    // Wizard answers: adapter, then name
    asker.setAnswers("cloudflare", "custom-project");

    const config = await inspector.resolveConfig("/project");

    expect(config.project).toBe("custom-project");
    expect(fs.wasWritten("/project/alepha.config.ts")).toBe(true);
    expect(
      fs.wasWrittenMatching("/project/alepha.config.ts", /custom-project/),
    ).toBe(true);
  });
});
