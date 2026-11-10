/**
 * One source file as the runner hands it to a rule: parsed once, read by
 * every rule that applies to it.
 */
export interface ConventionFile {
  /**
   * Absolute path, as `FileSystemProvider` reads it.
   */
  path: string;

  /**
   * Path relative to the run's root, with `/` separators. What a rule's
   * {@link ConventionRule.appliesTo} reads, and what a finding prints.
   */
  relativePath: string;

  /**
   * The file's text.
   */
  source: string;

  /**
   * Line and column (both 1-based) of a character offset into
   * {@link source}, the unit the parser's `start` and `end` are in.
   */
  locate(offset: number): { line: number; column: number };
}

/**
 * What a rule reports: where, and optionally a sentence more precise than the
 * rule's own {@link ConventionRule.description}.
 */
export interface ConventionRuleFinding {
  line: number;
  column: number;
  message?: string;
}

/**
 * A convention `alepha check` enforces over an app's own source.
 *
 * A rule is a class registered in the CLI container, so it is listed by
 * `ConventionRegistry`, tested on `MemoryFileSystemProvider` and substituted
 * like any other service: a project that needs a rule to read more
 * directories registers a subclass in its place.
 *
 * The runner parses each file once (ESTree, from the parser Vite ships) and
 * hands the program to every rule whose {@link appliesTo} accepts the path.
 * Comments and string contents are not code in that tree, so a rule never
 * needs to strip literals the way a grep does.
 */
export abstract class ConventionRule {
  /**
   * Kebab-case, unique, printed beside every finding and used in
   * `// alepha-allow <id>: <reason>` and in the config's `check.rules`.
   */
  public abstract readonly id: string;

  /**
   * What the rule refuses and why, in a sentence: printed under a finding
   * that carries no message of its own, and listed by `alepha check --list`.
   */
  public abstract readonly description: string;

  /**
   * The replacement to write, in one sentence: printed under every finding,
   * because the reader is as often an agent as a person.
   */
  public abstract readonly fix: string;

  /**
   * Whether this rule reads the file at all. The path is relative to the
   * run's root, with `/` separators.
   */
  public abstract appliesTo(relativePath: string): boolean;

  /**
   * The violations in one file. `program` is the ESTree `Program` node.
   */
  public abstract check(
    file: ConventionFile,
    program: any,
  ): ConventionRuleFinding[] | Promise<ConventionRuleFinding[]>;

  /**
   * Whether a path is a test: a spec file, or anything under a `__tests__/`,
   * `test/`, `e2e/` or `fixtures/` directory.
   */
  protected isTestPath(relativePath: string): boolean {
    return (
      this.isSpecFile(relativePath) ||
      /(^|\/)(__tests__|test|tests|e2e|fixtures)\//.test(relativePath)
    );
  }

  /**
   * Whether a path is a spec file by name (`*.spec.ts(x)`, `*.test.ts(x)`).
   */
  protected isSpecFile(relativePath: string): boolean {
    return /\.(spec|test)\.tsx?$/.test(relativePath);
  }

  /**
   * Depth-first walk over every node of an ESTree program. `parents` is the
   * chain from the program down to the node's parent, nearest last.
   */
  protected walk(
    node: any,
    visit: (node: any, parents: any[]) => void,
    parents: any[] = [],
  ): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        this.walk(child, visit, parents);
      }
      return;
    }
    if (typeof node.type !== "string") {
      return;
    }
    visit(node, parents);
    const chain = [...parents, node];
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") {
        continue;
      }
      const value = node[key];
      if (value && typeof value === "object") {
        this.walk(value, visit, chain);
      }
    }
  }

  /**
   * A finding at a node's start.
   */
  protected at(
    file: ConventionFile,
    node: { start: number },
    message?: string,
  ): ConventionRuleFinding {
    return { ...file.locate(node.start), message };
  }

  /**
   * The name of an identifier, or of a member expression's property when it
   * is not computed (`a.b` gives `b`); `undefined` otherwise.
   */
  protected nameOf(node: any): string | undefined {
    if (node?.type === "Identifier") {
      return node.name;
    }
    if (node?.type === "MemberExpression" && !node.computed) {
      return node.property?.name;
    }
    return undefined;
  }

  /**
   * Whether `node` is the member access `object.property`, with `object` an
   * identifier (`Date.now`), or `globalThis.object.property`.
   */
  protected isMember(node: any, object: string, property: string): boolean {
    if (node?.type !== "MemberExpression" || node.computed) {
      return false;
    }
    if (node.property?.name !== property) {
      return false;
    }
    const target = node.object;
    if (target?.type === "Identifier") {
      return target.name === object;
    }
    return (
      target?.type === "MemberExpression" &&
      !target.computed &&
      target.object?.type === "Identifier" &&
      target.object.name === "globalThis" &&
      target.property?.name === object
    );
  }
}
