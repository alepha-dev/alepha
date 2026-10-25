import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { WranglerApi } from "../services/WranglerApi.ts";

describe("WranglerApi", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      shell: alepha.inject(MemoryShellProvider),
      wrangler: alepha.inject(WranglerApi),
    };
  };

  describe("ensureInstalled", () => {
    it("installs wrangler as a development install, whatever mode the CLI runs in", async () => {
      const { fs, shell, wrangler } = createTestEnv();
      await fs.writeFile("/app/package.json", JSON.stringify({ name: "app" }));
      await fs.writeFile("/app/package-lock.json", "{}");

      await wrangler.ensureInstalled("/app");

      // `alepha deploy` sets NODE_ENV=production first. Inherited, it made
      // `npm install --save-dev wrangler` install nothing and remove every
      // devDependency (#Q2610).
      const [install] = shell.getCallsMatching(/wrangler/);
      expect(install.command).toBe("npm install --save-dev wrangler");
      expect(install.options.env).toEqual({ NODE_ENV: "development" });
      expect(install.options.root).toBe("/app");
    });

    it("installs nothing when the project already depends on wrangler", async () => {
      const { fs, shell, wrangler } = createTestEnv();
      await fs.writeFile(
        "/app/package.json",
        JSON.stringify({ devDependencies: { wrangler: "^4.0.0" } }),
      );

      await wrangler.ensureInstalled("/app");

      expect(shell.calls).toHaveLength(0);
    });
  });
});
