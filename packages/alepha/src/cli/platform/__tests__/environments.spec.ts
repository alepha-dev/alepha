import { $module, Alepha, z } from "alepha";
import { defineConfig } from "alepha/cli/config";
import {
  BayAdapter,
  bay,
  CloudflareAdapter,
  cloudflare,
  type EnvironmentDescriptor,
  PlatformAdapter,
  PlatformOrchestrator,
  type PlatformState,
  platformOptions,
} from "alepha/cli/platform-lib";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { platform } from "../index.ts";

describe("platform environments", () => {
  describe("the built-in factories", () => {
    it("return their adapter class and the options as given", ({ expect }) => {
      expect(cloudflare({ domain: "myapp.com" })).toEqual({
        adapter: CloudflareAdapter,
        options: { domain: "myapp.com" },
      });
      expect(bay({ host: "deploy@bay.example.com" })).toEqual({
        adapter: BayAdapter,
        options: { host: "deploy@bay.example.com" },
      });
      expect(cloudflare()).toEqual({ adapter: CloudflareAdapter, options: {} });
    });

    it("carry the adapter's display id on the class, never as a lookup key", ({
      expect,
    }) => {
      expect(cloudflare().adapter.id).toBe("cloudflare");
      expect(bay().adapter.id).toBe("bay");
    });
  });

  describe("the options atom", () => {
    it("refuses the old string form, naming the factory that replaces it", ({
      expect,
    }) => {
      const alepha = Alepha.create();

      expect(() =>
        alepha.set(platformOptions, {
          environments: { production: { adapter: "cloudflare" } },
        } as never),
      ).toThrow(/adapter factory/);
    });
  });

  describe("resolving an environment", () => {
    const resolve = async (environments: Record<string, unknown>) => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      defineConfig({
        plugins: [platform({ name: "demo", environments } as never)],
      })(alepha);
      await alepha.start();
      return alepha.inject(PlatformOrchestrator);
    };

    it("refuses a bad option by environment name, before any adapter runs", async ({
      expect,
    }) => {
      const orchestrator = await resolve({
        production: cloudflare(),
        staging: cloudflare({ jurisdiction: "us" as never }),
      });

      await expect(
        orchestrator.resolveEnvironment("/project", "staging"),
      ).rejects.toThrow(
        /Environment "staging" has invalid options for the 'cloudflare' adapter: jurisdiction:/,
      );
      // The other environment is untouched by its sibling's mistake.
      await expect(
        orchestrator.resolveEnvironment("/project", "production"),
      ).resolves.toMatchObject({ env: "production" });
    });

    it("refuses a wildcard domain, pointing at Lore Deploy", async ({
      expect,
    }) => {
      // The zone Route that served wildcard hosts is gone (#Q2482): a Custom
      // Domain is the only binding, and Cloudflare refuses a wildcard one at
      // deploy with a message naming nothing about this configuration.
      const orchestrator = await resolve({
        production: cloudflare({ domain: "*.club.alepha.dev" }),
      });

      await expect(
        orchestrator.resolveEnvironment("/project", "production"),
      ).rejects.toThrow(/domain: .*Lore Deploy/);
    });

    it("refuses an environment the config does not have", async ({
      expect,
    }) => {
      const orchestrator = await resolve({ production: cloudflare() });

      await expect(
        orchestrator.resolveEnvironment("/project", "prdo"),
      ).rejects.toThrow(/Unknown environment "prdo"\. Available: production/);
    });

    it("resolves a third-party adapter after start, because platform() registered its module", async ({
      expect,
    }) => {
      // ⚠️ The container is started before anything is resolved, which is the
      // CLI's order. `inject` after `start()` refuses a service whose module
      // was never registered, so this only resolves because `platform()`
      // registered the descriptor's class when the config loaded - and that
      // brought `ExternalModule` along with it.
      const orchestrator = await resolve({ edge: external({ region: "eu" }) });

      const target = await orchestrator.resolveEnvironment("/project", "edge");

      expect(target.adapter).toBeInstanceOf(ExternalAdapter);
      expect(target.options).toEqual({ region: "eu" });
      expect(target.descriptor.adapter.id).toBe("external");
    });
  });
});

/**
 * An adapter that lives outside the framework: its own class, its own options
 * schema and its own module, named to the config by a factory.
 */
class ExternalAdapter extends PlatformAdapter<{ region: string }> {
  static readonly id = "external";
  static readonly options = z.object({ region: z.text() });

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

const ExternalModule = $module({
  name: "test.platform.external",
  services: [ExternalAdapter],
});

const external = (options: { region: string }): EnvironmentDescriptor => {
  // Referenced so the module's back-reference is set before the class is
  // registered, exactly as importing a real adapter package would.
  void ExternalModule;
  return { adapter: ExternalAdapter, options };
};
