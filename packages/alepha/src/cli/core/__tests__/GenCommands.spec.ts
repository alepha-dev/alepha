import { $env, $module, Alepha, z } from "alepha";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { GenEnvCommand } from "../commands/gen/env.ts";
import { OpenApiCommand } from "../commands/gen/openapi.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

/**
 * Stands in for the Vite-backed loader so the commands can be driven without
 * a real project on disk. `userAlepha` plays the part of the app's container,
 * which in production comes from a *different* module graph than the CLI.
 */
class FakeCliUtils extends AlephaCliUtils {
  public userAlepha?: Alepha;
  public loadError?: Error;
  /**
   * Stands in for the app-graph import. In production this comes back through
   * Vite's SSR graph so the module's classes are the app's, not the CLI's.
   */
  public appGraphModules: Record<string, any> = {};

  public async loadAlephaFromServerEntryFile(): Promise<Alepha> {
    if (this.loadError) {
      throw this.loadError;
    }
    if (!this.userAlepha) {
      throw new Error("test did not provide a user container");
    }
    return this.userAlepha;
  }

  public async importFromAppGraph(specifier: string): Promise<any> {
    const mod = this.appGraphModules[specifier];
    if (!mod) {
      throw new Error(`test did not stub '${specifier}'`);
    }
    return mod;
  }
}

describe("gen commands", () => {
  const create = () => {
    // Built outside the CLI container on purpose: in production the app's
    // container comes from Vite's SSR module graph, so its classes are not
    // the same objects the CLI imported.
    const userAlepha = Alepha.create();

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: AlephaCliUtils, use: FakeCliUtils });

    const utils = alepha.inject(FakeCliUtils);
    utils.userAlepha = userAlepha;

    return {
      cli: alepha.inject(CliProvider),
      openapi: alepha.inject(OpenApiCommand),
      env: alepha.inject(GenEnvCommand),
      fs: alepha.inject(MemoryFileSystemProvider),
      utils,
    };
  };

  /**
   * Generating a spec used to require the app to also mount a runtime `/docs`
   * UI — it failed with "Missing $swagger() primitive" otherwise. The document
   * is derived purely from the `$action` primitives already in the container,
   * so the module is registered on demand instead.
   */
  it("should register the swagger module when the app mounts none", async () => {
    const { cli, openapi, utils, fs } = create();

    class ServerSwaggerProvider {
      public json = undefined;
      public generateSwaggerDoc() {
        return { openapi: "3.0.0", paths: { "/api/hello": {} } };
      }
    }

    // The real module's `register` is what puts the provider in the container;
    // registering the class directly models that.
    utils.appGraphModules["alepha/server/swagger"] = {
      AlephaServerSwagger: ServerSwaggerProvider,
    };

    await cli.run(openapi.command, {
      argv: "--out openapi.json",
      root: "/app",
    });

    expect(fs.wasWrittenMatching("/app/openapi.json", /\/api\/hello/)).toBe(
      true,
    );
  });

  // The CLI only exits non-zero when the handler throws. Logging the failure
  // and returning reported success to CI while writing nothing at all.
  it("should fail when the swagger module cannot be loaded", async () => {
    const { cli, openapi } = create();

    await expect(
      cli.run(openapi.command, { argv: "", root: "/app" }),
    ).rejects.toThrow(/alepha\/server\/swagger/);
  });

  it("should fail when openapi generation throws", async () => {
    const { cli, openapi, utils } = create();

    // Fails INSIDE the try block, which is where the swallowing happened.
    class ServerSwaggerProvider {
      public json = undefined;
      public generateSwaggerDoc(): never {
        throw new Error("schema is broken");
      }
    }
    utils.userAlepha!.with(ServerSwaggerProvider);

    await expect(
      cli.run(openapi.command, { argv: "", root: "/app" }),
    ).rejects.toThrow(/schema is broken/);
  });

  // A generated `.env` template is the one place a human decides what to paste
  // where. Everything in it is a secret by default, so the useful annotation is
  // the exception: which of these is safe to commit. Labelling the secrets
  // instead would put the same line on nearly every key and say nothing.
  it("should annotate declassified env vars in the generated template", async () => {
    const { cli, env, utils, fs } = create();

    class Payments {
      env = $env(
        z.object({
          STRIPE_SECRET_KEY: z
            .text({ description: "Stripe API key" })
            .optional(),
          PUBLIC_URL: z.text({ secret: false }).optional(),
        }),
      );
    }

    utils.userAlepha!.with($module({ name: "payments", services: [Payments] }));

    await cli.run(env.command, { argv: "--out .env.example", root: "/app" });

    const written = await fs.readTextFile("/app/.env.example");

    expect(written).toContain("# (public)\n#PUBLIC_URL=");
    // The unannotated key is a secret and carries no label — it is the norm.
    expect(written).toContain("\n#STRIPE_SECRET_KEY=");
    expect(written).not.toContain("# (public)\n#STRIPE_SECRET_KEY=");
  });

  it("should fail when env extraction throws", async () => {
    const { cli, env, utils } = create();

    utils.userAlepha!.dump = () => {
      throw new Error("dump is broken");
    };

    await expect(
      cli.run(env.command, { argv: "", root: "/app" }),
    ).rejects.toThrow(/dump is broken/);
  });
});
