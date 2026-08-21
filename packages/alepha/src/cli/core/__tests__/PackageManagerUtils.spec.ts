import { Alepha, Json } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";

/**
 * Exposes the protected user-agent seam so tests can drive detection
 * without mutating `process.env`.
 */
class TestPackageManagerUtils extends PackageManagerUtils {
  public userAgent: string | undefined;

  public testParseUserAgent = this.parseUserAgent.bind(this);

  protected detectFromUserAgent() {
    return this.parseUserAgent(this.userAgent);
  }
}

describe("PackageManagerUtils", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      json: alepha.inject(Json),
      pm: alepha.inject(TestPackageManagerUtils),
    };
  };

  describe("parseUserAgent", () => {
    it("should recognise every supported manager", () => {
      const { pm } = createTestEnv();

      expect(
        pm.testParseUserAgent("npm/10.9.0 node/v22.11.0 darwin arm64"),
      ).toBe("npm");
      expect(pm.testParseUserAgent("yarn/4.17.1 npm/? node/v22.11.0")).toBe(
        "yarn",
      );
      expect(pm.testParseUserAgent("pnpm/9.12.0 npm/? node/v22.11.0")).toBe(
        "pnpm",
      );
      expect(pm.testParseUserAgent("bun/1.1.34 npm/? node/v22.6.0")).toBe(
        "bun",
      );
    });

    it("should return null for missing or unknown agents", () => {
      const { pm } = createTestEnv();

      expect(pm.testParseUserAgent(undefined)).toBe(null);
      expect(pm.testParseUserAgent("")).toBe(null);
      expect(pm.testParseUserAgent("deno/2.0.0 node/v22")).toBe(null);
    });
  });

  describe("getPackageManager", () => {
    it("should honour an explicit pm over every other signal", async () => {
      const { fs, pm } = createTestEnv();
      await fs.writeFile("/project/yarn.lock", "");
      pm.userAgent = "pnpm/9.12.0 npm/? node/v22.11.0";

      expect(await pm.getPackageManager("/project", "npm")).toBe("npm");
    });

    it("should detect the invoking manager when nothing else says otherwise", async () => {
      for (const [agent, expected] of [
        ["bun/1.1.34 npm/? node/v22.6.0", "bun"],
        ["pnpm/9.12.0 npm/? node/v22.11.0", "pnpm"],
        ["yarn/4.17.1 npm/? node/v22.11.0", "yarn"],
      ] as const) {
        const { pm } = createTestEnv();
        pm.userAgent = agent;

        expect(await pm.getPackageManager("/empty")).toBe(expected);
      }
    });

    it("should prefer a lockfile over the invoking manager", async () => {
      const { fs, pm } = createTestEnv();
      await fs.writeFile("/project/yarn.lock", "");
      pm.userAgent = "npm/10.9.0 node/v22.11.0 darwin arm64";

      expect(await pm.getPackageManager("/project")).toBe("yarn");
    });

    it("should prefer the workspace manager over the invoking manager", async () => {
      const { fs, json, pm } = createTestEnv();
      await fs.writeFile(
        "/workspace/package.json",
        json.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
      );
      await fs.writeFile("/workspace/yarn.lock", "");
      await fs.writeFile(
        "/workspace/packages/my-pkg/package.json",
        json.stringify({ name: "my-pkg" }),
      );
      pm.userAgent = "npm/10.9.0 node/v22.11.0 darwin arm64";

      expect(await pm.getPackageManager("/workspace/packages/my-pkg")).toBe(
        "yarn",
      );
    });

    it("should fall back to npm with no signal at all", async () => {
      const { pm } = createTestEnv();
      pm.userAgent = undefined;

      expect(await pm.getPackageManager("/empty")).toBe("npm");
    });
  });
});

/**
 * `getWorkspaceContext` treated any ancestor with a lockfile + package.json as
 * "our workspace root". `alepha init` in a nested directory of an UNRELATED
 * repository therefore skipped git init / AGENTS.md / package-manager setup
 * and installed into that repo's root. It also never checked depth 1, so a
 * package sitting directly under a real workspace root reported no context.
 */
