import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * `Intl.PluralRules` on real workerd (#Q3330). A runtime with reduced locale
 * data would select English rules for every language without an error, so
 * the Polish and Arabic categories are asserted where a Worker runs them.
 */
describe("$dictionary plurals on workerd", () => {
  it("selects the pl and ar categories", async ({ expect }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-plurals-workerd-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/plurals-workerd-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { $inject, Alepha, run } from "alepha";
import { $route } from "alepha/server";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
const names = (lang) => ({
 zero: lang + "-zero", one: lang + "-one", two: lang + "-two",
 few: lang + "-few", many: lang + "-many", other: lang + "-other",
});
class App {
 i18n = $inject(I18nProvider);
 alepha = $inject(Alepha);
 en = $dictionary({ lazy: async () => ({ default: { files: names("en") } }) });
 pl = $dictionary({ lazy: async () => ({ default: { files: names("pl") } }) });
 ar = $dictionary({ lazy: async () => ({ default: { files: names("ar") } }) });
 probe = $route({
  path: "/probe",
  handler: () => {
   const out = {};
   for (const lang of ["pl", "ar"]) {
    this.alepha.store.set("alepha.react.i18n.lang", lang);
    out[lang] = [0, 1, 2, 5, 22, 1.5].map((count) => this.i18n.tr("files", { count }));
   }
   return JSON.stringify(out);
  },
 });
}
const app = run(Alepha.create().with(AlephaReactI18n).with(App));
export default { async fetch(request) {
 await app.start();
 const ctx = { req: request };
 await app.events.emit("web:request:before", ctx);
 return ctx.res ?? new Response("no response", { status: 500 });
} };
`,
    );
    let runtime: Miniflare | undefined;
    try {
      await build({
        configFile: false,
        publicDir: false,
        logLevel: "silent",
        ssr: {
          noExternal: true,
          resolve: { conditions: ["workerd", "module"] },
        },
        build: {
          ssr: entry,
          outDir: dir,
          emptyOutDir: false,
          minify: false,
          rolldownOptions: {
            external: [/^cloudflare:/, /^node:/],
            output: {
              entryFileNames: "worker.js",
              codeSplitting: false,
              format: "esm",
            },
          },
        },
      });
      const script = await readFile(join(dir, "worker.js"), "utf8");
      runtime = new Miniflare({
        port: 0,
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: "plurals-fixture",
              // The build's own date and flags.
              compatibilityDate: "2026-11-03",
              compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const response = await runtime.dispatchFetch("http://plurals.test/probe");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        pl: ["pl-many", "pl-one", "pl-few", "pl-many", "pl-few", "pl-other"],
        ar: ["ar-zero", "ar-one", "ar-two", "ar-few", "ar-many", "ar-other"],
      });
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
