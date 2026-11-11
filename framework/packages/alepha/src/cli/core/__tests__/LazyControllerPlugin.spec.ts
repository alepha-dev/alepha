import { createRequire } from "node:module";

import type { AppSurface } from "alepha";
import { describe, it } from "vitest";

import { LazyControllerPlugin } from "../services/LazyControllerPlugin.ts";

const { parseAst } = createRequire(import.meta.url)("vite") as {
  parseAst: (code: string) => any;
};

const surface = (
  classes: Array<[string, boolean]>,
  extra: Partial<AppSurface> = {},
): AppSurface => ({
  version: 1,
  classes: classes.map(([key, pure]) => ({ key, pure })),
  actions: [],
  routes: [],
  pages: [],
  jobs: [],
  tools: [],
  resources: [],
  prompts: [],
  ...extra,
});

const run = (code: string, list: AppSurface) => {
  const plugin = new LazyControllerPlugin() as any;
  const plan = plugin.plan(parseAst(code), plugin.lazyable(list));
  return { plan, code: plan.length ? plugin.rewrite(code, plan) : code };
};

/**
 * A module file's static import of a pure controller becomes a lazy
 * declaration (#Q3407), only when the binding is used nowhere but in the
 * module's `services` or an `alepha.with`.
 */
describe("LazyControllerPlugin", () => {
  it("rewrites a pure controller listed in services, keeping the other imports", ({
    expect,
  }) => {
    const code = [
      'import { QuestApi, helper } from "./controllers/QuestApi.ts";',
      'import { $module } from "alepha";',
      'export const M = $module({ name: "acme.api", services: [QuestApi] });',
      "helper();",
    ].join("\n");
    const out = run(code, surface([["acme.api:QuestApi", true]]));

    expect(out.plan.map((it: any) => it.key)).toEqual(["acme.api:QuestApi"]);
    expect(out.code).toContain(
      'const QuestApi = __alephaLazyService("QuestApi", () => import("./controllers/QuestApi.ts").then((m) => m.QuestApi));',
    );
    expect(out.code).toContain(
      'import { helper } from "./controllers/QuestApi.ts";',
    );
    expect(out.code).not.toMatch(/import \{[^}]*QuestApi[^}]*\} from/);
  });

  it("rewrites a pure controller passed to alepha.with, keyed by its name", ({
    expect,
  }) => {
    const code = [
      'import { Api } from "./Api.ts";',
      'export const M = $module({ name: "acme.web", register(a) { a.with(Api); } });',
    ].join("\n");
    expect(run(code, surface([["Api", true]])).plan).toHaveLength(1);
  });

  it("leaves a binding used anywhere else, a class not pure, and a page or MCP class alone", ({
    expect,
  }) => {
    const elsewhere = [
      'import { QuestApi } from "./QuestApi.ts";',
      'export const M = $module({ name: "acme.api", services: [QuestApi] });',
      "export { QuestApi };",
    ].join("\n");
    expect(run(elsewhere, surface([["acme.api:QuestApi", true]])).plan).toEqual(
      [],
    );

    const listed = [
      'import { QuestApi } from "./QuestApi.ts";',
      'export const M = $module({ name: "acme.api", services: [QuestApi] });',
    ].join("\n");
    expect(run(listed, surface([["acme.api:QuestApi", false]])).plan).toEqual(
      [],
    );
    expect(
      run(
        listed,
        surface([["acme.api:QuestApi", true]], {
          tools: [{ name: "quest_list", class: "acme.api:QuestApi" }],
        }),
      ).plan,
    ).toEqual([]);
  });
});
