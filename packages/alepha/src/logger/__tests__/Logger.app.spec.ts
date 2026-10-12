import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import {
  $logger,
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "../index.ts";

/**
 * The `app` field of a log entry is `alepha.name`, except the no-build "app".
 */
describe("Logger: the app field", () => {
  class App {
    log = $logger();
  }

  const boot = (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "trace", ...env } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    const output = alepha.inject(MemoryDestinationProvider);
    return { alepha, log: alepha.inject(App).log, output };
  };

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ALEPHA_META__;
  });

  it("should carry APP_NAME", ({ expect }) => {
    const { log, output } = boot({ APP_NAME: "shop-production" });
    log.info("hello");
    expect(output.logs[0].app).toBe("shop-production");
  });

  it("should carry the baked build name when APP_NAME is unset", ({
    expect,
  }) => {
    (globalThis as Record<string, unknown>).__ALEPHA_META__ = JSON.stringify({
      name: "shop",
      version: "latest",
      build: { runtime: "node", dev: false },
      framework: "0.31.0",
    });
    const { log, output } = boot();
    log.info("hello");
    expect(output.logs[0].app).toBe("shop");
  });

  it('should omit the no-build "app" fallback', ({ expect }) => {
    const { log, output } = boot();
    log.info("hello");
    expect(output.logs[0].app).toBeUndefined();
  });

  it("should read the name per entry, so a binding lifted after construction counts", ({
    expect,
  }) => {
    const { alepha, log, output } = boot();
    log.info("before");
    alepha.loadEnv({ APP_NAME: "acme-shop-production" });
    log.info("after");
    expect(output.logs.map((it) => it.app)).toEqual([
      undefined,
      "acme-shop-production",
    ]);
  });
});
