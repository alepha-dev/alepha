import {
  type ConventionFile,
  ConventionRule,
  type ConventionRuleFinding,
} from "./ConventionRule.ts";

/**
 * `no-vi-mock`: refuses `vi.mock`, `vi.doMock`, `vi.spyOn`,
 * `vi.useFakeTimers` and `vi.setSystemTime` in test code.
 *
 * Each of these replaces something global behind the container's back: a
 * module, a method, the clock. Alepha's services are substitutable through
 * the container instead (`.with({ provide: X, use: MemoryX })`), and time is
 * `DateTimeProvider`, which `travel()` and `pause()` move without touching
 * the process. A spec written that way exercises the wiring the app runs.
 *
 * The list is closed:
 *
 * - `vi.fn()` is NOT refused: a callback stub passed as an argument
 *   substitutes nothing global.
 * - `vi.stubGlobal`, `vi.stubEnv` and `vi.useRealTimers` are NOT refused:
 *   there is no Alepha replacement to name for a browser global (`open`,
 *   `fetch` in a jsdom spec).
 *
 * Reads test code only: `*.spec.*`, `*.test.*` and anything under
 * `__tests__/`, `test/`, `tests/`, `e2e/` or `fixtures/`.
 */
export class NoViMockRule extends ConventionRule {
  public readonly id = "no-vi-mock";
  public readonly description =
    "A vi mock replaces a module, a method or the clock behind the container's back.";
  public readonly fix =
    "Substitute the service: Alepha.create().with({ provide: X, use: MemoryX }). For time, alepha.inject(DateTimeProvider).travel().";

  /**
   * The `vi` members refused, and nothing else.
   */
  protected readonly refused = new Set([
    "mock",
    "doMock",
    "spyOn",
    "useFakeTimers",
    "setSystemTime",
  ]);

  public appliesTo(relativePath: string): boolean {
    return this.isTestPath(relativePath);
  }

  public check(file: ConventionFile, program: any): ConventionRuleFinding[] {
    const findings: ConventionRuleFinding[] = [];
    this.walk(program, (node) => {
      const callee = node.type === "CallExpression" ? node.callee : undefined;
      if (
        callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.object?.type === "Identifier" &&
        callee.object.name === "vi" &&
        this.refused.has(callee.property?.name)
      ) {
        findings.push(
          this.at(file, node, `vi.${callee.property.name}() ${this.reason()}`),
        );
      }
    });
    return findings;
  }

  protected reason(): string {
    return "replaces a module, a method or the clock behind the container's back.";
  }
}
