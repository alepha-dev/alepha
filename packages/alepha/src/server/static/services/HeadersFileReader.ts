import { AlephaError } from "alepha";

import type {
  HeadersProblem,
  HeadersRefusal,
  HeadersRule,
} from "../interfaces/HeadersFile.ts";

/**
 * Reads a `_headers` file: the one file that carries an app's headers to
 * every host that serves its static files itself (epic #E49).
 *
 * ## The format is Cloudflare's, cut down to what every host applies alike
 *
 * Cloudflare Workers Static Assets defines the file; Bay and the app's own
 * server apply the same one. So this reads a strict subset of Cloudflare's
 * grammar and copies its semantics exactly, from its own code: the parser
 * wrangler ships (`parseHeaders`) and the asset worker that applies the result
 * (`attachCustomHeaders` in miniflare's `assets.worker.js`).
 *
 * - Every line is trimmed, so indentation is optional and CRLF is accepted.
 *   `#` starts a comment.
 * - A line starting with `/` starts a rule: an exact path, or a path with one
 *   `*` matching any characters, `/` included, or none.
 * - Under it, `Name: value` sets a header (the value may contain `:`) and
 *   `! Name` removes one. Names compare case-insensitively.
 *
 * ## What is refused, and why each one
 *
 * Everything Cloudflare would silently skip, silently join or silently
 * replace, because a file one host reads differently from another is the bug
 * this exists to remove. See {@link HeadersRefusal} and the fixture cases.
 *
 * ## ⚠️ Declared in no `$module`, deliberately
 *
 * `AlephaServerStatic` lists `AlephaServer` in its services, and injecting a
 * service registers the whole module that declares it. The build task that
 * writes the file runs in the CLI's own container, which must not grow an
 * HTTP server because it read a text file.
 */
export class HeadersFileReader {
  /**
   * Cloudflare's own limits: rules per file, and characters per line.
   */
  public static readonly MAX_RULES = 100;
  public static readonly MAX_LINE_LENGTH = 2000;

  /**
   * wrangler's `LINE_IS_PROBABLY_A_PATH`, verbatim. Note what it catches that
   * reads like a header: `Link:<https://x>` has no whitespace before `://`,
   * so Cloudflare takes the whole line for a host rule.
   */
  protected static readonly RULE_LINE = /^([^\s]+:\/\/|\/)/;

  protected static readonly HOST_RULE = /^[^\s]+:\/\//;

  /**
   * A named placeholder, which Cloudflare substitutes and nothing else does.
   */
  protected static readonly PLACEHOLDER = /:[A-Za-z]\w*/;

  /**
   * `:splat` in a value is replaced by what `*` matched, on Cloudflare only.
   */
  protected static readonly SPLAT = /:splat(?!\w)/;

