import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

describe("stable service ids", () => {
  it("resolves an inherited id after the registered class is renamed", ({
    expect,
  }) => {
    class PublicService {
      static readonly id: string = "test.PublicService";
    }
    class a extends PublicService {}
    const alepha = Alepha.create().with(a);
    expect(a.name).not.toBe(PublicService.name);
    expect(alepha.inject(PublicService.id)).toBe(alepha.inject(a));
    expect(() => alepha.inject(a.name)).toThrow(AlephaError);
    expect(() => alepha.inject(PublicService.name)).toThrow(
      "Service not found: PublicService",
    );
  });

  it("names an unknown id in the error", ({ expect }) => {
    const alepha = Alepha.create();
    expect(() => alepha.inject("test.missing")).toThrow(
      "Service not found: test.missing",
    );
  });
});
