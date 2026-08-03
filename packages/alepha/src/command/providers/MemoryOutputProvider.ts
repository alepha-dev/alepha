import { ConsoleOutputProvider } from "./ConsoleOutputProvider.ts";

/**
 * Captures command output instead of writing it to stdout.
 *
 * Substitute it to assert on what a command produced:
 *
 * ```ts
 * const alepha = Alepha.create()
 *   .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
 *
 * const output = alepha.inject(MemoryOutputProvider);
 * expect(output.text).toContain("0.24.0");
 * ```
 *
 * Colour is stripped, matching what a caller piping the command would see —
 * the interesting case, and the one worth asserting against. Assertions do not
 * have to know which escape sequences a `ConsoleColorProvider` happened to
 * emit.
 */
export class MemoryOutputProvider extends ConsoleOutputProvider {
  public readonly lines: string[] = [];

  public override print(message = ""): void {
    this.lines.push(this.stripAnsi(message));
  }

  /**
   * Everything printed so far, joined the way stdout would have shown it.
   */
  public get text(): string {
    return this.lines.join("\n");
  }

  public clear(): void {
    this.lines.length = 0;
  }
}
