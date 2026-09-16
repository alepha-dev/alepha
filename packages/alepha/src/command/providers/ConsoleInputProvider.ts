/**
 * What a command reads from stdin, as a seam a spec can substitute.
 *
 * The one reader today is a flag value of `@-` (see `CliProvider`), which
 * takes the whole of stdin as the value. Reading `node:process` inline would
 * leave a spec two choices, both bad: pipe into its own test runner, or never
 * cover the refusals at all. Substitute {@link MemoryInputProvider} instead.
 *
 * `process` is read inside the methods, never at module level: this module is
 * part of `alepha/command`, which a workerd bundle can reach, and a
 * module-level `process.stdin` throws there.
 */
export class ConsoleInputProvider {
  /**
   * Whether stdin is attached to a terminal.
   *
   * A terminal means nobody piped anything, and a read would wait on a
   * keyboard that may have nobody at it.
   */
  public isTTY(): boolean {
    if (typeof process !== "object") return false;
    return !!process.stdin?.isTTY;
  }

  /**
   * Read stdin to its end, as UTF-8.
   *
   * Resolves `""` where there is no stdin at all.
   */
  public async readAll(): Promise<string> {
    if (typeof process !== "object" || !process.stdin) return "";

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
