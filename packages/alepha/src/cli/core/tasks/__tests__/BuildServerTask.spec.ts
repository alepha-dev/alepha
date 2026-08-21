import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { BuildServerTask } from "../BuildServerTask.ts";

/**
 * Test subclass exposing the protected {@link BuildServerTask.durableObjectReexport}
 * helper so the Durable Object re-export line can be unit-tested in isolation.
 */
class TestServerTask extends BuildServerTask {
  public testExportLine = (entryFile: string) =>
    this.durableObjectReexport(entryFile);

  public testUsesWebSocket = (alepha: unknown) =>
    this.usesWebSocket(alepha as any);

  public testNeutralize = (code: string) =>
    this.neutralizeWorkerdCreateRequire(code);

  public testStubImportMetaUrl = (code: string, fileName: string) =>
    this.stubWorkerdImportMetaUrl(code, fileName);

  public testExtractEntry = (root: string, entry: string, result: any) =>
    this.extractEntryFromBundle(root, entry, result);
}

/**
 * Minimal fake of the workspace's live Alepha — only `primitives` is probed
 * by {@link BuildServerTask.usesWebSocket}.
 */
const fakeAlephaWithPrimitives = (names: string[]) =>
  ({
    primitives: (name: string) => (names.includes(name) ? [{}] : []),
  }) as any;

