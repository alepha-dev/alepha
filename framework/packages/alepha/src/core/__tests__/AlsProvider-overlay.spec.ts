import { Alepha } from "alepha";
import { describe, it } from "vitest";

/**
 * `overlay()` (#E86): a layer holding one value, invisible to writes and to
 * `"current"` / `"parent"` reads, so a traced callback behaves as an untraced
 * one.
 */
describe("AlsProvider overlay", () => {
  it("exposes its value inside the callback only", ({ expect }) => {
    const { context } = Alepha.create();
    context.run(() => {
      context.overlay("span", "a", () => {
        expect(context.get("span")).toBe("a");
        context.overlay("span", "b", () => {
          expect(context.get("span")).toBe("b");
        });
        expect(context.get("span")).toBe("a");
      });
      expect(context.get("span")).toBeUndefined();
    });
  });

  it("lets a write inside the callback land in the caller's layer", ({
    expect,
  }) => {
    const { context } = Alepha.create();
    context.run(() => {
      context.overlay("span", "a", () => {
        context.set("loaded", 1);
        expect(context.get("loaded", "current")).toBe(1);
      });
      expect(context.get("loaded")).toBe(1);
      expect(context.get("loaded", "current")).toBe(1);
    });
  });

  it("answers current and parent reads as if it were not there", ({
    expect,
  }) => {
    const { context } = Alepha.create();
    context.run(
      () => {
        context.run(
          () => {
            context.overlay("span", "a", () => {
              expect(context.get("inner", "current")).toBe("yes");
              expect(context.has("inner", "current")).toBe(true);
              expect(context.get("outer", "parent")).toBe("yes");
              expect(context.has("outer", "parent")).toBe(true);
            });
          },
          { inner: "yes" },
        );
      },
      { outer: "yes" },
    );
  });

  it("keeps concurrent overlays apart", async ({ expect }) => {
    const { context } = Alepha.create();
    const seen: string[] = [];
    await context.run(() =>
      Promise.all(
        ["x", "y"].map((value) =>
          context.overlay("span", value, async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            seen.push(context.get<string>("span")!);
          }),
        ),
      ),
    );
    expect(seen.toSorted()).toEqual(["x", "y"]);
  });

  it("opens a real layer outside any context, so the value has a home", ({
    expect,
  }) => {
    const { context } = Alepha.create();
    context.overlay("span", "a", () => {
      expect(context.get("span")).toBe("a");
    });
  });
});
