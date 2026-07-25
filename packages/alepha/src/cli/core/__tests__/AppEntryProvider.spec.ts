import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { appEntryOptions } from "../atoms/appEntryOptions.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";

describe("AppEntryProvider", () => {
  const create = (options?: { server?: string }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });

    if (options) {
      alepha.store.mut(appEntryOptions, (old) => ({ ...old, ...options }));
    }

    return {
      provider: alepha.inject(AppEntryProvider),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  it("should not fail with a raw ENOENT when src/ is absent", async () => {
    // A project that configures its entry explicitly has no reason to own a
    // `src/`, but the conventional-locations scan ran unconditionally and
    // `ls` is a raw readdir — the CLI died on an errno naming nothing.
    const { provider, fs } = create({ server: "app/server.ts" });
    await fs.writeFile("/project/app/server.ts", "export {};");

    const entry = await provider.getAppEntry("/project");

    expect(entry.server).toBe("app/server.ts");
  });

  it("should still report a helpful error when no entry can be found", async () => {
    const { provider } = create();

    await expect(provider.getAppEntry("/empty")).rejects.toThrow(/entry/i);
  });
});
