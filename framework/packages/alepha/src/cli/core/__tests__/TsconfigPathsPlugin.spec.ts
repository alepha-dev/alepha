import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { afterEach, describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";

/**
 * The `@/*` alias of every app comes from this plugin: a tsconfig it cannot
 * read leaves `alepha dev` and `alepha build` failing on the first `@/`
 * import, far from the file that caused it.
 */
describe("the tsconfig paths plugin", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * Run the plugin's `config` hook over a project holding `tsconfig`.
   */
  const aliasesOf = async (tsconfig: string) => {
    const root = await mkdtemp(join(tmpdir(), "alepha-tsconfig-paths-"));
    roots.push(root);
    await writeFile(join(root, "tsconfig.json"), tsconfig);

    const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    const plugin = alepha.inject(ViteUtils).createTsconfigPathsPlugin();
    const config = await (plugin.config as (config: object) => Promise<any>)({
      root,
    });

    return {
      root,
      alias: config?.resolve?.alias as Record<string, string> | undefined,
      warnings: alepha
        .inject(MemoryDestinationProvider)
        .logs.filter((log) => log.level === "WARN")
        .map((log) => log.message),
    };
  };

  it("turns compilerOptions.paths into aliases", async ({ expect }) => {
    const { root, alias } = await aliasesOf(
      '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    );

    expect(alias).toEqual({ "@/": `${join(root, "src")}/` });
  });

  it("reads a tsconfig whose strings hold //, such as a $schema URL", async ({
    expect,
  }) => {
    const { root, alias, warnings } = await aliasesOf(
      '{ "$schema": "https://json.schemastore.org/tsconfig", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    );

    expect(alias).toEqual({ "@/": `${join(root, "src")}/` });
    expect(warnings).toEqual([]);
  });

  it("reads a tsconfig with comments", async ({ expect }) => {
    const { root, alias } = await aliasesOf(
      '{\n  // the app\n  "compilerOptions": { /* aliases */ "paths": { "@/*": ["./src/*"] } }\n}',
    );

    expect(alias).toEqual({ "@/": `${join(root, "src")}/` });
  });

  it("says which tsconfig it could not parse instead of dropping the aliases in silence", async ({
    expect,
  }) => {
    const { root, alias, warnings } = await aliasesOf(
      '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], } } }',
    );

    expect(alias).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(join(root, "tsconfig.json"));
  });

  it("says nothing for a project with no tsconfig", async ({ expect }) => {
    const root = await mkdtemp(join(tmpdir(), "alepha-tsconfig-paths-"));
    roots.push(root);
    const alepha = Alepha.create({ env: { LOG_LEVEL: "warn" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    const plugin = alepha.inject(ViteUtils).createTsconfigPathsPlugin();

    expect(
      await (plugin.config as (config: object) => Promise<any>)({ root }),
    ).toBeUndefined();
    expect(alepha.inject(MemoryDestinationProvider).logs).toEqual([]);
  });
});
