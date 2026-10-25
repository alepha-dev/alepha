import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("lifetime: scoped after start()", () => {
  it("resolves a scoped service inside a request fork after start()", async () => {
    class ScopedThing {
      marker = "scoped";
    }

    const alepha = Alepha.create();
    await alepha.start();

    // Regression: this previously threw ContainerLockedError because the
    // locked-container guard fired even though the instance is stored in the
    // per-request registry, never in the global container.
    const result = alepha.fork(() => {
      const a = alepha.inject(ScopedThing, { lifetime: "scoped" });
      const b = alepha.inject(ScopedThing, { lifetime: "scoped" });
      return { a, b };
    });

    expect(result.a).toBeInstanceOf(ScopedThing);
    // Same instance within one scope/fork.
    expect(result.a).toBe(result.b);
  });

  it("isolates scoped instances across different forks", async () => {
    class ScopedThing {}

    const alepha = Alepha.create();
    await alepha.start();

    const a = alepha.fork(() =>
      alepha.inject(ScopedThing, { lifetime: "scoped" }),
    );
    const b = alepha.fork(() =>
      alepha.inject(ScopedThing, { lifetime: "scoped" }),
    );

    // Different scope → different instance.
    expect(a).not.toBe(b);
  });
});
