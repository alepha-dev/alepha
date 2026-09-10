import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";

/**
 * Stands in for Vite: records the config the server build hands to `build()`
 * and stops there, since the config is all these specs read.
 */
class RecordingViteUtils extends ViteUtils {
  public configs: Array<{ plugins?: Array<{ name?: string }> }> = [];

  public async importVite(): Promise<any> {
    return {
      build: async (config: any) => {
        this.configs.push(config);
        throw new AlephaError("stop: the config is all this spec reads");
      },
      resolveConfig: async () => ({}),
    };
  }

  public async importViteReact(): Promise<any> {
    return undefined;
  }
}

class TestBuildServerTask extends BuildServerTask {
  public testBuildServer = this.buildServer.bind(this);
}

describe("BuildServerTask", () => {
  it("should keep the app's .client modules out of the server bundle", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: RecordingViteUtils });
    const task = alepha.inject(TestBuildServerTask);
    const vite = alepha.inject(RecordingViteUtils);

    await expect(
      task.testBuildServer({
        root: "/project",
        entry: "src/main.server.ts",
        distDir: "dist",
        alepha: Alepha.create(),
      }),
    ).rejects.toThrow(/stop/);

    const names = (vite.configs[0]?.plugins ?? []).map(
      (plugin) => plugin?.name,
    );
    expect(names).toContain("alepha-client-modules");
  });
});
