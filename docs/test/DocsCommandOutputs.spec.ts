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
          "docs/2-reference",
          "docs/3-packages",
          "packages/@alepha/ui/README.md",
          "packages/alepha/README.md",
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});

describe("DocsCommand option tables", () => {
  const docs = () => Alepha.create().inject(DocsCommand);

  it("should read a type written over several lines whole, without its members' comments", () => {
    const fields = docs().parseInterfaceFields(`
  /**
   * Foreign key constraints.
   */
  foreignKeys?: Array<{
    /**
     * Optional name (not a field: it sits in a comment).
     */
    name?: string;
    // columns: a line comment
    columns: Array<keyof Infer<T>>;
    foreignColumns: Array<() => EntityColumn<any>>;
  }>;

  /**
   * The table name.
   */
  name: string;
`);

    expect(fields).toEqual([
      {
        name: "foreignKeys",
        type: "Array<{ name?: string; columns: Array<keyof Infer<T>>; foreignColumns: Array<() => EntityColumn<any>> }>",
        required: false,
        description: "Foreign key constraints.",
      },
      {
        name: "name",
        type: "string",
        required: true,
        description: "The table name.",
      },
    ]);
  });

  it("should keep a long single-line type whole", () => {
    const type =
      'Service<CacheProvider> | "memory" | "redis" | "cloudflare-kv" | "something-longer-than-sixty"';
    const [field] = docs().parseInterfaceFields(`  provider?: ${type};\n`);

    expect(field.type).toBe(type);
  });

  it("should leave a type's angle brackets alone, and escape its pipes", () => {
    expect(docs().escapeTypeCell('Service<CacheProvider> | "memory"')).toBe(
      'Service<CacheProvider> \\| "memory"',
    );
  });

  it("should escape angle brackets in prose, outside code spans only", () => {
    expect(
      docs().escapeTableCell("Named `<domain>.<action>`, or <b>bold</b> | x"),
    ).toBe("Named `<domain>.<action>`, or &lt;b&gt;bold&lt;/b&gt; \\| x");
  });
});
