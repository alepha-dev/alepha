import { AbortedError, Alepha } from "alepha";
import { describe, it } from "vitest";

import { NodeShellProvider } from "../providers/NodeShellProvider.ts";
import { ShellProvider } from "../providers/ShellProvider.ts";

/**
 * A command inherits the ambient signal (#E85): the child is killed when the
 * unit of work that started it is aborted, without a `signal` option.
 */
describe("NodeShellProvider ambient signal", () => {
  const create = () =>
    Alepha.create().with({ provide: ShellProvider, use: NodeShellProvider });

  it("kills the child when the ambient signal aborts", async ({ expect }) => {
    const alepha = create();
    const shell = alepha.inject(ShellProvider);
    const unit = new AbortController();

    const startedAt = performance.now();
    const run = alepha.context.run(() => shell.run(["sleep", "5"]), {
      signal: unit.signal,
    });
    setTimeout(() => unit.abort(new AbortedError("request gone")), 50);

    const error = await run.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(performance.now() - startedAt).toBeLessThan(2000);
    expect(alepha.context.isAbortError(error, unit.signal)).toBe(true);
  });

  it("kills a captured command too, and the explicit signal still works", async ({
    expect,
  }) => {
    const alepha = create();
    const shell = alepha.inject(ShellProvider);
    const explicit = new AbortController();

    const run = alepha.context.run(
      () => shell.capture(["sleep", "5"], { signal: explicit.signal }),
      { signal: new AbortController().signal },
    );
    setTimeout(() => explicit.abort(new AbortedError("caller gave up")), 50);

    const error = await run.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(alepha.context.isAbortError(error, explicit.signal)).toBe(true);
  });

  it("runs to completion when nothing aborts", async ({ expect }) => {
    const alepha = create();
    const shell = alepha.inject(ShellProvider);

    const out = await alepha.context.run(
      () => shell.run(["echo", "still here"], { capture: true }),
      { signal: new AbortController().signal },
    );
    expect(out.trim()).toBe("still here");
  });
});
