/**
 * One rule of a `_headers` file: a path, then the headers it removes and
 * the headers it sets.
 *
 * Every line number is 1-based, in the file the rule was read from. It is
 * optional because a rule can be built rather than read: the build writes
 * the security rule itself, and a problem with it has no line to cite.
 */
export interface HeadersRule {
  /**
   * The path, exactly as written: an exact path, or one with a single `*`
   * matching any characters, `/` included, or none.
   */
  path: string;

  /**
   * The line the path is on.
   */
  line?: number;

  /**
   * `! Name` lines, which Cloudflare applies before any set of the same rule.
   */
  unset: HeadersRuleUnset[];

  /**
   * `Name: value` lines, in file order.
   */
  set: HeadersRuleSet[];
}

export interface HeadersRuleUnset {
  /**
   * The header name as written. Names compare case-insensitively.
   */
  name: string;
  line?: number;
}

export interface HeadersRuleSet {
  /**
   * The header name as written. Names compare case-insensitively.
   */
  name: string;
  value: string;
  line?: number;
}

/**
 * Why a `_headers` file is refused, as a code rather than a sentence.
 *
 * The TypeScript reader and Bay's Go reader share one conformance fixture
 * (`apps/bay/internal/headers/testdata/`), and its refusal cases name these
 * codes and the lines involved, never message text, so the two languages
 * agree on WHAT is refused without having to agree on how it is worded.
 */
export type HeadersRefusal =
  | "line-too-long"
  | "host-rule"
  | "placeholder"
  | "multiple-wildcards"
  | "path-encoding"
  | "header-outside-rule"
  | "invalid-line"
  | "unset-without-space"
  | "header-name"
  | "empty-value"
  | "splat-in-value"
  | "duplicate-header"
  | "empty-rule"
  | "duplicate-path"
  | "too-many-rules"
  | "silent-join";

/**
 * One thing wrong with a `_headers` file.
 */
export interface HeadersProblem {
  reason: HeadersRefusal;

  /**
   * The lines involved, ascending: one for a line-level problem, two for a
   * conflict between lines (a duplicate, a silent join). Empty when the
   * lines are unknown, which only happens for a built rule.
   */
  lines: number[];

  /**
   * The problem, in words, for a person.
   */
  message: string;

  /**
   * For a silent join: a request path both rules match.
   */
  path?: string;
}