describe("getWorkspaceContext — workspace membership", () => {
  const seed = async (
    files: Record<string, unknown>,
  ): Promise<TestPackageManagerUtils> => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const [path, content] of Object.entries(files)) {
      fs.files.set(
        path,
        Buffer.from(
          typeof content === "string" ? content : JSON.stringify(content),
        ),
      );
    }
    return alepha.inject(TestPackageManagerUtils);
  };

  it("recognises a package the root actually declares", async () => {
    const pm = await seed({
      "/repo/yarn.lock": "",
      "/repo/package.json": { name: "root", workspaces: ["packages/*"] },
      "/repo/packages/app/package.json": { name: "app" },
    });

    const ctx = await pm.getWorkspaceContext("/repo/packages/app");
    expect(ctx.isPackage).toBe(true);
    expect(ctx.workspaceRoot).toBe("/repo");
  });

  it("recognises a package directly under the root (depth 1)", async () => {
    const pm = await seed({
      "/repo/yarn.lock": "",
      "/repo/package.json": { name: "root", workspaces: ["app"] },
      "/repo/app/package.json": { name: "app" },
    });

    const ctx = await pm.getWorkspaceContext("/repo/app");
    expect(ctx.isPackage).toBe(true);
  });

  it("refuses an unrelated parent repo that does not declare us", async () => {
    const pm = await seed({
      "/other/yarn.lock": "",
      "/other/package.json": { name: "other", workspaces: ["libs/*"] },
      "/other/somewhere/mine/package.json": { name: "mine" },
    });

    const ctx = await pm.getWorkspaceContext("/other/somewhere/mine");
    expect(ctx.isPackage).toBe(false);
    expect(ctx.workspaceRoot).toBeNull();
  });

  it("refuses a parent repo with no workspaces at all", async () => {
    const pm = await seed({
      "/other/yarn.lock": "",
      "/other/package.json": { name: "other" },
      "/other/nested/mine/package.json": { name: "mine" },
    });

    expect((await pm.getWorkspaceContext("/other/nested/mine")).isPackage).toBe(
      false,
    );
  });

  it("supports the object form of workspaces", async () => {
    const pm = await seed({
      "/repo/pnpm-lock.yaml": "",
      "/repo/package.json": {
        name: "root",
        workspaces: { packages: ["packages/**"] },
      },
      "/repo/packages/scope/app/package.json": { name: "app" },
    });

    expect(
      (await pm.getWorkspaceContext("/repo/packages/scope/app")).isPackage,
    ).toBe(true);
  });
});

/**
 * Regression: a `pnpm create alepha` scaffold installed cleanly, printed
 * "Project ready!", and then failed `dev`, `build`, `test` and `typecheck`
 * on `Cannot find module 'vitest'`. The toolchain ships inside `alepha`'s own
 * dependencies and the generated `vite.config.ts` / dummy spec import it
 * directly, which only ever worked because npm, bun and yarn hoist. `create`
 * exited 0 under all four managers, so nothing short of running the
 * scaffolded project could see it.
 */
describe("ensurePnpm — hoisting", () => {
  const seed = async (files: Record<string, string> = {}) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    fs.files.set(
      "/app/package.json",
      Buffer.from(JSON.stringify({ name: "app" })),
    );
    for (const [path, content] of Object.entries(files)) {
      fs.files.set(path, Buffer.from(content));
    }
    return { fs, pm: alepha.inject(TestPackageManagerUtils) };
  };

  const npmrc = async (fs: MemoryFileSystemProvider): Promise<string | null> =>
    (await fs.exists("/app/.npmrc"))
      ? (await fs.readFile("/app/.npmrc")).toString("utf-8")
      : null;

  it("writes node-linker=hoisted into a fresh project", async () => {
    const { fs, pm } = await seed();

    await pm.ensurePnpm("/app");

    expect(await npmrc(fs)).toBe("node-linker=hoisted\n");
  });

  it("keeps an existing .npmrc and appends to it", async () => {
    const { fs, pm } = await seed({
      "/app/.npmrc": "registry=https://npm.example.com/",
    });

    await pm.ensurePnpm("/app");

    expect(await npmrc(fs)).toBe(
      "registry=https://npm.example.com/\nnode-linker=hoisted\n",
    );
  });

  it("leaves an explicit node-linker choice alone", async () => {
    const { fs, pm } = await seed({
      "/app/.npmrc": "node-linker=isolated\n",
    });

    await pm.ensurePnpm("/app");

    expect(await npmrc(fs)).toBe("node-linker=isolated\n");
  });

  it("does not write an .npmrc for the managers that hoist by default", async () => {
    for (const ensure of ["ensureNpm", "ensureYarn", "ensureBun"] as const) {
      const { fs, pm } = await seed();

      await pm[ensure]("/app");

      expect(await npmrc(fs)).toBe(null);
    }
  });
});
