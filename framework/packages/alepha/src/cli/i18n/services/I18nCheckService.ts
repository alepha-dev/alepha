import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

export interface I18nCheckOptions {
  root: string;
  scan: string[];
  dynamicPrefixes: string[];
  exclude: string[];
}

export interface I18nCheckResult {
  /**
   * Total number of keys discovered across all dictionary files.
   */
  totalKeys: number;
  /**
   * Number of keys exempted via `dynamicPrefixes`.
   */
  exemptKeys: number;
  /**
   * Number of source files scanned for references.
   */
  scannedFiles: number;
  /**
   * Dictionary files that contributed keys.
   */
  dictionaryFiles: string[];
  /**
   * Keys that have no quoted-literal reference anywhere in the scan.
   */
  unused: string[];
  /**
   * Entries written with a `{0}`-style placeholder Alepha never interpolates.
   */
  badPlaceholders: I18nBadPlaceholder[];
  /**
   * `tr(...)` call sites that pass fewer arguments than their key needs.
   */
  missingArgs: I18nMissingArg[];
  /**
   * `tr(...)` call sites that leave a `{name}` of their entry unfilled.
   */
  missingNames: I18nMissingName[];
}

export interface I18nMissingName {
  /**
   * The dotted key whose `{name}` placeholders go unfilled.
   */
  key: string;
  /**
   * The names the call does not pass, `count` meaning the `count` option.
   */
  names: string[];
  /**
   * Absolute path of the file holding the call.
   */
  file: string;
}

export interface I18nMissingArg {
  /**
   * The dotted key whose placeholders go unfilled.
   */
  key: string;
  /**
   * Highest `$N` the entry uses, i.e. how many arguments it needs.
   */
  needs: number;
  /**
   * How many the call site passes — `0` when it passes no `args` at all.
   */
  got: number;
  /**
   * Absolute path of the file holding the call.
   */
  file: string;
}

export interface I18nBadPlaceholder {
  /**
   * Absolute path of the dictionary file the entry was declared in.
   */
  file: string;
  /**
   * The dotted key the placeholder belongs to.
   */
  key: string;
  /**
   * The offending placeholder as written, e.g. `{0}`.
   */
  placeholder: string;
}

export class I18nCheckService {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * File extensions considered when scanning for dictionaries / usage.
   */
  protected readonly scanExts = [".ts", ".tsx", ".mts", ".cts"];

