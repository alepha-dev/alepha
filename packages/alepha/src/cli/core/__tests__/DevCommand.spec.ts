import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { DevCommand } from "../commands/dev.ts";

class TestDevCommand extends DevCommand {
  public testSelectApps = this.selectApps.bind(this);
}

describe("DevCommand", () => {
  const create = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return alepha.inject(TestDevCommand);
  };

  const apps = [
    { name: "web", path: "/apps/web" },
    { name: "api", path: "/apps/api" },
    { name: "admin", path: "/apps/admin" },
  ];

  describe("selectApps", () => {
    it("should number ports from the full list", () => {
      const dev = create();

      expect(dev.testSelectApps(apps).map((a) => [a.name, a.port])).toEqual([
        ["web", 5173],
        ["api", 5174],
        ["admin", 5175],
      ]);
    });

    it("should keep an app's port when siblings are filtered out", () => {
      // Ports were numbered over the FILTERED list, so `--only api` moved api
      // from 5174 to 5173 — breaking OAuth redirect URIs and client configs
      // pinned to its usual port.
      const dev = create();

      expect(dev.testSelectApps(apps, "api")).toEqual([
        { name: "api", path: "/apps/api", port: 5174 },
      ]);
    });

    it("should accept a comma-separated filter", () => {
      const dev = create();

      expect(dev.testSelectApps(apps, "web, admin").map((a) => a.port)).toEqual(
        [5173, 5175],
      );
    });

    it("should return nothing when the filter matches no app", () => {
      const dev = create();

      expect(dev.testSelectApps(apps, "nope")).toEqual([]);
    });
  });
});
