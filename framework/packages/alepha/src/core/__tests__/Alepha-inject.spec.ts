import { randomUUID } from "node:crypto";

import { $inject, Alepha, AlephaError, MissingContextError } from "alepha";
import { describe, it } from "vitest";

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
   * so a by-id lookup for the substituted base class must follow the
   * substitution exactly as an inject-by-class does. The generated Cloudflare
   * worker entry injects `"alepha.websocket.WebSocketServerProvider"` by id while the
   * websocket module registers it as `{ provide: WebSocketServerProvider,
   * use: CloudflareDurableObjectWebSocketServerProvider }`, without the
   * fallback every WebSocket upgrade on workerd died with
   * `Service not found: WebSocketServerProvider`.
   */
  it("should resolve a substituted service by id", ({ expect }) => {
    class BaseProvider {
      public static readonly id: string = "test.BaseProvider";
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

    const byId = alepha.inject<BaseProvider>("test.BaseProvider");
    expect(byId).toBeInstanceOf(EdgeProvider);
    expect(byId.who()).toBe("edge");

    // Same singleton as the class-keyed path.
    expect(byId).toBe(alepha.inject(BaseProvider));
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

  it("should pass constructor args correctly", ({ expect }) => {
    class Logger {
      public a: string;

      constructor(a: string) {
        this.a = a;
      }
    }

    const alepha = new Alepha();

    expect(alepha.inject(Logger, { args: ["a"] }).a).toBe("a");
    expect(alepha.inject(Logger).a).toBe("a");
  });

  it("should inject Alepha instance itself", ({ expect }) => {
    const alepha = new Alepha();

    expect(alepha.inject(Alepha)).toBe(alepha);
  });

  it("should keep building a service that creates another container in a field", ({
    expect,
  }) => {
    class Dep {}
    class Outer {
      inner = new Alepha();
      dep = $inject(Dep);
    }
    class Created {
      inner = Alepha.create();
      dep = $inject(Dep);
    }

    const alepha = new Alepha();
    const outer = alepha.inject(Outer);
    expect(outer.dep).toBe(alepha.inject(Dep));
    expect(outer.inner).not.toBe(alepha);
    expect(alepha.inject(Created).dep).toBe(alepha.inject(Dep));

    // Once the outer construction is over, the cursor is cleared again.
    expect(() => $inject(Dep)).toThrow(MissingContextError);
  });

  it("should hand the cursor back to the outer container when the inner one throws", ({
    expect,
  }) => {
    class Dep {}
    class Broken {
      constructor() {
        throw new AlephaError("broken");
      }
    }
    class Outer {
      failed = false;
      dep: Dep;
      constructor() {
        try {
          new Alepha().inject(Broken);
        } catch {
          this.failed = true;
        }
        this.dep = $inject(Dep);
      }
    }

    const alepha = new Alepha();
    const outer = alepha.inject(Outer);
    expect(outer.failed).toBe(true);
    expect(outer.dep).toBe(alepha.inject(Dep));
  });
});
