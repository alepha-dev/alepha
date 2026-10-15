import { Alepha, AlephaError, z } from "alepha";
import { describe, it } from "vitest";

import { defineConfig } from "../../config/defineConfig.ts";
import { StrictConfigSchema } from "../../config/StrictConfigSchema.ts";
import { buildOptions } from "../atoms/buildOptions.ts";
import { AlephaCliExtensionProvider } from "../providers/AlephaCliExtensionProvider.ts";

class TestExtensionProvider extends AlephaCliExtensionProvider {
  public apply = (value: unknown) =>
    this.applyExtension(value, "alepha.config.ts");
}

describe("CLI config validation", () => {
  for (const [input, path] of [
    [{ typo: true }, "typo"],
    [{ build: { output: { dockr: true } } }, "build.output.dockr"],
    [{ image: { labels: { src: "url" } } }, "image.labels.src"],
    [{ desktop: { window: { widht: 800 } } }, "desktop.window.widht"],
  ] as const) {
    it(`refuses an unknown key before applying config: ${path}`, ({
      expect,
    }) => {
      expect(() => defineConfig(input as never)).toThrow(AlephaError);
      expect(() => defineConfig(input as never)).toThrow(path);
    });
  }

  for (const [input, path, replacement] of [
    [{ build: { docker: {} } }, "build.docker", "top-level image"],
    [{ build: { target: "node" } }, "build.target", "alepha build --runtime"],
    [{ image: { image: { tag: "app" } } }, "image.image", "flat image"],
    [{ services: [] }, "services", "plugins"],
    [{ build: { runtimes: ["node"] } }, "build.runtimes", "build.runtime"],
  ] as const) {
    it(`names the replacement for retired ${path}`, ({ expect }) => {
      expect(() => defineConfig(input as never)).toThrow(
        `${path} was removed; use ${replacement}`,
      );
    });
  }

  it("accepts current config, service factories, and open Cloudflare config", ({
    expect,
  }) => {
    class Plugin {}
    const configure = defineConfig({
      plugins: [Plugin, () => new Plugin()],
      build: {
        runtime: ["node", "workerd"],
        output: { dist: "release" },
        cloudflare: { config: { assets: { not_found_handling: "404-page" } } },
      },
      image: {
        tag: "app",
        args: ["--build-arg", "TITLE=My app"],
        labels: { title: "App" },
      },
    });
    expect(typeof configure).toBe("function");
    const alepha = Alepha.create();
    defineConfig({ build: { output: { dist: "release" } } })(alepha);
    expect(alepha.get(buildOptions).output?.dist).toBe("release");
    // Programmatic atom use keeps its existing unknown-key stripping.
    expect(buildOptions.schema.safeParse({ unknown: true }).success).toBe(true);
  });

  it("preserves validation through arrays, unions, optional fields and defaults", ({
    expect,
  }) => {
    const schema = StrictConfigSchema.from(
      z.object({
        entries: z
          .array(
            z.union([
              z.object({ name: z.string().default("entry") }),
              z.string(),
            ]),
          )
          .optional(),
      }),
    );
    expect(schema.parse({ entries: [{}] })).toEqual({
      entries: [{ name: "entry" }],
    });
    expect(schema.safeParse({ entries: [{ unknown: true }] }).success).toBe(
      false,
    );
  });

  it("refuses a non-function default export and names defineConfig", ({
    expect,
  }) => {
    const provider = Alepha.create().inject(TestExtensionProvider);
    expect(() => provider.apply({ build: {} })).toThrow("defineConfig");
    expect(() => provider.apply(undefined)).toThrow(AlephaError);
    expect(() => provider.apply(() => ({}))).not.toThrow();
  });
});