  /**
   * RFC 3986 path characters, plus `*`. Anything else, a URL parser rewrites:
   * Cloudflare normalises the rule's path with `new URL()` and matches the
   * request's percent-encoded path, so `/café` in the file becomes
   * `/caf%C3%A9` there and stays `/café` on a host that compares text.
   */
  protected static readonly PATH_CHARS =
    /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})*$/;

  /**
   * A header name: an RFC 9110 token. Cloudflare only refuses a space, and a
   * name with any other non-token character makes `Headers.set` throw inside
   * its asset worker on every matching request.
   */
  protected static readonly TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  /**
   * Read a file and refuse it whole if anything in it is wrong.
   *
   * @throws {AlephaError} naming every problem and its lines.
   */
  public read(text: string, source = "_headers"): HeadersRule[] {
    const { rules, problems } = this.parse(text);
    const all = [...problems, ...this.validate(rules)];
    if (all.length > 0) {
      throw new AlephaError(this.describe(all, source));
    }
    return rules;
  }

  /**
   * One sentence per problem, each naming the file and its lines.
   */
  public describe(problems: HeadersProblem[], source = "_headers"): string {
    const lines = problems.map((problem) => {
      const where =
        problem.lines.length > 0
          ? `${source}:${problem.lines.join(", ")}`
          : source;
      return `${where}: ${problem.message}`;
    });
    return `${source} is refused:\n${lines.join("\n")}`;
  }

  /**
   * The rules of a file, and every line-level problem in it.
   *
   * Nothing is thrown, so a caller can report every problem at once. A rule
   * whose path is refused is dropped with the lines under it, which is what
   * Cloudflare does, so one bad path is one problem rather than one per
   * header.
   */
  public parse(text: string): {
    rules: HeadersRule[];
    problems: HeadersProblem[];
  } {
    const rules: HeadersRule[] = [];
    const problems: HeadersProblem[] = [];
    let rule: HeadersRule | undefined;
    let skipping = false;

    const close = () => {
      if (!rule) {
        return;
      }
      if (rule.set.length === 0 && rule.unset.length === 0) {
        problems.push(
          this.problem(
            "empty-rule",
            [rule.line],
            `\`${rule.path}\` sets and removes no header. Cloudflare refuses a rule with no header line.`,
          ),
        );
      } else {
        rules.push(rule);
      }
      rule = undefined;
    };

    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const n = index + 1;
      const line = lines[index].trim();
      if (line === "" || line.startsWith("#")) {
        continue;
      }

      if (line.length > HeadersFileReader.MAX_LINE_LENGTH) {
        problems.push(
          this.problem(
            "line-too-long",
            [n],
            `The line is ${line.length} characters long, over Cloudflare's limit of ${HeadersFileReader.MAX_LINE_LENGTH}, which skips it.`,
          ),
        );
        continue;
      }

      if (HeadersFileReader.RULE_LINE.test(line)) {
        close();
        const problem = this.pathProblem(line, n);
        if (problem) {
          problems.push(problem);
          skipping = true;
          continue;
        }
        skipping = false;
        rule = { path: line, line: n, unset: [], set: [] };
        continue;
      }

      if (skipping) {
        continue;
      }

      if (!rule) {
        problems.push(
          this.problem(
            "header-outside-rule",
            [n],
            "A header line comes before any path. Start a rule with a line beginning with `/`.",
          ),
        );
        continue;
      }

      if (line.startsWith("!")) {
        if (!line.startsWith("! ")) {
          problems.push(
            this.problem(
              "unset-without-space",
              [n],
              `\`${line}\` needs a space after \`!\` to remove a header: Cloudflare reads \`!Name\` as an invalid line.`,
            ),
          );
          continue;
        }
        const name = line.slice(2).trim();
        const nameProblem = this.nameProblem(name, n);
        if (nameProblem) {
          problems.push(nameProblem);
          continue;
        }
        rule.unset.push({ name, line: n });
        continue;
      }

      const colon = line.indexOf(":");
      if (colon < 0) {
        problems.push(
          this.problem(
            "invalid-line",
            [n],
            `\`${line}\` is neither \`Name: value\` nor \`! Name\`.`,
          ),
        );
        continue;
      }

      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      const nameProblem = this.nameProblem(name, n);
      if (nameProblem) {
        problems.push(nameProblem);
        continue;
      }
      if (value === "") {
        problems.push(
          this.problem(
            "empty-value",
            [n],
            `\`${name}\` has no value. To remove a header, write \`! ${name}\`.`,
          ),
        );
        continue;
      }
      if (HeadersFileReader.SPLAT.test(value)) {
        problems.push(
          this.problem(
            "splat-in-value",
            [n],
            "`:splat` in a value is replaced by what `*` matched on Cloudflare only; no other host substitutes it.",
          ),
        );
        continue;
      }

      const lower = name.toLowerCase();
      const earlier = rule.set.find((it) => it.name.toLowerCase() === lower);
      if (earlier) {
        problems.push(
          this.problem(
            "duplicate-header",
            [earlier.line, n],
            `\`${name}\` is set twice in \`${rule.path}\`, which Cloudflare joins into one value with \`, \`. Write one line with the value you mean.`,
          ),
        );
        continue;
      }

      rule.set.push({ name, value, line: n });
    }
    close();

    return { rules, problems };
  }

  /**
   * The problems of a set of rules taken together: too many, one path twice,
   * and two rules that would silently join a header.
   *
   * Separate from {@link parse} because the build validates a file it has
   * merged in memory, whose rules come from more than one place.
   */
  public validate(rules: HeadersRule[]): HeadersProblem[] {
    const problems: HeadersProblem[] = [];

    if (rules.length > HeadersFileReader.MAX_RULES) {
      problems.push(
        this.problem(
          "too-many-rules",
          [rules[HeadersFileReader.MAX_RULES].line],
          `The file has ${rules.length} rules, over Cloudflare's limit of ${HeadersFileReader.MAX_RULES}, which drops the rest.`,
        ),
      );
    }

    const seen = new Map<string, HeadersRule>();
    for (const rule of rules) {
      const first = seen.get(rule.path);
      if (first) {
        problems.push(
          this.problem(
            "duplicate-path",
            [first.line, rule.line],
            `\`${rule.path}\` has two rules. Cloudflare keeps only the second one's headers, silently. Merge them into one.`,
          ),
        );
        continue;
      }
      seen.set(rule.path, rule);
    }

    for (let j = 1; j < rules.length; j++) {
      const later = rules[j];
      for (let i = 0; i < j; i++) {
        const earlier = rules[i];
        if (earlier.path === later.path) {
          continue;
        }
        const path = this.overlap(earlier.path, later.path);
        if (path === undefined) {
          continue;
        }
        for (const set of later.set) {
          const lower = set.name.toLowerCase();
          const removed = later.unset.some(
            (it) => it.name.toLowerCase() === lower,
          );
          if (removed) {
            continue;
          }
          const clash = earlier.set.find(
            (it) => it.name.toLowerCase() === lower,
          );
          if (!clash) {
            continue;
          }
          problems.push({
            ...this.problem(
              "silent-join",
              [clash.line, set.line],
              `\`${earlier.path}\` and \`${later.path}\` both set \`${set.name}\`, and both match ${path}: it would get the two values joined. Start \`${later.path}\` with \`! ${set.name}\` to replace it.`,
            ),
            path,
          });
        }
      }
    }

    return problems;
  }

  /**
   * Whether a rule's path matches a request path.
   *
   * `path` is the request's path as received, percent-encoded and without
   * its query: what Cloudflare reads as `new URL(request.url).pathname`.
   * Never the file that ends up served, which differs for `/about` answered
   * from `about.html` or a miss answered with `404.html`.
   */
  public matches(rulePath: string, path: string): boolean {
    const star = rulePath.indexOf("*");
    if (star < 0) {
      return rulePath === path;
    }
    const prefix = rulePath.slice(0, star);
    const suffix = rulePath.slice(star + 1);
    return (
      path.length >= prefix.length + suffix.length &&
      path.startsWith(prefix) &&
      path.endsWith(suffix)
    );
  }

  /**
   * Apply the rules matching `path` onto a response's headers, exactly as
   * Cloudflare's asset worker does.
   *
   * Every matching rule, in file order. Within a rule, removals first, then
   * sets. The first set of a header replaces whatever the host put there
   * (its default `Cache-Control`, for one); a later rule's set of the same
   * header is appended with `, `. Applies to every status alike: a 200, a
   * 304, a fallback page.
   *
   * `headers` is mutated and returned. Its keys may be any case; a header
   * the rules write is written under its lowercase name.
   */
  public apply<T extends Record<string, string | string[] | undefined>>(
    rules: HeadersRule[],
    path: string,
    headers: T,
  ): T {
    const target = headers as Record<string, string | string[] | undefined>;
    // Cloudflare's `setMap`, kept across rules: it is what makes a second
    // rule's set an append rather than a replace.
    const written = new Set<string>();

    for (const rule of rules) {
      if (!this.matches(rule.path, path)) {
        continue;
      }
      for (const unset of rule.unset) {
        this.remove(target, unset.name);
      }
      for (const set of rule.set) {
        const lower = set.name.toLowerCase();
        if (written.has(lower)) {
          const existing = this.get(target, lower);
          this.remove(target, lower);
          target[lower] =
            existing === undefined
              ? set.value
              : `${Array.isArray(existing) ? existing.join(", ") : existing}, ${set.value}`;
        } else {
          this.remove(target, lower);
          target[lower] = set.value;
          written.add(lower);
        }
      }
    }

    return headers;
  }

  /**
   * A request path both patterns match, or `undefined` when none exists.
   *
   * Exact for patterns with at most one `*`: two can match one path exactly
   * when the text before each star is prefix-compatible and the text after
   * it suffix-compatible, and then the longer prefix followed by the longer
   * suffix is such a path.
   */
  protected overlap(a: string, b: string): string | undefined {
    const starA = a.indexOf("*");
    const starB = b.indexOf("*");
    if (starA < 0 && starB < 0) {
      return a === b ? a : undefined;
    }
    if (starA < 0) {
      return this.matches(b, a) ? a : undefined;
    }
    if (starB < 0) {
      return this.matches(a, b) ? b : undefined;
    }

    const prefixA = a.slice(0, starA);
    const prefixB = b.slice(0, starB);
    const suffixA = a.slice(starA + 1);
    const suffixB = b.slice(starB + 1);
    const prefix = prefixA.length >= prefixB.length ? prefixA : prefixB;
    const shortPrefix = prefix === prefixA ? prefixB : prefixA;
    const suffix = suffixA.length >= suffixB.length ? suffixA : suffixB;
    const shortSuffix = suffix === suffixA ? suffixB : suffixA;
    if (!prefix.startsWith(shortPrefix) || !suffix.endsWith(shortSuffix)) {
      return undefined;
    }
    return `${prefix}${suffix}`;
  }

  protected pathProblem(line: string, n: number): HeadersProblem | undefined {
    if (HeadersFileReader.HOST_RULE.test(line)) {
      return this.problem(
        "host-rule",
        [n],
        `\`${line}\` names a host. Only paths are supported: Bay and the app's own server serve one host each.`,
      );
    }
    if (HeadersFileReader.PLACEHOLDER.test(line)) {
      return this.problem(
        "placeholder",
        [n],
        `\`${line}\` has a named placeholder, which only Cloudflare understands. Use one \`*\`.`,
      );
    }
    if (line.split("*").length > 2) {
      return this.problem(
        "multiple-wildcards",
        [n],
        `\`${line}\` has more than one \`*\`. Cloudflare drops such a rule silently; one is the limit.`,
      );
    }
    const dotSegment = line
      .split("/")
      .some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
    if (!HeadersFileReader.PATH_CHARS.test(line) || dotSegment) {
      return this.problem(
        "path-encoding",
        [n],
        `\`${line}\` is not written the way a browser sends it. Percent-encode it and drop any \`.\` or \`..\` segment: rules match the request's encoded path, and Cloudflare rewrites anything else.`,
      );
    }
    return undefined;
  }

  protected nameProblem(name: string, n: number): HeadersProblem | undefined {
    if (!HeadersFileReader.TOKEN.test(name)) {
      return this.problem(
        "header-name",
        [n],
        name === ""
          ? "The header has no name."
          : `\`${name}\` is not a header name: no spaces, and none of \`"(),/:;<=>?@[\\]{}\`.`,
      );
    }
    return undefined;
  }

  protected problem(
    reason: HeadersRefusal,
    lines: Array<number | undefined>,
    message: string,
  ): HeadersProblem {
    return {
      reason,
      lines: lines
        .filter((it): it is number => it !== undefined)
        .sort((a, b) => a - b),
      message,
    };
  }

  protected get(
    headers: Record<string, string | string[] | undefined>,
    lower: string,
  ): string | string[] | undefined {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        return headers[key];
      }
    }
    return undefined;
  }

  protected remove(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): void {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        delete headers[key];
      }
    }
  }
}
