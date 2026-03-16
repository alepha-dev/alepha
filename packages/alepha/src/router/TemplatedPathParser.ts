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

  protected readonly template: string;
  protected readonly separator: string;

  constructor(template: string, separator = "/") {
    this.template = template;
    this.separator = separator;
  }

  /**
   * Returns true if the template contains at least one `{param}` placeholder.
   */
  get hasParams(): boolean {
    return /\{[^}]+\}/.test(this.template);
  }

  /**
   * Returns an ordered list of parameter names found in the template.
   */
  get paramNames(): string[] {
    return [...this.template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  }

  /**
   * Replaces each `{param}` in the template with the corresponding value
   * from the provided params record.
   */
  interpolate(params: Record<string, string>): string {
    return this.template.replace(
      /\{([^}]+)\}/g,
      (_, name: string) => params[name] ?? `{${name}}`,
    );
  }

  /**
   * Extracts parameter values from a concrete path by matching it against
   * the template structure. Returns an empty object when the template has
   * no parameters.
   */
  extract(path: string): Record<string, string> {
    const names = this.paramNames;
    if (names.length === 0) {
      return {};
    }

    const escapedSeparator = this.separator.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    // Build a regex from the template: escape literal parts, replace {param} with a capture group
    const regexSource = this.template
      .replace(/[.*+?^${}()|[\]\\]/g, (char) => {
        // Allow { and } through so we can then replace them as param groups
        if (char === "{" || char === "}") {
          return char;
        }
        return `\\${char}`;
      })
      // After escaping literal chars, replace {name} patterns with capture groups.
      // The separator is already escaped above, so we match anything that is not the separator.
      .replace(/\{([^}]+)\}/g, `([^${escapedSeparator}]+)`);

    const regex = new RegExp(`^${regexSource}$`);
    const match = regex.exec(path);

    if (!match) {
      return {};
    }

    const result: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      result[names[i]] = match[i + 1];
    }
    return result;
  }

  /**
   * Replaces each `{param}` placeholder in the template with the given
   * wildcard string. Defaults to `"+"` (MQTT-style).
   */
  wildcardize(wildcard = "+"): string {
    return this.template.replace(/\{[^}]+\}/g, wildcard);
  }

  /**
   * Normalises a path by collapsing repeated separators and stripping a
   * trailing separator (unless the path is just the separator itself).
   */
  normalize(path: string): string {
    const sep = this.separator;
    const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Replace consecutive separators with a single one
    let result = path.replace(new RegExp(`${escapedSep}{2,}`, "g"), sep);

    // Strip trailing separator, but preserve a lone separator
    if (result.endsWith(sep) && result.length > sep.length) {
      result = result.slice(0, -sep.length);
    }

    return result;
  }
}
