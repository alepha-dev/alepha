import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { describe, it } from "vitest";

import {
  type AlephaCliConfig,
  defineConfig,
} from "../../config/defineConfig.ts";
import { CompileCommand } from "../commands/compile.ts";
import {
  WorkspaceCompiler,
  type WorkspaceCompileOptions,
} from "../services/WorkspaceCompiler.ts";

class RecordingCompiler extends WorkspaceCompiler {
  public options?: WorkspaceCompileOptions;
  public override async compile(
    options: WorkspaceCompileOptions,
  ): Promise<string> {
    this.options = options;
    return `/project/dist/${options.name}`;
  }
}

describe("the public CLI config", () => {
  it("uses --output/-o and long --target on compile, refusing the retired flags", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: WorkspaceCompiler,
      use: RecordingCompiler,
    });
    const cli = alepha.inject(CliProvider);
    const command = alepha.inject(CompileCommand).compile;
    await cli.run(command, {
      root: "/project",
      argv: "--output demo --target bun-linux-x64",
    });
    expect(alepha.inject(RecordingCompiler).options).toMatchObject({
      name: "demo",
      target: "bun-linux-x64",
    });
    await cli.run(command, {
      root: "/project",
      argv: "-o other --target bun-linux-x64",
    });
    expect(alepha.inject(RecordingCompiler).options?.name).toBe("other");
    await expect(
      cli.run(command, { root: "/project", argv: "--out demo" }),
    ).rejects.toThrow();
    await expect(
      cli.run(command, { root: "/project", argv: "-t bun-linux-x64" }),
    ).rejects.toThrow();
  });
  it("registers plugins and excludes retired and internal keys from its type", ({
    expect,
  }) => {
    class Plugin {}
    const alepha = Alepha.create();
    defineConfig({ plugins: [Plugin] })(alepha);
    expect(alepha.has(Plugin)).toBe(true);
    const retired: AlephaCliConfig = {
      // @ts-expect-error services was replaced by plugins.
      services: [Plugin],
    };
    const internal: AlephaCliConfig = {
      build: {
        // @ts-expect-error runtimes is resolved internally; use runtime.
        runtimes: ["node"],
      },
    };
    expect(retired).toBeDefined();
    expect(internal).toBeDefined();
  });
});
