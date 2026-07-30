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
      const chunk =
        'import{Readable as a}from"node:stream";import{createRequire as io}from`node:module`;' +
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
});
