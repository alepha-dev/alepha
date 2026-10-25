import { AlephaError } from "alepha";

// -----------------------------------------------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------------------------------------------

/**
 * One entry of Vite's client manifest, reduced to the fields preloading reads.
 */
export interface PreloadClientManifestEntry {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

/**
 * The precomputed answer to every question the SSR runtime used to ask of the
 * client manifest.
 *
 * `files` is the deduplicated href list, base already applied; everything else
 * indexes into it. Nothing here depends on the request, which is what made a
 * per-request graph walk over a 106 KB manifest embedded in the server bundle
 * the wrong shape: the head fragment of a route is a build-time constant.
 */
export interface PreloadTable {
  files: string[];

  /**
   * Preload key to its module's full static closure.
   */
  keys: Record<string, number[]>;

  /**
   * The entry point: its script, its stylesheets, and the rest of its own
   * static closure. `graph` excludes `js` and `css`, which are emitted as a
   * script tag and stylesheet links rather than preloaded.
   */
  entry?: {
    js?: number;
    css: number[];
    graph: number[];
  };
}

/**
 * What the builder needs, which is exactly what `vite build` leaves behind.
 */
export interface PreloadTableInput {
  clientManifest: Record<string, PreloadClientManifestEntry>;

  /**
   * Preload key to source path, from the `alepha-preload` plugin.
   */
  preloadManifest: Record<string, string>;

  /**
   * Module id to the asset urls it needs, from `build.ssrManifest`. This is
   * the index the runtime never had: the client manifest is keyed by CHUNK, so
   * a module folded into a shared chunk has no entry there at all.
   */
  ssrManifest: Record<string, string[]>;

  /**
   * Asset base path, without a trailing slash. `""` for the default `/`.
   */
  base: string;

  /**
   * Source paths allowed to resolve to no chunks, instead of failing the
   * build. The escape hatch for a fold that is deliberate.
   */
  allowUnresolved?: string[];
}

// -----------------------------------------------------------------------------------------------------------------
// PreloadTableBuilder
// -----------------------------------------------------------------------------------------------------------------

/**
 * Resolves every SSR preload key to its chunk closure, once, at build time.
 *
 * This runs in the one place that holds both manifests, which is also the only
 * place that can fail: a key resolving to no chunks means a route ships no
 * preloads at all, and doing that silently is the failure mode the whole
 * preload pipeline was rebuilt to end.
 */
export class PreloadTableBuilder {
  public build(input: PreloadTableInput): PreloadTable {
    const files: string[] = [];
    const indexOf = new Map<string, number>();
    const intern = (href: string): number => {
      const known = indexOf.get(href);
      if (known !== undefined) return known;
      const index = files.push(href) - 1;
      indexOf.set(href, index);
      return index;
    };

    const byFile = new Map<string, string>();
    for (const [key, entry] of Object.entries(input.clientManifest)) {
      if (entry.file && !byFile.has(entry.file)) {
        byFile.set(entry.file, key);
      }
    }

    const keys: Record<string, number[]> = {};
    const unresolved: string[] = [];
    const allowed = new Set(input.allowUnresolved ?? []);

    for (const [key, sourcePath] of Object.entries(input.preloadManifest)) {
      const hrefs = this.closureOf(
        this.manifestKeysOf(sourcePath, input, byFile),
        input,
      );

      if (hrefs.length === 0 && !allowed.has(sourcePath)) {
        unresolved.push(sourcePath);
      }

      keys[key] = hrefs.map(intern);
    }

    if (unresolved.length > 0) {
      throw new AlephaError(
        [
          `${unresolved.length} page preload ${unresolved.length === 1 ? "key resolves" : "keys resolve"} to no chunks:`,
          ...unresolved.map((path) => `  - ${path}`),
          "",
          "A route whose preload key resolves to nothing ships no module preloads at all.",
          "Either the path does not exist, or the module is folded into a chunk the",
          "manifests cannot name. Give it a chunk boundary of its own, or list it under",
          "`build.preload.allowUnresolved` in alepha.config.ts if the fold is deliberate.",
        ].join("\n"),
      );
    }

    return {
      files,
      keys,
      entry: this.entryOf(input, intern),
    };
  }

  /**
   * Which client-manifest entries answer for a source path.
   *
   * Two indexes, because neither is complete on its own: the client manifest
   * has the module directly when it owns a chunk, and the ssr manifest names
   * the chunk it landed in when it does not.
   */
  protected manifestKeysOf(
    sourcePath: string,
    input: PreloadTableInput,
    byFile: Map<string, string>,
  ): Set<string> {
    const manifestKeys = new Set<string>();

    if (input.clientManifest[sourcePath]) {
      manifestKeys.add(sourcePath);
    }

    for (const url of input.ssrManifest[sourcePath] ?? []) {
      // Only the JavaScript: stylesheets and font assets are collected by the
      // closure walk below, from the chunks that actually declare them.
      if (!url.endsWith(".js")) continue;

      const key = byFile.get(this.fileOf(url, input.base));
      if (key) manifestKeys.add(key);
    }

    return manifestKeys;
  }

  /**
   * The transitive static closure of a set of manifest entries, as hrefs.
   *
   * `dynamicImports` are deliberately not followed: they are lazy by
   * definition, and preloading them would defeat the split that created them.
   */
  protected closureOf(
    manifestKeys: Set<string>,
    input: PreloadTableInput,
  ): string[] {
    const hrefs = new Set<string>();
    const visited = new Set<string>();

    const walk = (key: string): void => {
      if (visited.has(key)) return;
      visited.add(key);

      const entry = input.clientManifest[key];
      if (!entry) return;

      if (entry.file) hrefs.add(this.hrefOf(entry.file, input.base));
      for (const css of entry.css ?? []) {
        hrefs.add(this.hrefOf(css, input.base));
      }

      for (const imported of entry.imports ?? []) {
        // The html entry point is the document itself, already being loaded.
        if (imported.endsWith(".html")) continue;
        walk(imported);
      }
    };

    for (const key of manifestKeys) walk(key);

    return Array.from(hrefs);
  }

  /**
   * The entry point's script, stylesheets and remaining static graph.
   *
   * The graph matters as much as the script: 13 of the entry's chunks used to
   * be reachable only by parsing `entry.js`, which cost two sequential round
   * trips before hydration could finish.
   */
  protected entryOf(
    input: PreloadTableInput,
    intern: (href: string) => number,
  ): PreloadTable["entry"] {
    const found = Object.entries(input.clientManifest).find(
      ([, entry]) => entry.isEntry,
    );
    if (!found) return undefined;

    const [key, entry] = found;
    const js = this.hrefOf(entry.file, input.base);
    const css = (entry.css ?? []).map((file) => this.hrefOf(file, input.base));
    const own = new Set([js, ...css]);

    const graph = this.closureOf(new Set([key]), input).filter(
      (href) => !own.has(href),
    );

    return {
      js: intern(js),
      css: css.map(intern),
      graph: graph.map(intern),
    };
  }

  /**
   * An emitted file name, from the url the ssr manifest writes for it.
   */
  protected fileOf(url: string, base: string): string {
    const withoutBase =
      base && url.startsWith(base) ? url.slice(base.length) : url;
    return withoutBase.startsWith("/") ? withoutBase.slice(1) : withoutBase;
  }

  protected hrefOf(file: string, base: string): string {
    return `${base}/${file}`;
  }
}
