import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * File extensions considered when scanning for dictionaries / usage.
 */
const SCAN_EXTS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Built-in path substrings that are always excluded from scanning.
 */
const DEFAULT_EXCLUDES = [
  "/node_modules/",
  "/dist/",
  "/__tests__/",
  "/.alepha/",
  ".spec.ts",
  ".spec.tsx",
  ".test.ts",
  ".test.tsx",
];

/**
 * Matches a quoted dotted property key on the left-hand side of a
 * dictionary entry: `"some.dotted.key":`. The "at least one dot"
 * requirement rules out unrelated quoted strings (e.g. JSON literals
 * inside helper text).
 */
const KEY_DECLARATION_RE = /"([\w-]+(?:\.[\w-]+)+)"\s*:/g;

/**
 * Heuristic for spotting files that declare a dictionary. Conservative
 * by design — we'd rather scan a few unrelated files than miss a
 * dictionary tucked away in an unusual location.
 */
const DICTIONARY_MARKER = "$dictionary";

/**
 * Captures the module specifier of a lazily-imported dictionary, i.e. the
 * `"./fr.ts"` in `$dictionary({ lazy: () => import("./fr.ts") })`. Apps
 * commonly split each language into its own file so a session only ships the
 * active locale — those key files carry no `$dictionary` marker, so without
 * this the keys would be invisible to the check.
 *
 * `[^{}]*?` keeps the match inside the `$dictionary` call's own object literal
 * (it stops at the first brace), so unrelated lazy imports in the same file —
 * e.g. a sibling `$page({ lazy: () => import("./Page.tsx") })` or a
 * `$dictionary` whose `lazy` returns an inline `({ default: {…} })` object —
 * are never mistaken for dictionary key files.
 */
const DICTIONARY_LAZY_IMPORT_RE =
  /\$dictionary\s*\(\s*\{[^{}]*?import\s*\(\s*["']([^"']+)["']/g;

export interface I18nCheckOptions {
  root: string;
  scan: string[];
  dynamicPrefixes: string[];
  exclude: string[];
}

export interface I18nCheckResult {
  /** Total number of keys discovered across all dictionary files. */
  totalKeys: number;
  /** Number of keys exempted via `dynamicPrefixes`. */
  exemptKeys: number;
  /** Number of source files scanned for references. */
  scannedFiles: number;
  /** Dictionary files that contributed keys. */
  dictionaryFiles: string[];
  /** Keys that have no quoted-literal reference anywhere in the scan. */
  unused: string[];
}

export class I18nCheckService {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Find unused translation keys.
   *
   * Discovery is fully static: we walk `scan` dirs, identify files
   * that import `$dictionary` (matched via the literal substring) plus
   * any per-language files they lazily `import(...)`, extract every
   * `"a.b.c": ...` property key declared across them, then grep the
   * remaining source files for a quoted-literal occurrence of each key.
   * Anything matching a `dynamicPrefixes` entry is exempted.
   */
  async check(options: I18nCheckOptions): Promise<I18nCheckResult> {
    const { root, scan, dynamicPrefixes, exclude } = options;
    const excludes = [...DEFAULT_EXCLUDES, ...exclude];

    const allFiles: string[] = [];
    for (const dir of scan) {
      const absDir = this.fs.join(root, dir);
      let entries: string[];
      try {
        entries = await this.fs.ls(absDir, { recursive: true });
      } catch {
        // Missing scan dir is silently skipped — config carries
        // optional paths (e.g. .vendor/**) that may not exist locally.
        continue;
      }
      for (const rel of entries) {
        const abs = this.fs.join(absDir, rel);
        if (!SCAN_EXTS.some((ext) => abs.endsWith(ext))) continue;
        if (excludes.some((sub) => abs.includes(sub))) continue;
        allFiles.push(abs);
      }
    }

    const fileContents = new Map<string, string>();
    for (const file of allFiles) {
      fileContents.set(file, (await this.fs.readFile(file)).toString("utf8"));
    }

    // A file is a dictionary if it declares `$dictionary` OR it is the target
    // of a `$dictionary({ lazy: () => import("…") })` (the split per-language
    // key files, which carry no marker of their own). Resolving the lazy
    // targets first lets their keys be extracted below and keeps them out of
    // the usage corpus (their `"key": "value"` lines aren't references).
    const dictionarySet = new Set<string>();
    for (const [file, text] of fileContents) {
      if (!text.includes(DICTIONARY_MARKER)) continue;
      dictionarySet.add(file);
      for (const m of text.matchAll(DICTIONARY_LAZY_IMPORT_RE)) {
        const target = this.resolveImport(file, m[1], fileContents);
        if (target) dictionarySet.add(target);
      }
    }

    const dictionaryFiles: string[] = [];
    const allKeys = new Set<string>();
    for (const file of dictionarySet) {
      const text = fileContents.get(file);
      if (!text) continue;
      const before = allKeys.size;
      for (const m of text.matchAll(KEY_DECLARATION_RE)) {
        allKeys.add(m[1]);
      }
      if (allKeys.size > before) dictionaryFiles.push(file);
    }

    // Concatenate every non-dictionary file into one corpus so each
    // key is tested with a single regex run rather than O(files × keys).
    const corpusParts: string[] = [];
    let scannedFiles = 0;
    for (const [file, text] of fileContents) {
      if (dictionarySet.has(file)) continue;
      corpusParts.push(text);
      scannedFiles++;
    }
    const corpus = corpusParts.join("\n");

    let exemptKeys = 0;
    const unused: string[] = [];
    for (const key of allKeys) {
      if (dynamicPrefixes.some((p) => key.startsWith(p))) {
        exemptKeys++;
        continue;
      }
      const literal = key.replace(/[.\\]/g, (c) => `\\${c}`);
      // Key must appear as a quoted string literal — `"..."`, `'...'`,
      // or `` `...` ``. Quotes on both sides rule out accidental
      // substring hits in longer keys.
      const re = new RegExp(`["'\`]${literal}["'\`]`);
      if (!re.test(corpus)) unused.push(key);
    }

    return {
      totalKeys: allKeys.size,
      exemptKeys,
      scannedFiles,
      dictionaryFiles,
      unused: unused.sort(),
    };
  }

  /**
   * Resolve a relative `import("…")` specifier from `fromFile` to an absolute
   * path that was actually scanned. Returns `undefined` for bare/package
   * specifiers or targets outside the scan set. Extensionless specifiers are
   * probed against each supported source extension.
   */
  protected resolveImport(
    fromFile: string,
    spec: string,
    files: Map<string, string>,
  ): string | undefined {
    if (!spec.startsWith(".")) return undefined;
    // `join(file, "..", spec)` drops the filename then applies the relative
    // specifier — i.e. resolves against `fromFile`'s directory.
    const base = this.fs.join(fromFile, "..", spec);
    if (files.has(base)) return base;
    for (const ext of SCAN_EXTS) {
      if (files.has(base + ext)) return base + ext;
    }
    return undefined;
  }
}
