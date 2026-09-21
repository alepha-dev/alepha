import { $inject, Alepha } from "alepha";

import type {
  BuildRuntime,
  BuildRuntimeDeclaration,
} from "../atoms/buildOptions.ts";
import { STATIC_RUNTIME } from "../atoms/buildOptions.ts";

/**
 * Where one runtime's server slice lives inside `dist/`, and how the set of
 * them is resolved from what the build was asked for.
 *
 * ## Why this is a service and not four template literals
 *
 * A slice is named in seven places: the Vite `outDir`, the entry wrapper, the
 * wrapper's own import of its chunk, the manifest, `dist/package.json`'s
 * `main`, the wrangler module globs, and whatever `alepha compile` and
 * `alepha image` pick up. The layout moved once already, from a flat
 * `dist/index.js` + `dist/server/`, and the way that kind of move goes wrong is
 * not a compile error: it is six call sites updated and one left behind,
 * producing a build that succeeds and an artifact whose entry points at
 * nothing.
 *
 * ## ⚠️ Declared order is the decision
 *
 * The FIRST declared runtime is the primary. It is `manifest.runtime`, it is
 * what `dist/package.json` points at, and it is what a deployer spawns.
 * `["bun", "node"]` and `["node", "bun"]` produce the same two slices and
 * different behaviour, so nothing here may sort, dedupe-by-preference or
 * reorder the list — only drop a later repeat of a runtime already declared.
 */
export class BuildSlices {
  protected readonly alepha = $inject(Alepha);

  /**
   * The default set when nothing is declared.
   *
   * `node` alone, because it is the universal floor: the node slice runs under
   * Node and under Bun alike. `workerd` is mandatory only for Cloudflare and
   * `bun` is an optimization, so neither belongs in a default that every app
   * pays for.
   */
  protected readonly defaultRuntimes: BuildRuntime[] = ["node"];

  /**
   * Normalize whatever the config and the flag declared into an ordered list.
   *
   * Accepts a scalar (what `build.runtime` has always been), a list, or
   * nothing. A repeat is dropped rather than built twice, keeping the FIRST
   * occurrence so the primary cannot be moved by a duplicate further down.
   */
  resolve(declared: BuildRuntimeDeclaration | undefined): BuildRuntime[] {
    if (!declared) {
      return [...this.defaultRuntimes];
    }
    // ⚠️ A static app produces NO server slice, so the answer is the empty
    // list rather than a default. `static` is a declaration, never a slice,
    // and must never reach a `server/<runtime>/` path.
    if (this.isStatic(declared)) {
      return [];
    }
    const list = (Array.isArray(declared) ? declared : [declared]).filter(
      (runtime): runtime is BuildRuntime => runtime !== STATIC_RUNTIME,
    );
    const ordered: BuildRuntime[] = [];
    for (const runtime of list) {
      if (!ordered.includes(runtime)) {
        ordered.push(runtime);
      }
    }
    return ordered.length ? ordered : [...this.defaultRuntimes];
  }

  /**
   * Whether this declaration says the app has no server.
   *
   * ⚠️ `static` anywhere in the list means static, rather than being one entry
   * among several. There is no such thing as a half-static build: the static
   * task strips every server artifact out of `dist/`, so a slice declared
   * beside it would be built and then deleted. Saying so here is better than
   * producing an artifact whose manifest and contents disagree.
   */
  isStatic(declared: BuildRuntimeDeclaration | undefined): boolean {
    if (!declared) {
      return false;
    }
    const list = Array.isArray(declared) ? declared : [declared];
    return list.includes(STATIC_RUNTIME);
  }

  /**
   * The ordered slice set of a resolved build, from the options a task holds.
   *
   * `runtimes` is what `BuildCommand` resolved; `runtime` is the declaration it
   * resolved FROM, and is the fallback for a caller that built the options by
   * hand (a spec, a prebuilt path) and never went through the command.
   */
  fromOptions(options: {
    runtime?: BuildRuntimeDeclaration;
    runtimes?: BuildRuntime[];
  }): BuildRuntime[] {
    if (options.runtimes?.length) {
      return this.resolve(options.runtimes);
    }
    return this.resolve(options.runtime);
  }

  /**
   * Whether this resolved build produces no server at all.
   */
  isStaticBuild(options: {
    runtime?: BuildRuntimeDeclaration;
    runtimes?: BuildRuntime[];
  }): boolean {
    return this.isStatic(options.runtime);
  }

  /**
   * Parse a `--runtime node,workerd` flag value.
   *
   * Comma-separated so one flag carries the order, which a repeated flag could
   * not express as clearly. Empty segments are dropped so a trailing comma is
   * not an empty runtime name.
   */
  parseFlag(
    value: string | undefined,
  ): Array<BuildRuntime | "static"> | undefined {
    if (!value) {
      return undefined;
    }
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean) as Array<BuildRuntime | "static">;
    return parts.length ? parts : undefined;
  }

  /**
   * The primary: the first declared runtime, and nothing else.
   */
  primary(runtimes: BuildRuntime[]): BuildRuntime {
    return runtimes[0] ?? this.defaultRuntimes[0];
  }

  /**
   * The slice's entry wrapper, relative to `dist/` — e.g. `index.node.js`.
   *
   * ⚠️ There is deliberately no `index.js` that works out its own host. The
   * manifest is the discovery mechanism, and a second one able to disagree
   * with it is worse than none: workerd cannot dynamic-import a node bundle to
   * find out either way.
   */
  entryFileName(runtime: BuildRuntime): string {
    return `index.${runtime}.js`;
  }

  /**
   * The slice's chunk directory, relative to `dist/` — e.g. `server/node`.
   *
   * ⚠️ **Namespacing is load-bearing, not tidiness.** Two runtimes built into
   * one `server/` do not collide, because their content hashes differ, so both
   * sets simply sit there — and `wrangler.jsonc` ships with `no_bundle` and a
   * `server/*.js` glob that would then sweep the Node chunks into the Worker
   * upload. Best case a Worker twice the size it needs; likely case a Node
   * chunk importing a node builtin and a refused deploy.
   */
  serverDir(runtime: BuildRuntime): string {
    return `server/${runtime}`;
  }
}
