import { AlephaError } from "alepha";

/**
 * Parses and manipulates templated paths with `{param}` placeholders.
 *
 * Used by both RouterProvider (HTTP routes) and TopicProvider (pub/sub topics)
 * to handle parameterized path templates in a unified way.
 *
 * @example
 * ```ts
 * const parser = new TemplatedPathParser("/users/{userId}/posts/{postId}");
 * parser.interpolate({ userId: "7", postId: "42" }); // "/users/7/posts/42"
 * parser.extract("/users/7/posts/42");               // { userId: "7", postId: "42" }
 * parser.wildcardize("+");                           // "/users/+/posts/+"
 * ```
 *
 * @example
 * ```ts
 * // Redis-style colon-separated keys
 * const parser = new TemplatedPathParser("cache:{namespace}:{key}", ":");
 * parser.interpolate({ namespace: "users", key: "42" }); // "cache:users:42"
 * parser.wildcardize("*");                               // "cache:*:*"
 * ```
 */
export class TemplatedPathParser {
  protected static readonly PARAM_REGEX = /\{([^}]+)\}/g;

  public readonly template: string;
  public readonly separator: string;
  public readonly paramNames: readonly string[];
  public readonly hasParams: boolean;
  protected readonly extractRegex: RegExp | null;

  constructor(template: string, separator = "/") {
    if (separator.length !== 1) {
      throw new AlephaError(
        `TemplatedPathParser separator must be a single character, got '${separator}'`,
      );
    }
    this.template = template;
    this.separator = separator;
    this.paramNames = [
      ...template.matchAll(TemplatedPathParser.PARAM_REGEX),
    ].map((m) => m[1]);
    this.hasParams = this.paramNames.length > 0;
    this.extractRegex = this.hasParams ? this.buildExtractRegex() : null;
  }

  /**
   * Replaces each `{param}` in the template with the corresponding value
   * from the provided params record.
   */
  interpolate(params: Record<string, string>): string {
    return this.template.replace(
      TemplatedPathParser.PARAM_REGEX,
      (_, name: string) => params[name] ?? `{${name}}`,
    );
  }

  /**
   * Extracts parameter values from a concrete path by matching it against
   * the template structure.
   *
   * Returns `null` when the path does not match the template.
   * Returns `{}` when the template has no parameters and the path matches.
   */
  extract(path: string): Record<string, string> | null {
    if (!this.extractRegex) {
      return path === this.template ? {} : null;
    }

    const match = this.extractRegex.exec(path);
    if (!match) {
      return null;
    }

    const result: Record<string, string> = {};
    for (let i = 0; i < this.paramNames.length; i++) {
      result[this.paramNames[i]] = match[i + 1];
    }
    return result;
  }

  /**
   * Replaces each `{param}` placeholder in the template with the given
   * wildcard string. Defaults to `"+"` (MQTT-style).
   */
  wildcardize(wildcard = "+"): string {
    return this.template.replace(TemplatedPathParser.PARAM_REGEX, wildcard);
  }

  /**
   * Normalises a path by collapsing repeated separators and stripping a
   * trailing separator (unless the path is just the separator itself).
   */
  normalize(path: string): string {
    const sep = this.separator;
    const escapedSep = this.escapeRegex(sep);

    let result = path.replace(new RegExp(`${escapedSep}{2,}`, "g"), sep);

    if (result.endsWith(sep) && result.length > sep.length) {
      result = result.slice(0, -sep.length);
    }

    return result;
  }

  protected buildExtractRegex(): RegExp {
    const escapedSeparator = this.escapeRegex(this.separator);

    const regexSource = this.template
      .replace(/[.*+?^${}()|[\]\\]/g, (char) => {
        if (char === "{" || char === "}") {
          return char;
        }
        return `\\${char}`;
      })
      .replace(/\{[^}]+\}/g, `([^${escapedSeparator}]+)`);

    return new RegExp(`^${regexSource}$`);
  }

  protected escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
