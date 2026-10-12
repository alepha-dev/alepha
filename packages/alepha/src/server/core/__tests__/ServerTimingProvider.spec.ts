import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ServerTimingProvider } from "../index.ts";

class TestServerTimingProvider extends ServerTimingProvider {
  public get testPrefix(): string {
    return this.prefix;
  }
}

describe("ServerTimingProvider: metric name prefix", () => {
  it("should prefix with alepha.name lowercased", ({ expect }) => {
    const alepha = Alepha.create({ env: { APP_NAME: "Shop" } });
    expect(alepha.inject(TestServerTimingProvider).testPrefix).toBe("shop-");
  });

  it('should prefix with "app-" when no build ran and APP_NAME is unset', ({
    expect,
  }) => {
    expect(Alepha.create().inject(TestServerTimingProvider).testPrefix).toBe(
      "app-",
    );
  });

  it("should keep an explicit options.prefix", ({ expect }) => {
    const provider = Alepha.create().inject(TestServerTimingProvider);
    provider.options.prefix = "";
    expect(provider.testPrefix).toBe("");
  });
});
