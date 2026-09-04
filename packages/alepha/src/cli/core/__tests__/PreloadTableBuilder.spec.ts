import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { PreloadTableBuilder } from "../services/PreloadTableBuilder.ts";

/**
 * A build where `Home.tsx` has a chunk of its own and `Folded.tsx` does not:
 * it is both lazily routed and statically imported, so rolldown merged it into
 * `chunk.shared.js` and Vite wrote no manifest entry under its source path.
 * Only the ssr manifest knows where it went.
 */
const clientManifest = {
  "index.html": { file: "entry.js", isEntry: true, css: ["style.css"] },
  "src/Home.tsx": {
    file: "chunk.home.js",
    imports: ["_chunk.shared.js", "index.html"],
    css: ["home.css"],
  },
  "_chunk.shared.js": { file: "chunk.shared.js", imports: ["_chunk.deep.js"] },
  "_chunk.deep.js": { file: "chunk.deep.js" },
  "src/Lonely.tsx": { file: "chunk.lonely.js" },
};

const ssrManifest = {
  "src/Home.tsx": ["/chunk.home.js", "/home.css"],
  "src/Folded.tsx": ["/chunk.shared.js"],
  "src/Lonely.tsx": ["/chunk.lonely.js"],
};

const builder = () => Alepha.create().inject(PreloadTableBuilder);

const hrefsOf = (table: { files: string[]; keys: Record<string, number[]> }) =>
  Object.fromEntries(
    Object.entries(table.keys).map(([key, indexes]) => [
      key,
      indexes.map((index) => table.files[index]).sort(),
    ]),
  );

describe("PreloadTableBuilder", () => {
  it("should resolve a key to the transitive closure of its imports", async ({
    expect,
  }) => {
    const table = builder().build({
      clientManifest,
      preloadManifest: { aaa: "src/Home.tsx" },
      ssrManifest,
      base: "",
    });

    expect(hrefsOf(table).aaa).toEqual([
      "/chunk.deep.js",
      "/chunk.home.js",
      "/chunk.shared.js",
      "/home.css",
    ]);
  });

  it("should resolve a module folded into a shared chunk to that chunk's closure", async ({
    expect,
  }) => {
    const table = builder().build({
      clientManifest,
      preloadManifest: { bbb: "src/Folded.tsx" },
      ssrManifest,
      base: "",
    });

    expect(hrefsOf(table).bbb).toEqual(["/chunk.deep.js", "/chunk.shared.js"]);
  });

  it("should fail the build naming a key that resolves to no chunks", async ({
    expect,
  }) => {
    expect(() =>
      builder().build({
        clientManifest,
        preloadManifest: { ccc: "src/Ghost.tsx" },
        ssrManifest,
        base: "",
      }),
    ).toThrow(/src\/Ghost\.tsx/);
  });

  it("should let a named key opt out of that failure", async ({ expect }) => {
    const table = builder().build({
      clientManifest,
      preloadManifest: { ccc: "src/Ghost.tsx" },
      ssrManifest,
      base: "",
      allowUnresolved: ["src/Ghost.tsx"],
    });

    expect(table.keys.ccc).toEqual([]);
  });

  it("should precompute the entry's own graph beside its script and styles", async ({
    expect,
  }) => {
    const table = builder().build({
      clientManifest: {
        "index.html": {
          file: "entry.js",
          isEntry: true,
          css: ["style.css"],
          imports: ["_chunk.shared.js"],
        },
        "_chunk.shared.js": { file: "chunk.shared.js" },
      },
      preloadManifest: {},
      ssrManifest: {},
      base: "",
    });

    const file = (index?: number) =>
      index === undefined ? undefined : table.files[index];

    expect(file(table.entry?.js)).toBe("/entry.js");
    expect(table.entry?.css.map(file)).toEqual(["/style.css"]);
    // The entry's own file and styles are emitted as a script and stylesheets,
    // so the graph is what is left to preload.
    expect(table.entry?.graph.map(file)).toEqual(["/chunk.shared.js"]);
  });

  it("should prefix every href with the configured base", async ({
    expect,
  }) => {
    const table = builder().build({
      clientManifest,
      preloadManifest: { aaa: "src/Lonely.tsx" },
      ssrManifest,
      base: "/devtools",
    });

    expect(hrefsOf(table).aaa).toEqual(["/devtools/chunk.lonely.js"]);
  });

  it("should not follow dynamic imports", async ({ expect }) => {
    const table = builder().build({
      clientManifest: {
        "src/Home.tsx": {
          file: "chunk.home.js",
          dynamicImports: ["src/Lonely.tsx"],
        },
        "src/Lonely.tsx": { file: "chunk.lonely.js" },
      },
      preloadManifest: { aaa: "src/Home.tsx" },
      ssrManifest: {},
      base: "",
    });

    expect(hrefsOf(table).aaa).toEqual(["/chunk.home.js"]);
  });
});
