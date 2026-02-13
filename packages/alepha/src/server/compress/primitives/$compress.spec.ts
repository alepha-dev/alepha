import { $pipeline, Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { describe, test } from "vitest";
import { AlephaServerCompress } from "../index.ts";
import { $compress } from "./$compress.ts";

// -----------------------------------------------------------------------------------------------------------------
// $compress — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$compress", () => {
  test("sets compress options in ALS context", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [$compress({ disabled: true })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const result = await svc.fn();
      expect(result).toBe("ok");

      // Verify the options were set in ALS
      const opts = alepha.context.get("alepha.server.compress.options");
      expect(opts).toEqual({ disabled: true });
    });
  });

  test("sets allowedContentTypes override", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [
          $compress({
            allowedContentTypes: ["application/pdf", "application/xml"],
          }),
        ],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      await svc.fn();
      const opts = alepha.context.get("alepha.server.compress.options");
      expect(opts).toEqual({
        allowedContentTypes: ["application/pdf", "application/xml"],
      });
    });
  });

  test("passes handler arguments through", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [$compress({ disabled: true })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      expect(await svc.fn(3, 4)).toBe(7);
    });
  });

  test("does not set options when called without arguments", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [$compress()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      await svc.fn();
      const opts = alepha.context.get("alepha.server.compress.options");
      expect(opts).toBeUndefined();
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $compress — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$compress metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [$compress({ disabled: true })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$compress");
    expect(meta[0].options).toEqual({ disabled: true });
  });

  test("has metadata with no options", ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCompress);

    class TestService {
      fn = $pipeline({
        use: [$compress()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$compress");
  });
});