  /**
   * Built-in path substrings that are always excluded from scanning.
   */
  protected readonly defaultExcludes = [
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
  protected readonly keyDeclarationRe = /"([\w-]+(?:\.[\w-]+)+)"\s*:/g;

  /**
   * Heuristic for spotting files that declare a dictionary. Conservative
   * by design — we'd rather scan a few unrelated files than miss a
   * dictionary tucked away in an unusual location.
   */
  protected readonly dictionaryMarker = "$dictionary";

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
  protected readonly dictionaryLazyImportRe =
    /\$dictionary\s*\(\s*\{[^{}]*?import\s*\(\s*["']([^"']+)["']/g;

  /**
   * Matches an ICU/`String.format`-style placeholder — `{0}`, `{1}`, … — inside a
   * dictionary file.
   *
   * Alepha interpolates `$1`, `$2`, … and `{name}` (see `I18nProvider.render`),
   * and a name is never a number: `{0}` is not a placeholder, so it survives
   * verbatim into the rendered string and the user
   * reads a literal `{0}` where a number or a name belonged. The failure is
   * entirely silent — no throw, no missing-key fallback — which is why it is worth
   * a check rather than a code review. The two syntaxes are unambiguous, so a
   * match is always a mistake and never a deliberate choice.
   */
  protected readonly badPlaceholderRe = /\{\d+\}/g;

  /**
   * Matches a `{name}` placeholder, or the `{{` / `}}` escape that writes a
   * literal brace (matched so the scan steps over it, never collected).
   * A `${name}` is a template literal's substitution in the file's own code,
   * not a placeholder.
   */
  protected readonly namedPlaceholderRe = /\{\{|\}\}|(?<!\$)\{(\w+)\}/g;

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
    const excludes = [...this.defaultExcludes, ...exclude];

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
        if (!this.scanExts.some((ext) => abs.endsWith(ext))) continue;
        if (excludes.some((sub) => abs.includes(sub))) continue;
        allFiles.push(abs);
      }
    }

    const fileContents = new Map<string, string>();
    for (const file of allFiles) {
      fileContents.set(file, await this.fs.readTextFile(file));
    }

    // A file is a dictionary if it declares `$dictionary` OR it is the target
    // of a `$dictionary({ lazy: () => import("…") })` (the split per-language
    // key files, which carry no marker of their own). Resolving the lazy
    // targets first lets their keys be extracted below and keeps them out of
    // the usage corpus (their `"key": "value"` lines aren't references).
    const dictionarySet = new Set<string>();
    for (const [file, text] of fileContents) {
      if (!text.includes(this.dictionaryMarker)) continue;
      dictionarySet.add(file);
      for (const m of text.matchAll(this.dictionaryLazyImportRe)) {
        const target = this.resolveImport(file, m[1], fileContents);
        if (target) dictionarySet.add(target);
      }
    }

    const dictionaryFiles: string[] = [];
    const allKeys = new Set<string>();
    const badPlaceholders: I18nBadPlaceholder[] = [];
    // key → highest `$N` its value uses. Only keys that need arguments are
    // recorded, so the call-site scan below stays proportional to those.
    const arity = new Map<string, number>();
    // key → the `{name}` placeholders its value uses, across its variants.
    const names = new Map<string, Set<string>>();
    for (const file of dictionarySet) {
      const raw = fileContents.get(file);
      if (!raw) continue;
      // Both scans below read the text BETWEEN two key declarations, so a
      // comment sitting there is attributed to the entry above it. A comment
      // documenting placeholders — exactly the kind a careful dictionary
      // carries — then makes its neighbour look like it needs arguments it
      // does not, and the entry fails a check its own documentation caused.
      const text = this.blankComments(raw);
      const before = allKeys.size;
      const declarations: Array<{ key: string; index: number }> = [];
      for (const m of text.matchAll(this.keyDeclarationRe)) {
        allKeys.add(m[1]);
        declarations.push({ key: m[1], index: m.index ?? 0 });
      }
      badPlaceholders.push(
        ...this.findBadPlaceholders(file, text, declarations),
      );
      this.collectArity(text, declarations, arity);
      this.collectNames(text, declarations, names);
      if (allKeys.size > before) dictionaryFiles.push(file);
    }

    // Concatenate every non-dictionary file into one corpus so each
    // key is tested with a single regex run rather than O(files × keys).
    const corpusParts: string[] = [];
    const sourceFiles: Array<[string, string]> = [];
    let scannedFiles = 0;
    for (const [file, text] of fileContents) {
      if (dictionarySet.has(file)) continue;
      corpusParts.push(text);
      sourceFiles.push([file, text]);
      scannedFiles++;
    }
    const corpus = corpusParts.join("\n");

    const missingArgs: I18nMissingArg[] = [];
    const missingNames: I18nMissingName[] = [];
    for (const [file, text] of sourceFiles) {
      missingArgs.push(...this.findMissingArgs(file, text, arity));
      missingNames.push(...this.findMissingNames(file, text, names));
    }

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
      badPlaceholders,
      missingArgs,
      missingNames,
    };
  }

  /**
   * Attribute every `{0}`-style placeholder in a dictionary file to the key it
   * belongs to.
   *
   * The value is matched by position rather than parsed: a formatter is free to
   * wrap a long entry across several lines, so a regex anchored to the key
   * declaration would miss exactly the long strings most likely to interpolate
   * something. The nearest preceding `"a.b.c":` is the owning key.
   */
  protected findBadPlaceholders(
    file: string,
    text: string,
    declarations: Array<{ key: string; index: number }>,
  ): I18nBadPlaceholder[] {
    const found: I18nBadPlaceholder[] = [];
    for (const m of text.matchAll(this.badPlaceholderRe)) {
      const at = m.index ?? 0;
      let key: string | undefined;
      for (const d of declarations) {
        if (d.index > at) break;
        key = d.key;
      }
      if (!key) continue;
      found.push({ file, key, placeholder: m[0] });
    }
    return found;
  }

