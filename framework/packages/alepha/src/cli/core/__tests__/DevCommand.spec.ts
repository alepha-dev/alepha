import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { DevCommand } from "../commands/dev.ts";

class TestDevCommand extends DevCommand {
  public testSelectApps = this.selectApps.bind(this);
  public testSpawnArgs = this.spawnArgs.bind(this);
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

  describe("spawnArgs", () => {
    it("should forward --mode to each spawned app", () => {
      // The parent loads the workspace `.env.staging` and the children
      // inherit its process.env, but each app's OWN `.env.staging` was never
      // read: the child ran a bare `alepha dev`.
      const dev = create();

      expect(dev.testSpawnArgs("yarn", "staging")).toEqual([
        "alepha",
        "dev",
        "--mode",
        "staging",
      ]);
    });

    it("should omit --mode when there is none", () => {
      const dev = create();

      expect(dev.testSpawnArgs("yarn")).toEqual(["alepha", "dev"]);
    });

    it("should put npm's arguments behind --", () => {
      // `npm run alepha dev --mode staging` never reaches the child: npm
      // reads a flag after the script name as one of its own configs.
      const dev = create();

      expect(dev.testSpawnArgs("npm", "staging")).toEqual([
        "run",
        "alepha",
        "--",
        "dev",
        "--mode",
        "staging",
      ]);
    });
  });

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
