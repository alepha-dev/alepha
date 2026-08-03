import { Alepha } from "alepha";
import {
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  RawFormatterProvider,
} from "alepha/logger";
import { $secure } from "alepha/security";
import { describe, expect, it } from "vitest";
import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";

/**
 * `$secure` on a page is a trap worth naming out loud.
 *
 * It is a handler middleware: on a page it wraps the `loader`, and in the browser
 * it short-circuits by returning `undefined` instead of throwing. The loader is
 * skipped and the page renders regardless — which on a back office means the whole
 * shell over empty tables. The combination is not an error (a page may want its
 * loader skipped for anonymous visitors), so the framework warns rather than
 * refuses, and the warning has to actually name the alternative.
 */
/*
 * Substitutions first, module second — the order is load-bearing.
 *
 * `.with(AlephaReactRouter)` wires the module, which instantiates the logger on
 * the way, and a substitution registered after that raises
 * `TooLateSubstitutionError`. The router module is needed at all because the check
 * under test lives in `ReactPageProvider`'s `configure` hook, and without the
 * module nothing instantiates it.
 */
const setup = () =>
  Alepha.create({ env: { LOG_LEVEL: "trace" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: LogFormatterProvider, use: RawFormatterProvider })
    .with(AlephaReactRouter);

describe("$page + $secure", () => {
  it("warns that the page still renders, and points at Redirection", async () => {
    const alepha = setup();

    class GuardedRouter {
      admin = $page({
        path: "/admin",
        use: [$secure({ permissions: ["admin:ui"] })],
        component: () => null,
      });
    }

    alepha.inject(GuardedRouter);
    await alepha.start();

    const memory = alepha.inject(MemoryDestinationProvider);
    const warning = memory.logs.find(
      (entry) => entry.level === "WARN" && entry.message.includes("/admin"),
    );

    expect(warning).toBeDefined();
    // The two things the reader needs: what is not happening, and what to do.
    expect(warning?.message).toContain("does not prevent it from rendering");
    expect(warning?.message).toContain("Redirection");
  });

  it("stays quiet for a page with no guard", async () => {
    const alepha = setup();

    class PlainRouter {
      home = $page({ path: "/", component: () => null });
    }

    alepha.inject(PlainRouter);
    await alepha.start();

    const memory = alepha.inject(MemoryDestinationProvider);
    const warnings = memory.logs.filter(
      (entry) => entry.level === "WARN" && entry.message.includes("$secure"),
    );

    expect(warnings).toHaveLength(0);
  });
});
