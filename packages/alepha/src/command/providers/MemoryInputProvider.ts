import { ConsoleInputProvider } from "./ConsoleInputProvider.ts";

/**
 * Stdin from memory, for specs.
 *
 * ```ts
 * const alepha = Alepha.create()
 *   .with({ provide: ConsoleInputProvider, use: MemoryInputProvider });
 *
 * const input = alepha.inject(MemoryInputProvider);
 * input.content = "## Body\n";
 * ```
 *
 * Starts as a pipe that carries nothing, which is what an agent's shell tool
 * looks like when nothing was piped in. Set `tty` to stand in for a terminal.
 */
export class MemoryInputProvider extends ConsoleInputProvider {
  public content = "";

  public tty = false;

  /**
   * How many times stdin was read, so a spec can assert it was not.
   */
  public reads = 0;

  public override isTTY(): boolean {
    return this.tty;
  }

  public override async readAll(): Promise<string> {
    this.reads++;
    return this.content;
  }
}
