import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("Alepha#inject", () => {
  it("should handle transient lifetime", ({ expect }) => {
    class Logger {
      id = randomUUID();
    }

    const alepha = new Alepha();

    expect(alepha.inject(Logger, { lifetime: "transient" }).id).not.toBe(
      alepha.inject(Logger, { lifetime: "transient" }).id,
    );

    const log = alepha.inject(Logger);

    expect(log.id).toBe(alepha.inject(Logger).id);

    expect(alepha.inject(Logger, { lifetime: "transient" }).id).not.toBe(
      log.id,
    );
  });

  it("should handle transient lifetime with substitution", ({ expect }) => {
    class BaseLogger {
      print(msg: string): string {
        return msg;
      }
    }

    class EmojiLogger extends BaseLogger {
      print(msg: string): string {
        return `${msg}😊`;
      }
    }

    const alepha = new Alepha().with({
      provide: BaseLogger,
      use: EmojiLogger,
    });

    const log = alepha.inject(BaseLogger, { lifetime: "transient" });

    expect(log).toBeInstanceOf(EmojiLogger);
    expect(log.print("Hello")).toBe("Hello😊");

    expect(alepha.has(BaseLogger)).toBe(true);

    // no trace of EmojiLogger in Alepha
    expect(alepha.has(EmojiLogger)).toBe(false);
    expect(alepha.has(BaseLogger, { inSubstitutions: false })).toBe(false);
  });

  /**
   * A `provide`/`use` substitution keys the registry by the SUBSTITUTE class,
   * so a by-name lookup for the substituted base class must follow the
   * substitution exactly as an inject-by-class does. The generated Cloudflare
   * worker entry injects `"WebSocketServerProvider"` by name while the
   * websocket module registers it as `{ provide: WebSocketServerProvider,
   * use: CloudflareDurableObjectWebSocketServerProvider }` — without the
   * fallback every WebSocket upgrade on workerd died with
   * `Service not found: WebSocketServerProvider`.
   */
  it("should resolve a substituted service by name", ({ expect }) => {
    class BaseProvider {
      who(): string {
        return "base";
      }
    }

    class EdgeProvider extends BaseProvider {
      who(): string {
        return "edge";
      }
    }

    const alepha = new Alepha().with({
      provide: BaseProvider,
      use: EdgeProvider,
    });

    const byName = alepha.inject<BaseProvider>("BaseProvider");
    expect(byName).toBeInstanceOf(EdgeProvider);
    expect(byName.who()).toBe("edge");

    // Same singleton as the class-keyed path.
    expect(byName).toBe(alepha.inject(BaseProvider));
  });

  it("should handle scoped lifetime", ({ expect }) => {
    class Request {
      id = randomUUID();
    }

    const alepha = new Alepha();

    const base = alepha.inject(Request, { lifetime: "scoped" });

    expect(alepha.inject(Request, { lifetime: "scoped" }).id).toBe(base.id);

    alepha.context.run(() => {
      expect(alepha.inject(Request, { lifetime: "scoped" }).id).not.toBe(
        base.id,
      );
      expect(alepha.inject(Request, { lifetime: "scoped" }).id).toBe(
        alepha.inject(Request, { lifetime: "scoped" }).id,
      );
    });
  });

  it("should pass constructor args correctly", () => {
    class Logger {
      constructor(public a: string) {}
    }

    const alepha = new Alepha();

    expect(alepha.inject(Logger, { args: ["a"] }).a).toBe("a");
    expect(alepha.inject(Logger).a).toBe("a");
  });

  it("should inject Alepha instance itself", () => {
    const alepha = new Alepha();

    expect(alepha.inject(Alepha)).toBe(alepha);
  });
});
