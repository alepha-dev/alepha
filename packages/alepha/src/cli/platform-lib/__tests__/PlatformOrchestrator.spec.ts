import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import {
  PlatformAdapter,
  type PlatformState,
} from "../adapters/PlatformAdapter.ts";
import { platformOptions } from "../atoms/platformOptions.ts";
import { PlatformOrchestrator } from "../services/PlatformOrchestrator.ts";

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
      environments: {
        production: { adapter: "cloudflare" },
        staging: { adapter: "cloudflare" },
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

  describe("what `up` reports as the address", () => {
    /*
      An adapter that does not choose the host still had its own config echoed
      back as the deploy's address. When the adapter leaves host composition to
      something else, a `domain` that did not match produced a green run
      printing a link to an address answering 404 with no certificate — while
      the site was serving under the composed name the whole time.
    */
    const upWith = async (controlsDomain: boolean) => {
      const alepha = Alepha.create()
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: ShellProvider, use: MemoryShellProvider });
      alepha.set(platformOptions, {
        environments: { production: { adapter: "bay", domain: "named.test" } },
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ name: "a" }),
      );

      const orchestrator = alepha.inject(
        controlsDomain ? ControllingOrchestrator : ComposingOrchestrator,
      );
      const run = Object.assign(
        (task: { handler: () => Promise<void> }) => task.handler(),
        { end: () => {} },
      ) as any;

      return orchestrator.up({
        root: "/project",
        env: "production",
        entry: {} as any,
        resources: {} as any,
        run,
      });
    };

    test("reports it when the adapter is what attaches it", async ({
      expect,
    }) => {
      expect((await upWith(true)).domain).toBe("named.test");
    });

    test("stays quiet when the host is composed elsewhere", async ({
      expect,
    }) => {
      expect((await upWith(false)).domain).toBeUndefined();
    });
  });

  describe("resolveAdapter", () => {
    test("returns CloudflareAdapter for cloudflare env", async ({ expect }) => {
      const { orchestrator } = createTestEnv();
      const adapter = orchestrator.resolveAdapter("cloudflare");
      expect(adapter).toBeInstanceOf(CloudflareAdapter);
    });

    test("throws for unknown adapter", ({ expect }) => {
      const { orchestrator } = createTestEnv();
      expect(() => orchestrator.resolveAdapter("aks")).toThrow(
        /Unknown adapter/,
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
      expect(orchestrator.isTmpEnv("production")).toBe(false);
      expect(orchestrator.isTmpEnv("staging")).toBe(false);
    });
  });
});

/**
 * A deploy that does nothing, so what `up` REPORTS can be driven without a
 * cloud provider on the other end. Every step is stubbed; the orchestrator's
 * own decision about the address is what stays under test.
 */
class SilentAdapter extends PlatformAdapter {
  async authenticate(): Promise<void> {}
  async build(): Promise<void> {}
  async deploy(): Promise<string | undefined> {
    return undefined;
  }
  async inspect(): Promise<PlatformState> {
    return {
      workers: [],
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };
  }
  async teardown(): Promise<void> {}
}

/** Composes its own host, unlike the base adapter's default of controlling it. */
class ComposingAdapter extends SilentAdapter {
  override readonly controlsDomain = false;
}

class ControllingOrchestrator extends PlatformOrchestrator {
  override resolveAdapter(): PlatformAdapter {
    return this.alepha.inject(SilentAdapter);
  }
}

class ComposingOrchestrator extends PlatformOrchestrator {
  override resolveAdapter(): PlatformAdapter {
    return this.alepha.inject(ComposingAdapter);
  }
}