  /**
   * Replace every comment with spaces, leaving the text the same length.
   *
   * Same length is the whole point: the key declarations are located by index
   * into this string, so deleting the comments outright would slide every
   * declaration after the first one out of position.
   *
   * String literals are tracked rather than skipped naively, because a value
   * may legitimately contain `//` — `"Voir https://example.com/$1"` is a
   * dictionary entry, not a comment, and blanking from the slashes would drop
   * the `$1` and under-count the entry's arity.
   */
  protected blankComments(text: string): string {
    const out = text.split("");
    let quote: string | undefined;
    let comment: "line" | "block" | undefined;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (comment === "line") {
        if (c === "\n") comment = undefined;
        else out[i] = " ";
        continue;
      }

      if (comment === "block") {
        // Keep newlines so line numbers reported elsewhere stay honest.
        if (c !== "\n") out[i] = " ";
        if (c === "*" && next === "/") {
          out[i + 1] = " ";
          i++;
          comment = undefined;
        }
        continue;
      }

      if (quote) {
        // `\"` inside a string is data, not the closing quote.
        if (c === "\\") i++;
        else if (c === quote) quote = undefined;
        continue;
      }

      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        continue;
      }

      if (c === "/" && next === "/") {
        comment = "line";
        out[i] = " ";
        continue;
      }

