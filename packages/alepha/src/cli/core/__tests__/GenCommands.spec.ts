import { Alepha } from "alepha";
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

  public async loadAlephaFromServerEntryFile(): Promise<Alepha> {
    if (this.loadError) {
      throw this.loadError;
    }
    if (!this.userAlepha) {
      throw new Error("test did not provide a user container");
    }
    return this.userAlepha;
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
      utils,
    };
  };

  // The CLI only exits non-zero when the handler throws. Logging the failure
  // and returning reported success to CI while writing nothing at all.
  it("should fail when the app has no swagger provider", async () => {
    const { cli, openapi } = create();

    await expect(
      cli.run(openapi.command, { argv: "", root: "/app" }),
    ).rejects.toThrow(/\$swagger/);
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
