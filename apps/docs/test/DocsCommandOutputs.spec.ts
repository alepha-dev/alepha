import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DocsCommand } from "../scripts/gen-docs.ts";

describe("DocsCommand", () => {
  describe("outputs", () => {
    it("should list both page trees and the README of every public package", async () => {
      const root = await mkdtemp(join(tmpdir(), "docs-outputs-"));
      try {
        const pkg = async (dir: string, json: object) => {
          await mkdir(join(root, "packages", dir), { recursive: true });
          await writeFile(
            join(root, "packages", dir, "package.json"),
            JSON.stringify(json),
          );
        };
        await pkg("alepha", { name: "alepha" });
        await pkg("@alepha/ui", { name: "@alepha/ui" });
        // A private package's README is written by hand, and the generator
        // never touches it, so an unstaged edit there is not drift.
        await pkg("@alepha/discord", {
          name: "@alepha/discord",
          private: true,
        });

        const outputs = await Alepha.create().inject(DocsCommand).outputs(root);

        expect(outputs).toEqual([
          "docs/framework/2-reference",
          "docs/framework/3-packages",
          "packages/@alepha/ui/README.md",
          "packages/alepha/README.md",
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