      if (c === "/" && next === "*") {
        comment = "block";
        out[i] = " ";
      }
    }

    return out.join("");
  }

  /**
   * Record how many arguments each entry needs — the highest `$N` in its value.
   *
   * Same positional attribution as {@link findBadPlaceholders}: a value's text
   * is whatever lies between its own key declaration and the next one, which
   * survives a formatter wrapping a long entry onto its own line.
   *
   * Entries needing nothing are not recorded at all, so the call-site scan
   * below only ever considers keys that can actually go unfilled.
   */
  protected collectArity(
    text: string,
    declarations: Array<{ key: string; index: number }>,
    into: Map<string, number>,
  ): void {
    for (let i = 0; i < declarations.length; i++) {
      const start = declarations[i].index;
      const end = declarations[i + 1]?.index ?? text.length;
      let max = 0;
      for (const m of text.slice(start, end).matchAll(/\$(\d+)/g)) {
        max = Math.max(max, Number.parseInt(m[1], 10));
      }
      if (max > 0) {
        const key = declarations[i].key;
        into.set(key, Math.max(into.get(key) ?? 0, max));
      }
    }
  }

  /**
   * Record the `{name}` placeholders of each entry, across every variant of a
   * variant object (the same positional attribution as {@link collectArity}).
   * `{count}` is recorded too: the `count` option fills it. A numeric `{0}` is
   * the bad placeholder's, and an escaped `{{name}}` is text.
   */
  protected collectNames(
    text: string,
    declarations: Array<{ key: string; index: number }>,
    into: Map<string, Set<string>>,
  ): void {
    for (let i = 0; i < declarations.length; i++) {
      const start = declarations[i].index;
      const end = declarations[i + 1]?.index ?? text.length;
      for (const m of text
        .slice(start, end)
        .matchAll(this.namedPlaceholderRe)) {
        const name = m[1];
        if (!name || /^\d+$/.test(name)) continue;
        const key = declarations[i].key;
        const set = into.get(key) ?? new Set<string>();
        set.add(name);
        into.set(key, set);
      }
    }
  }

  /**
   * Find `tr("key")` calls that leave a `{name}` of `"key"` unfilled: a name
   * missing from `args: { ... }`, every name when the call passes positional
   * arguments or none, and `{count}` when it passes no `count`.
   *
   * As conservative as {@link findMissingArgs}: a spread, an `args` that is a
   * variable, or an options object it cannot read leaves the call alone.
   */
  protected findMissingNames(
    file: string,
    text: string,
    names: Map<string, Set<string>>,
  ): I18nMissingName[] {
    const found: I18nMissingName[] = [];
    for (const [key, used] of names) {
      const literal = key.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
      const call = new RegExp(
        `\\b(tr|translate)\\s*\\(\\s*["'\`]${literal}["'\`]`,
        "g",
      );
      for (const m of text.matchAll(call)) {
        const rest = this.callTail(text, (m.index ?? 0) + m[0].length);
        if (rest === undefined) continue;
        const passed = this.passedNames(rest, m[1] === "translate");
        if (passed === undefined) continue;
        const missing = [...used].filter((name) =>
          name === "count" ? !passed.count : !passed.names?.has(name),
        );
        if (passed.names === undefined) {
          // `args` could not be read: only `{count}` is proven.
          const onlyCount = missing.filter((name) => name === "count");
          if (onlyCount.length > 0) found.push({ key, names: onlyCount, file });
          continue;
        }
        if (missing.length > 0) found.push({ key, names: missing, file });
      }
    }
    return found;
  }

  /**
   * What a call passes for named placeholders: whether it passes a `count`,
   * and the names of its `args` record (an empty set for positional or absent
   * arguments, `undefined` when `args` cannot be read). `undefined` overall
   * when the options themselves cannot be read.
   *
   * `translate(key, args, { count })` takes the arguments positionally.
   */
  protected passedNames(
    tail: string,
    positional: boolean,
  ): { count: boolean; names: Set<string> | undefined } | undefined {
    const trimmed = tail.trim();
    if (trimmed === "") return { count: false, names: new Set() };
    if (!trimmed.startsWith(",")) return undefined;
    const after = trimmed.slice(1).trimStart();

    if (positional) {
      // translate(key, args?, options?)
      let args: Set<string> | undefined;
      let rest = after;
      if (after.startsWith("[")) {
        const list = this.balanced(after, "[", "]");
        if (list === undefined) return undefined;
        args = new Set();
        rest = after.slice(list.length);
      } else if (after.startsWith("{")) {
        const obj = this.balanced(after, "{", "}");
        if (obj === undefined) return undefined;
        args = this.propertyNames(obj.slice(1, -1));
        rest = after.slice(obj.length);
      } else {
        return undefined;
      }
      rest = rest.trim();
      if (rest === "") return { count: false, names: args };
      if (!rest.startsWith(",")) return undefined;
      const opts = rest.slice(1).trim();
      if (!opts.startsWith("{")) return undefined;
      const obj = this.balanced(opts, "{", "}");
      if (obj === undefined) return undefined;
      const keys = this.propertyNames(obj.slice(1, -1));
      if (keys === undefined) return undefined;
      return { count: keys.has("count"), names: args };
    }

    if (!after.startsWith("{")) return undefined;
    const obj = this.balanced(after, "{", "}");
    if (obj === undefined) return undefined;
    const inner = obj.slice(1, -1);
    const keys = this.propertyNames(inner);
    if (keys === undefined) return undefined;
    const count = keys.has("count");
    if (!keys.has("args")) return { count, names: new Set() };

    const m = /(^|[{,\s])args\s*:\s*/.exec(inner);
    const value = m ? inner.slice(m.index + m[0].length) : "";
    if (value.startsWith("[")) return { count, names: new Set() };
    if (value.startsWith("{")) {
      const record = this.balanced(value, "{", "}");
      return {
        count,
        names: record ? this.propertyNames(record.slice(1, -1)) : undefined,
      };
    }
    return { count, names: undefined };
  }

  /**
   * The top-level property names of an object literal's body, shorthand
   * included, or `undefined` when a spread makes them unknowable.
   */
  protected propertyNames(body: string): Set<string> | undefined {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let current = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (quote) {
        if (c === "\\") {
          current += c + (body[i + 1] ?? "");
          i++;
          continue;
        }
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "(" || c === "[" || c === "{") {
        depth++;
      } else if (c === ")" || c === "]" || c === "}") {
        depth--;
      } else if (c === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += c;
    }
    parts.push(current);

    const names = new Set<string>();
    for (const raw of parts) {
      const part = raw.trim();
      if (part === "") continue;
      if (part.startsWith("...")) return undefined;
      const m = /^["']?([\w$]+)["']?\s*(?::|$)/.exec(part);
      if (m) names.add(m[1]);
    }
    return names;
  }

  /**
   * Find `tr("key")` calls that pass fewer arguments than `"key"` needs.
   *
   * The failure this catches is silent in the same way a `{0}` is: the
   * placeholder reaches the user verbatim, as `up to $1 files`. Correct syntax
   * with no arguments and wrong syntax are the two halves of the same defect,
   * and neither throws.
   *
   * **Deliberately conservative — it reports only what it can prove.** A call
   * whose arguments it cannot count (a spread, a variable, a helper wrapping
   * `tr`) is skipped rather than guessed at, because a false positive in a
   * pipeline check costs more than a missed one: the first thing anyone does
   * with a check that cries wolf is stop reading it. What it does prove is the
   * common case — a call passing no `args` at all.
   */
  protected findMissingArgs(
    file: string,
    text: string,
    arity: Map<string, number>,
  ): I18nMissingArg[] {
    const found: I18nMissingArg[] = [];
    for (const [key, needs] of arity) {
      const literal = key.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
      // The key must be the FIRST argument of a `tr(` / `translate(` call.
      // Without anchoring on the callee, a bare `"some.key"` sitting in a nav
      // array or an object literal would be read as a call with no arguments.
      const call = new RegExp(
        `\\b(?:tr|translate)\\s*\\(\\s*["'\`]${literal}["'\`]`,
        "g",
      );
      for (const m of text.matchAll(call)) {
        const rest = this.callTail(text, (m.index ?? 0) + m[0].length);
        if (rest === undefined) continue;
        const got = this.countArgs(rest);
        if (got === undefined) continue;
        if (got < needs) found.push({ key, needs, got, file });
      }
    }
    return found;
  }

  /**
   * Return the source between a call's first argument and its closing paren,
   * or `undefined` if the call does not terminate inside a sane window.
   *
   * Depth-counted rather than regex-matched: an options object routinely holds
   * nested parens and braces, and a lazy `\)` would stop at the first one.
   */
  protected callTail(text: string, from: number): string | undefined {
    let depth = 1;
    for (let i = from; i < text.length && i - from < 2000; i++) {
      const c = text[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) return text.slice(from, i);
      }
    }
    return undefined;
  }

  /**
   * Count the arguments a `tr` call passes, or `undefined` when they cannot be
   * counted with certainty.
   *
   * Two shapes are understood: `tr(key, { args: [a, b] })` and the positional
   * `translate(key, [a, b])`. Anything else — a spread, a bare identifier, a
   * computed array — returns `undefined` and the call is left alone.
   */
  protected countArgs(tail: string): number | undefined {
    const trimmed = tail.trim();
    // `tr("key")` — nothing follows the key at all. The one case worth being
    // certain about, and the one that shipped.
    if (trimmed === "" || trimmed.startsWith(")")) return 0;
    if (!trimmed.startsWith(",")) return undefined;

    const after = trimmed.slice(1).trimStart();
    let list: string | undefined;
    if (after.startsWith("[")) {
      list = this.balanced(after, "[", "]");
    } else if (after.startsWith("{")) {
      const m = /(^|[{,\s])args\s*:\s*\[/.exec(after);
      if (!m) {
        // An options object with no `args` key — e.g. `{ default: "…" }`.
        // Proven to pass nothing.
        return /(^|[{,\s])args\s*:/.test(after) ? undefined : 0;
      }
      list = this.balanced(after.slice(m.index + m[0].length - 1), "[", "]");
    }
    if (list === undefined) return undefined;

    const inner = list.slice(1, -1).trim();
    if (inner === "") return 0;
    // A spread contributes an unknown count; refuse to guess.
    if (inner.includes("...")) return undefined;

    let depth = 0;
    let count = 1;
    for (const c of inner) {
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) count++;
    }
    return count;
  }

  /**
   * Slice the balanced `open`…`close` region starting at index 0 of `text`.
   */
  protected balanced(
    text: string,
    open: string,
    close: string,
  ): string | undefined {
    if (text[0] !== open) return undefined;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) return text.slice(0, i + 1);
      }
    }
    return undefined;
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
    for (const ext of this.scanExts) {
      if (files.has(base + ext)) return base + ext;
    }
    return undefined;
  }
}
