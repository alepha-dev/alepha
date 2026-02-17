import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { platformOptions } from "../../atoms/platformOptions.ts";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import { PlatformOrchestrator } from "./PlatformOrchestrator.ts";

describe("PlatformOrchestrator", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const orchestrator = alepha.inject(PlatformOrchestrator);

    // Default config
    alepha.set(platformOptions, {
      platform: {
        environments: {
          prod: { adapter: "cloudflare" },
          staging: { adapter: "cloudflare" },
        },
      },
    });

    // Default package.json
    fs.writeFile(
      "/project/package.json",
      JSON.stringify({
        name: "my-app",
        devDependencies: { wrangler: "^3.0.0" },
      }),
    );

    // Default wrangler responses
    shell.outputs.set("wrangler whoami", "Account | abc123");
    shell.outputs.set("wrangler d1 list --json", "[]");

    return { alepha, fs, shell, orchestrator };
  };

  describe("resolveAdapter", () => {
    test("returns CloudflareAdapter for cloudflare env", async ({ expect }) => {
      const { orchestrator } = createTestEnv();
      const adapter = orchestrator.resolveAdapter("cloudflare");
      expect(adapter).toBeInstanceOf(CloudflareAdapter);
    });

    test("throws for unsupported adapter", ({ expect }) => {
      const { orchestrator } = createTestEnv();
      expect(() => orchestrator.resolveAdapter("aks")).toThrow(
        /not yet available/,
      );
    });
  });

  describe("down safety", () => {
    test("isTmpEnv returns true for tmp- prefix", ({ expect }) => {
      const { orchestrator } = createTestEnv();
      expect(orchestrator.isTmpEnv("tmp-bug001")).toBe(true);
      expect(orchestrator.isTmpEnv("tmp-anything")).toBe(true);
    });

    test("isTmpEnv returns false for named envs", ({ expect }) => {
      const { orchestrator } = createTestEnv();
      expect(orchestrator.isTmpEnv("prod")).toBe(false);
      expect(orchestrator.isTmpEnv("staging")).toBe(false);
    });
  });
});
