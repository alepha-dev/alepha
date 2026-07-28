import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { NodeShellProvider } from "../providers/NodeShellProvider.ts";

/**
 * The string form of `shell.run()` passes every token through as a LITERAL
 * argument on both runtimes. Shell metacharacters do not compose commands —
 * that is the whole point of the POSIX single-quote escaping: `;`, backticks,
 * `$(...)` and `|` cannot break out of an argument.
 *
 * Review #2 recorded this as a Node-vs-Bun divergence ("shell features work on
 * Node, break on Bun"). That was true when it was written and stopped being
 * true when the escaping landed in its own third fix pass: Node now treats them
 * as literals too. `BunShellProvider.bun.spec.ts` asserts the same table, so
 * the two runtimes are pinned to one contract.
 *
 * Callers that need a pipeline should say so explicitly (`sh -c "a | b"`), and
 * callers passing untrusted values should use the argv form.
 */
const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const shell = alepha.inject(NodeShellProvider);
  await alepha.start();
  return shell;
};

describe("shell.run(string) — literal argument contract", () => {
  it("does not treat && as a command separator", async () => {
    const shell = await setup();
    const out = await shell.run("echo hello && echo world", { capture: true });
    expect(out.trim()).toBe("hello && echo world");
  });

  it("does not treat | as a pipe", async () => {
    const shell = await setup();
    const out = await shell.run("echo a | tr a b", { capture: true });
    expect(out.trim()).toBe("a | tr a b");
  });

  it("does not expand environment variables", async () => {
    const shell = await setup();
    const out = await shell.run("echo $HOME", { capture: true });
    expect(out.trim()).toBe("$HOME");
  });

  it("does not evaluate command substitution", async () => {
    const shell = await setup();
    const out = await shell.run("echo $(id -u)", { capture: true });
    expect(out.trim()).toBe("$(id -u)");
  });

  it("does not treat ; as a separator", async () => {
    const shell = await setup();
    const out = await shell.run("echo one ; echo two", { capture: true });
    expect(out.trim()).toBe("one ; echo two");
  });

  it("keeps quoted arguments together", async () => {
    const shell = await setup();
    const out = await shell.run('echo "one two"', { capture: true });
    expect(out.trim()).toBe("one two");
  });

  it("runs a pipeline only when the caller asks for a shell explicitly", async () => {
    const shell = await setup();
    const out = await shell.run(["sh", "-c", "echo a | tr a b"], {
      capture: true,
    });
    expect(out.trim()).toBe("b");
  });
});
