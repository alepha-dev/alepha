import { createRequire } from "node:module";

import { $inject, Alepha, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

import { checkOptions } from "../atoms/checkOptions.ts";
import type {
  ConventionFile,
  ConventionRule,
} from "../conventions/ConventionRule.ts";
import { ConventionRegistry } from "./ConventionRegistry.ts";

/**
 * One violation, as `alepha check` prints it and `--json` emits it.
 */
export interface ConventionFinding {
  /**
   * Path relative to the run's root, with `/` separators.
   */
  file: string;
  line: number;
  column: number;
  /**
   * The rule id, or one of the engine's reserved ids
   * ({@link ConventionRunner.ENGINE_IDS}).
   */
  rule: string;
  message: string;
  fix: string;
}

export interface ConventionRunOptions {
  /**
   * The directory the walk is relative to: its `.gitignore` and the
   * config's `ignore` globs are read against it, and every finding's `file`
   * is relative to it.
   */
  root: string;

  /**
   * Files or directories to read instead of the whole root, relative to it
   * or absolute. Omitted, the walk starts at the root.
   */
  paths?: string[];

  /**
   * Run only these rule ids, each validated against the registry. A rule
   * named here runs even when the config turns it `off`. Omitted, every
   * rule the config does not turn off runs.
   */
  rules?: string[];
}

export interface ConventionReport {
  findings: ConventionFinding[];
  /**
   * How many source files were read.
   */
  files: number;
  /**
   * The ids of the rules that ran.
   */
  rules: string[];
}

/**
 * The shape of Vite's `parseSync`, as far as the runner reads it.
 */
type ParseSync = (
  filename: string,
  source: string,
  options: { lang: "ts" | "tsx" },
) => { program: any; comments: any[]; errors: any[] };

/**
 * A parsed exemption comment, `// alepha-allow <rule>: <reason>`.
 */
interface Exemption {
  rule: string;
  reason: string;
  /**
   * Line of the comment itself.
   */
  line: number;
  column: number;
  /**
   * The first code line below the comment and any comment lines stacked
   * under it: the line this exemption applies to.
   */
  target: number;
  used: boolean;
}

/**
 * One compiled line of a `.gitignore` or of the config's `ignore`.
 */
interface IgnorePattern {
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

/**
 * Walks an app's source, parses each file once and runs every applicable
 * {@link ConventionRule} over it. The engine behind `alepha check`, and the
 * programmatic API a repository script calls with its own paths and rules.
 *
 * What it reads, and why:
 *
 * - `.ts` and `.tsx` files, `.d.ts` excluded, from the root down (not from
 *   `src/`: a scaffold keeps its specs in `test/`, a repository of several
 *   workspaces has no root `src/`).
 * - Directory by directory, pruning `node_modules`, `dist`, `.gen` and every
 *   dot-directory by name, because `FileSystemProvider.ls` has no ignore and
 *   a recursive listing would list the dependencies.
 * - The root `.gitignore` and the config's `check.ignore` through one
 *   matcher. Nested `.gitignore` files, `.git/info/exclude` and
 *   `git ls-files` are out of scope: an app is not always a repository.
 *
 * Exemptions are comments on the line above the code,
 * `// alepha-allow <rule>: <reason>`; several stacked comment lines all
 * apply to the first code line below them. An exemption with no reason, one
 * naming no known rule, and one that suppresses nothing are each findings of
 * their own. "Suppresses nothing" is judged only for a rule that ran on that
 * file: under `--rule`, or with a rule `off`, another rule's exemption is
 * neither applied nor reported.
 *
 * The parser is the one `vite` re-exports (`parseSync`), reached through
 * `createRequire` as `BuildServerTask` reaches it, never by importing
 * `rolldown` by name: `vite` is a dependency of `alepha`, `rolldown` is not.
 */
export class ConventionRunner {
  /**
   * The engine's own finding ids. Printed where a rule id is, never
   * configurable and never exemptable.
   */
  public static readonly ENGINE_IDS = {
    parse: "check/parse-error",
    noReason: "check/exemption-no-reason",
    unknownRule: "check/exemption-unknown-rule",
    unused: "check/exemption-unused",
  } as const;

  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly registry = $inject(ConventionRegistry);

  /**
   * Directory names never walked into, whatever the ignore files say.
   */
  protected readonly pruned = new Set(["node_modules", "dist", ".gen"]);

  /**
   * Memoized `parseSync`, resolved on first use by {@link importParser}.
   */
  protected parser?: ParseSync;

  /**
   * Run the rules and return every finding, sorted by file, line and column.
   *
   * @throws AlephaError when the config or `options.rules` names a rule id
   * the registry does not hold; the message lists the valid ones.
   */
  public async run(options: ConventionRunOptions): Promise<ConventionReport> {
    const rules = this.selectRules(options.rules);
    const config = this.alepha.store.get(checkOptions) ?? {};
    const ignore = [
      ...(await this.readGitignore(options.root)),
      ...this.compileIgnore(config.ignore ?? []),
    ];

    const files = await this.collect(options.root, options.paths, ignore);
    const findings: ConventionFinding[] = [];
    for (const relativePath of files) {
      findings.push(
        ...(await this.checkFile(options.root, relativePath, rules)),
      );
    }

    findings.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
    );

    return { findings, files: files.length, rules: rules.map((r) => r.id) };
  }

  /**
   * The rules a run executes: `ids` when given, else every rule the config
   * does not turn `off`. Every id, in either place, must be registered.
   */
  protected selectRules(ids?: string[]): ConventionRule[] {
    const config = this.alepha.store.get(checkOptions) ?? {};
    const configured = Object.keys(config.rules ?? {});
    const unknownInConfig = configured.filter((id) => !this.registry.get(id));
    if (unknownInConfig.length) {
      throw new AlephaError(
        `Unknown rule id in alepha.config.ts check.rules: ${unknownInConfig.join(", ")}. Valid ids: ${this.registry.ids().join(", ")}`,
      );
    }

    if (ids?.length) {
      const unknown = ids.filter((id) => !this.registry.get(id));
      if (unknown.length) {
        throw new AlephaError(
          `Unknown rule id: ${unknown.join(", ")}. Valid ids: ${this.registry.ids().join(", ")}`,
        );
      }
      return ids.map((id) => this.registry.get(id)!);
    }

    return this.registry
      .list()
      .filter((rule) => config.rules?.[rule.id] !== "off");
  }

  // -------------------------------------------------------------------------------------------------------------------
  // One file

  /**
   * Parse one file and run the applicable rules over it, exemptions applied.
   */
  protected async checkFile(
    root: string,
    relativePath: string,
    rules: ConventionRule[],
  ): Promise<ConventionFinding[]> {
    const path = this.fs.join(root, relativePath);
    const source = await this.fs.readTextFile(path);
    const file = this.createFile(path, relativePath, source);
    const applicable = rules.filter((rule) => rule.appliesTo(relativePath));

    const lang = relativePath.endsWith(".tsx") ? "tsx" : "ts";
    const result = this.parse(relativePath, source, lang);
    const error = result.errors.find((it) => it.severity === "Error");
    if (error) {
      const offset = error.labels?.[0]?.start ?? 0;
      return [
        {
          file: relativePath,
          ...file.locate(offset),
          rule: ConventionRunner.ENGINE_IDS.parse,
          message: `Cannot parse this file: ${error.message}`,
          fix: "Fix the syntax: no rule can read this file until it parses.",
        },
      ];
    }

    const findings: ConventionFinding[] = [];
    const exemptions = this.readExemptions(file, result.comments, findings);

    for (const rule of applicable) {
      for (const found of await rule.check(file, result.program)) {
        const exemption = exemptions.find(
          (it) => it.rule === rule.id && it.target === found.line,
        );
        if (exemption) {
          exemption.used = true;
          continue;
        }
        findings.push({
          file: relativePath,
          line: found.line,
          column: found.column,
          rule: rule.id,
          message: found.message ?? rule.description,
          fix: rule.fix,
        });
      }
    }

    const ran = new Set(applicable.map((rule) => rule.id));
    for (const exemption of exemptions) {
      if (!exemption.used && ran.has(exemption.rule)) {
        findings.push({
          file: relativePath,
          line: exemption.line,
          column: exemption.column,
          rule: ConventionRunner.ENGINE_IDS.unused,
          message: `This exemption suppresses nothing: no ${exemption.rule} finding on the line below it.`,
          fix: "Delete the comment, or move it directly above the line it exempts.",
        });
      }
    }

    return findings;
  }

  /**
   * The well-formed exemptions of a file. A malformed one (no reason, an
   * unknown rule) is pushed onto `findings` and not applied.
   */
  protected readExemptions(
    file: ConventionFile,
    comments: any[],
    findings: ConventionFinding[],
  ): Exemption[] {
    const lines = file.source.split("\n");
    const exemptions: Exemption[] = [];

    for (const comment of comments) {
      const text = String(comment.value ?? "")
        .replace(/^\s*\*?\s*/, "")
        .trim();
      const match = /^alepha-allow\b(.*)$/s.exec(text);
      if (!match) {
        continue;
      }

      const { line, column } = file.locate(comment.start);
      const parsed = /^\s*([\w/-]+)\s*(?::\s*([\s\S]*))?$/.exec(match[1]);
      const rule = parsed?.[1] ?? "";
      const reason = (parsed?.[2] ?? "").trim();

      if (!rule || !reason) {
        findings.push({
          file: file.relativePath,
          line,
          column,
          rule: ConventionRunner.ENGINE_IDS.noReason,
          message: "An exemption without a reason.",
          fix: "Write it as // alepha-allow <rule>: <why this line is the exception>, or fix the line and delete the comment.",
        });
        continue;
      }

      if (!this.registry.get(rule)) {
        findings.push({
          file: file.relativePath,
          line,
          column,
          rule: ConventionRunner.ENGINE_IDS.unknownRule,
          message: rule.startsWith("check/")
            ? `${rule} is a finding of the engine itself, which cannot be exempted.`
            : `No rule is called "${rule}".`,
          fix: `Exempt one of: ${this.registry.ids().join(", ")}.`,
        });
        continue;
      }

      // The first code line below the comment and any comment lines stacked
      // under it.
      let target = file.locate(comment.end).line + 1;
      while (target <= lines.length && this.isCommentLine(lines[target - 1])) {
        target += 1;
      }

      exemptions.push({ rule, reason, line, column, target, used: false });
    }

    return exemptions;
  }

  /**
   * Whether a line holds nothing but a comment (`//`, `/*`, `*` or a JSX
   * `{/*`), so that stacked exemptions see through it.
   */
  protected isCommentLine(line: string): boolean {
    return /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(line);
  }

  /**
   * The {@link ConventionFile} a rule reads, with a line index for
   * {@link ConventionFile.locate}.
   */
  protected createFile(
    path: string,
    relativePath: string,
    source: string,
  ): ConventionFile {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        starts.push(i + 1);
      }
    }
    return {
      path,
      relativePath,
      source,
      locate: (offset: number) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
          const mid = (low + high + 1) >> 1;
          if (starts[mid] <= offset) {
            low = mid;
          } else {
            high = mid - 1;
          }
        }
        return { line: low + 1, column: offset - starts[low] + 1 };
      },
    };
  }

  /**
   * Parse a file with the parser Vite ships. Returns the program, the
   * comments and the syntax errors, rather than throwing on the first one.
   */
  protected parse(
    filename: string,
    source: string,
    lang: "ts" | "tsx",
  ): { program: any; comments: any[]; errors: any[] } {
    this.parser ??= this.importParser();
    try {
      const result = this.parser(filename, source, { lang });
      return {
        program: result.program,
        comments: result.comments ?? [],
        errors: result.errors ?? [],
      };
    } catch (error) {
      return {
        program: undefined,
        comments: [],
        errors: [{ severity: "Error", message: String(error), labels: [] }],
      };
    }
  }

  /**
   * Resolve `parseSync` from `vite`, inline, exactly as
   * `BuildServerTask.importParseAst` reaches `parseAst`: a bare import
   * literal would teach depcheck to demand a dependency, and `rolldown` is
   * not one of `alepha`'s.
   */
  protected importParser(): ParseSync {
    return createRequire(import.meta.url)("vite").parseSync;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // The walk

  /**
   * Every source file to read, relative to the root, sorted.
   */
  protected async collect(
    root: string,
    paths: string[] | undefined,
    ignore: IgnorePattern[],
  ): Promise<string[]> {
    const files = new Set<string>();
    const starts = paths?.length ? paths : ["."];

    for (const start of starts) {
      const relative = this.relativeTo(root, start);
      const absolute = relative ? this.fs.join(root, relative) : root;
      if (!(await this.fs.exists(absolute))) {
        throw new AlephaError(`No such file or directory: ${start}`);
      }
      const stat = await this.fs.stat(absolute);
      if (stat.isDirectory) {
        await this.walkDirectory(root, relative, ignore, files);
      } else if (
        this.isSource(relative) &&
        !this.isIgnored(relative, false, ignore)
      ) {
        files.add(relative);
      }
    }

    return [...files].sort();
  }

  /**
   * Add every source file under `relative` (a directory, `""` for the root).
   */
  protected async walkDirectory(
    root: string,
    relative: string,
    ignore: IgnorePattern[],
    files: Set<string>,
  ): Promise<void> {
    const absolute = relative ? this.fs.join(root, relative) : root;
    const entries = (await this.fs.ls(absolute, { hidden: true })).sort();

    for (const entry of entries) {
      const child = relative ? `${relative}/${entry}` : entry;
      const stat = await this.fs.stat(this.fs.join(absolute, entry));
      if (stat.isDirectory) {
        if (
          this.pruned.has(entry) ||
          entry.startsWith(".") ||
          this.isIgnored(child, true, ignore)
        ) {
          continue;
        }
        await this.walkDirectory(root, child, ignore, files);
      } else if (
        this.isSource(child) &&
        !this.isIgnored(child, false, ignore)
      ) {
        files.add(child);
      }
    }
  }

  /**
   * A path relative to the root, with `/` separators and no `./`; `""` for
   * the root itself.
   */
  protected relativeTo(root: string, path: string): string {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    let value = path.replace(/\\/g, "/");
    if (value === normalizedRoot) {
      return "";
    }
    if (value.startsWith(`${normalizedRoot}/`)) {
      value = value.slice(normalizedRoot.length + 1);
    }
    return value
      .split("/")
      .filter((segment) => segment && segment !== ".")
      .join("/");
  }

  /**
   * A `.ts` or `.tsx` file that is not a declaration file.
   */
  protected isSource(relativePath: string): boolean {
    return /\.tsx?$/.test(relativePath) && !relativePath.endsWith(".d.ts");
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Ignore files

  /**
   * The root `.gitignore`, compiled; nothing when there is none.
   */
  protected async readGitignore(root: string): Promise<IgnorePattern[]> {
    const path = this.fs.join(root, ".gitignore");
    if (!(await this.fs.exists(path))) {
      return [];
    }
    return this.compileIgnore((await this.fs.readTextFile(path)).split("\n"));
  }

  /**
   * Compile `.gitignore` lines (or the config's globs, which follow the same
   * grammar): `#` comments, `!` negation, a trailing `/` for a directory, a
   * slash anywhere but the end anchoring the pattern to the root, `*`, `?`
   * and `**`.
   */
  protected compileIgnore(lines: string[]): IgnorePattern[] {
    const patterns: IgnorePattern[] = [];
    for (const raw of lines) {
      let line = raw.replace(/\r$/, "").trimEnd();
      if (!line.trim() || line.startsWith("#")) {
        continue;
      }
      line = line.trim();
      const negate = line.startsWith("!");
      if (negate) {
        line = line.slice(1);
      }
      const dirOnly = line.endsWith("/");
      line = line.replace(/\/+$/, "");
      const anchored = line.includes("/");
      line = line.replace(/^\/+/, "");
      if (!line) {
        continue;
      }
      const body = this.globToRegex(line);
      patterns.push({
        regex: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`),
        negate,
        dirOnly,
      });
    }
    return patterns;
  }

  /**
   * The regular-expression body of one glob.
   */
  protected globToRegex(glob: string): string {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
      const char = glob[i];
      if (char === "*" && glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else if (i > 0 && glob[i - 1] === "/" && i + 2 === glob.length) {
          // `dir/**`: the directory itself and everything below it.
          out = `${out.slice(0, -1)}(?:/.*)?`;
          i += 1;
        } else {
          out += ".*";
          i += 1;
        }
      } else if (char === "*") {
        out += "[^/]*";
      } else if (char === "?") {
        out += "[^/]";
      } else {
        out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    return out;
  }

  /**
   * Whether a path, or any directory above it, is ignored. The last pattern
   * that matches a given path decides, as in git.
   */
  protected isIgnored(
    relativePath: string,
    isDirectory: boolean,
    patterns: IgnorePattern[],
  ): boolean {
    if (!patterns.length) {
      return false;
    }
    const segments = relativePath.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const prefixIsDirectory = i < segments.length || isDirectory;
      let ignored = false;
      for (const pattern of patterns) {
        if (pattern.dirOnly && !prefixIsDirectory) {
          continue;
        }
        if (pattern.regex.test(prefix)) {
          ignored = !pattern.negate;
        }
      }
      if (ignored) {
        return true;
      }
    }
    return false;
  }
}
