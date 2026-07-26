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
