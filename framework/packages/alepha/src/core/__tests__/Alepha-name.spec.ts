import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

/**
 * `alepha.name`, the namespace every module keys a shared resource with.
 *
 * Resolution order: `env.APP_NAME`, then the baked `meta.name`, then `"app"`.
 */
describe("Alepha.name", () => {
  const baked = (name: string) => {
    (globalThis as Record<string, unknown>).__ALEPHA_META__ = JSON.stringify({
      name,
      version: "0.27.1",
      build: { runtime: "node", dev: false },
      framework: "0.27.1",
    });
  };

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
    delete process.env.APP_NAME;
  });

  it('should be "app" when no build produced this code and APP_NAME is unset', ({
    expect,
  }) => {
    expect(Alepha.create().name).toBe("app");
  });

  it("should prefer APP_NAME given in code", ({ expect }) => {
    baked("shop");

    expect(Alepha.create({ env: { APP_NAME: "hello" } }).name).toBe("hello");
  });

  it("should prefer APP_NAME from process.env over the baked name", ({
    expect,
  }) => {
    baked("shop");
    process.env.APP_NAME = "shop-production";

    expect(Alepha.create().name).toBe("shop-production");
  });

  it("should prefer a binding lifted by loadEnv() over the baked name", ({
    expect,
  }) => {
    baked("shop");
    const alepha = Alepha.create();
    expect(alepha.name).toBe("shop");

    // A Worker binding arrives after create(): read on every call, it counts.
    alepha.loadEnv({ APP_NAME: "acme-shop-production" });

    expect(alepha.name).toBe("acme-shop-production");
  });

  it("should use the baked meta.name when APP_NAME is unset", ({ expect }) => {
    baked("shop");

    expect(Alepha.create().name).toBe("shop");
  });

  it("should ignore an empty APP_NAME", ({ expect }) => {
    baked("shop");

    expect(Alepha.create({ env: { APP_NAME: "" } }).name).toBe("shop");
  });

  it("should never write a default into env", ({ expect }) => {
    const alepha = Alepha.create();
    expect(alepha.name).toBe("app");

    expect(alepha.env.APP_NAME).toBeUndefined();
  });

  it("should keep the name verbatim", ({ expect }) => {
    expect(Alepha.create({ env: { APP_NAME: "My_App" } }).name).toBe("My_App");
  });
});