describe("BuildServerTask DO re-export", () => {
  it("re-exports the DO class from the hashed bundle when workerd + websocket", ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const task = alepha.inject(TestServerTask) as any;
    task.exportDurableObject = true;
    expect(task.testExportLine("abc123.js")).toBe(
      'export { AlephaWebSocketDurableObject } from "./server/abc123.js";\n',
    );
  });

  it("emits nothing when not a workerd websocket build", ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const task = alepha.inject(TestServerTask) as any;
    task.exportDurableObject = false;
    expect(task.testExportLine("abc123.js")).toBe("");
  });

  /**
   * The DO gate must fire for `$room`-only apps too: a rooms-only realtime
   * layer still runs inside `AlephaWebSocketDurableObject`, and without the
   * re-export in `dist/index.js` wrangler cannot resolve the migration's
   * `class_name` at deploy time.
   */
  describe("usesWebSocket", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    it("is true for a $websocket app", ({ expect }) => {
      expect(
        createTask().testUsesWebSocket(
          fakeAlephaWithPrimitives(["$websocket"]),
        ),
      ).toBe(true);
    });

    it("is true for a $room-only app", ({ expect }) => {
      expect(
        createTask().testUsesWebSocket(fakeAlephaWithPrimitives(["$room"])),
      ).toBe(true);
    });

    it("is false when neither primitive is registered", ({ expect }) => {
      expect(createTask().testUsesWebSocket(fakeAlephaWithPrimitives([]))).toBe(
        false,
      );
    });
  });

  /**
   * Workerd chunks must not call `createRequire(import.meta.url)` eagerly:
   * `import.meta.url` is `undefined` during Cloudflare's deploy-time script
   * validation, so the rolldown CJS-interop banner (`var r =
   * createRequire(import.meta.url)`, often with zero call sites) makes the
   * whole upload fail with validation error 10021.
   */
  describe("neutralizeWorkerdCreateRequire", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    it("rewrites the aliased minified interop banner", ({ expect }) => {
      const chunk =
        'import{createRequire as i}from"node:module";var S=i(import.meta.url),x=1;';
      const out = createTask().testNeutralize(chunk);
      expect(out).not.toContain("i(import.meta.url)");
      expect(out).toContain('import{createRequire as i}from"node:module"');
      // The rewritten binding is a require that throws only when CALLED.
      const factory = out.slice(out.indexOf("var S=") + "var S=".length);
      const S = new Function(
        `return ${factory.slice(0, factory.lastIndexOf(",x=1;"))}`,
      )();
      expect(() => S("drizzle-kit")).toThrowError(/unavailable on workerd/);
      expect(() => S.resolve("drizzle-kit")).toThrowError(
        /unavailable on workerd/,
      );
    });

    it("rewrites a lazy inline createRequire(import.meta.url)(pkg) call", ({
      expect,
    }) => {
      // Single-quoted rather than the backticks this test used before: a
      // module source must be a string literal, so `from \`node:module\`` is
      // a SyntaxError and could never appear in real bundler output. Only the
      // old regex's over-permissive quote class ever accepted it.
      const chunk =
        "import{Readable as a}from\"node:stream\";import{createRequire as io}from'node:module';" +
        "function load(t){try{return io(import.meta.url)(t)}catch{return null}}";
      const out = createTask().testNeutralize(chunk);
      expect(out).not.toContain("io(import.meta.url)");
      // The try/catch shape still works: calling the factory's require throws.
      expect(out).toMatch(/return \(\(\)=>\{const r=/);
    });

    it("leaves chunks without a node:module createRequire import untouched", ({
      expect,
    }) => {
      const chunk =
        'import{createRequire}from"./my-own-module.js";var r=createRequire(import.meta.url);';
      expect(createTask().testNeutralize(chunk)).toBe(chunk);
    });

    it("does not rewrite other members imported from node:module", ({
      expect,
    }) => {
      const chunk =
        'import{builtinModules as b,createRequire as c}from"node:module";var m=b.length,r=c(import.meta.url);';
      const out = createTask().testNeutralize(chunk);
      expect(out).toContain("var m=b.length");
      expect(out).not.toContain("c(import.meta.url)");
    });
  });

  /**
   * Vite's SSR build leaves the standard asset idiom
   * `new URL("./rel.png", import.meta.url)` untouched (it is valid on Node),
   * but on Cloudflare `import.meta.url` is `undefined` during deploy-time
   * script validation, so any module-scope occurrence throws
   * `Uncaught TypeError: Invalid URL string.` (validation error 10021) before
   * the worker ever runs — e.g. a browser-only sprite module statically
   * reachable from a `$page` tree. The workerd plugin therefore stubs every
   * remaining `import.meta.url` with the chunk's own stable `file:///` URL.
   */
  describe("stubWorkerdImportMetaUrl", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    it("makes a module-scope new URL(rel, import.meta.url) construct a valid URL", ({
      expect,
    }) => {
      const chunk =
        'var s=new URL("../../assets/Shadow.png",import.meta.url).href;';
      const out = createTask().testStubImportMetaUrl(chunk, "BrcTAm3C.js");
      expect(out).not.toContain("import.meta.url");
      // Evaluating the rewritten chunk must not throw and must yield a URL.
      const href = new Function(`${out}return s;`)();
      expect(href).toBe("file:///assets/Shadow.png");
    });

    it("stubs every occurrence, not just the first", ({ expect }) => {
      const chunk =
        "var a=import.meta.url,b=import.meta.url;var c=[a,b].join();";
      const out = createTask().testStubImportMetaUrl(chunk, "x.js");
      expect(out).not.toContain("import.meta.url");
      expect(out).toContain('"file:///server/x.js"');
    });

    it("leaves longer member names untouched", ({ expect }) => {
      const chunk = "var a=import.meta.urlish;";
      expect(createTask().testStubImportMetaUrl(chunk, "x.js")).toBe(chunk);
    });

    it("composes with the createRequire neutralization: banner first, stub second", ({
      expect,
    }) => {
      const chunk =
        'import{createRequire as i}from"node:module";var S=i(import.meta.url);' +
        'var s=new URL("./a.png",import.meta.url).href;';
      const task = createTask();
      const out = task.testStubImportMetaUrl(
        task.testNeutralize(chunk),
        "y.js",
      );
      expect(out).not.toContain("import.meta.url");
      // The banner stayed an inert factory (throws only when CALLED)...
      expect(out).toMatch(/var S=\(\(\)=>\{const r=/);
      // ...and the asset URL is a plain valid string construction.
      expect(out).toContain('new URL("./a.png","file:///server/y.js")');
    });
  });

  /**
   * Both workerd rewrites match on the `import.meta.url` token, and that token
   * is also perfectly ordinary *data*: `apps/docs` generates its changelog from
   * git history, and the commit that added the stub is literally titled "stub
   * import.meta.url in workerd server chunks…". A textual rewrite terminates
   * that string early, the chunk stops parsing, rolldown drops it, and the
   * build still exits 0 — the app entry silently ships as a 37-byte file with
   * nothing but a sourcemap comment, so `run()` never executes and Cloudflare
   * refuses the upload with `ReferenceError: __alepha is not defined`.
   *
   * The rewrites must therefore act on real `import.meta` meta-property nodes
   * only, never on text that merely looks like one.
   */
  describe("workerd rewrites only touch real syntax, never string data", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    it("leaves an import.meta.url mention inside a string literal alone", ({
      expect,
    }) => {
      const chunk =
        'var log=[{"message":"stub import.meta.url in workerd server chunks"}];';
      expect(createTask().testStubImportMetaUrl(chunk, "x.js")).toBe(chunk);
    });

    it("leaves an import.meta.url mention inside a template literal alone", ({
      expect,
    }) => {
      const chunk = "var t=`we stub import.meta.url on workerd`;";
      expect(createTask().testStubImportMetaUrl(chunk, "x.js")).toBe(chunk);
    });

    it("stubs the real occurrence while preserving the quoted one", ({
      expect,
    }) => {
      const chunk =
        'var m="stub import.meta.url in chunks",u=new URL("./a.png",import.meta.url).href;';
      const out = createTask().testStubImportMetaUrl(chunk, "y.js");
      expect(out).toContain('var m="stub import.meta.url in chunks"');
      expect(out).toContain('new URL("./a.png","file:///server/y.js")');
      // The whole point: the rewritten chunk is still valid JavaScript.
      expect(() => new Function(out)).not.toThrow();
    });

    it("leaves a quoted createRequire(import.meta.url) call alone", ({
      expect,
    }) => {
      // The unaliased import is the dangerous shape: the local name is
      // `createRequire`, so the quoted call below matches the rewrite pattern
      // exactly. This very string is in `apps/docs`' generated changelog.
      const chunk =
        'import{createRequire}from"node:module";' +
        'var note="neutralize createRequire(import.meta.url) banners";';
      const out = createTask().testNeutralize(chunk);
      expect(out).toBe(chunk);
    });
  });

  /**
   * The backstop for the whole class of failure above, whatever future cause
   * produces it: when a `renderChunk` rewrite corrupts the entry chunk,
   * rolldown does not fail the build — it emits an empty file and exits 0. The
   * app then ships with no `run()` call at all, and the first sign of trouble
   * is Cloudflare rejecting the upload. An entry chunk with no top-level
   * statements is never legitimate, so the build must refuse it.
   */
  describe("empty entry chunk guard", () => {
    const createTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return alepha.inject(TestServerTask);
    };

    const bundle = (code: string) => ({
      output: [
        { facadeModuleId: "/repo/src/main.ts", fileName: "abc123.js", code },
      ],
    });

    it("refuses an entry chunk holding nothing but a sourcemap comment", ({
      expect,
    }) => {
      expect(() =>
        createTask().testExtractEntry(
          "/repo",
          "src/main.ts",
          bundle("//# sourceMappingURL=abc123.js.map"),
        ),
      ).toThrow(/empty/i);
    });

    it("accepts an entry chunk that only re-exports another chunk", ({
      expect,
    }) => {
      expect(
        createTask().testExtractEntry(
          "/repo",
          "src/main.ts",
          bundle('import"./other.js";'),
        ),
      ).toBe("abc123.js");
    });
  });
});
