import { $inject, $module, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("$module", () => {
  it("should create a module with services", () => {
    class VeryRandomService {}
    class RandomService {
      very = $inject(VeryRandomService);
    }
    const CoreModule = $module({
      name: "core",
      services: [RandomService, VeryRandomService],
    });

    class DatabaseService {}
    const DatabaseModule = $module({
      name: "database",
      services: [DatabaseService],
    });

    class ServerProvider {}
    const ServerModule = $module({
      name: "server",
      imports: [CoreModule, DatabaseModule],
      services: [ServerProvider],
    });

    const alepha = Alepha.create().with(ServerModule);

    expect(alepha.graph()).toEqual({
      VeryRandomService: { from: ["RandomService", "core"], module: "core" },
      RandomService: { from: ["core"], module: "core" },
      DatabaseService: { from: ["database"], module: "database" },
      ServerProvider: { from: ["server"], module: "server" },
      AlsProvider: {
        from: ["StateManager", "Alepha"],
        module: "alepha.core",
      },
      EventManager: {
        from: ["StateManager", "Alepha"],
        module: "alepha.core",
      },
      StateManager: {
        from: ["Alepha"],
        module: "alepha.core",
      },
      Json: {
        from: ["JsonSchemaCodec"],
        module: "alepha.core",
      },
      JsonSchemaCodec: {
        from: ["StateManager", "CodecManager"],
        module: "alepha.core",
      },
      CodecManager: {
        from: ["Alepha"],
        module: "alepha.core",
      },
      SchemaValidator: {
        from: ["StateManager", "CodecManager"],
        module: "alepha.core",
      },
    });
  });

  it("should auto inject all services and respect substitutions", async ({
    expect,
  }) => {
    let stack = "";

    class A {
      constructor() {
        stack += "A";
      }
      a = "a";
    }

    class A2 {
      constructor() {
        stack += "2";
      }
      a = "2";
    }

    class B {
      constructor() {
        stack += "B";
      }
    }

    const MyModule = $module({
      name: "my.module",
      services: [A, B],
    });

    // substitute BEFORE the module registers — services[] is now eagerly injected
    // at registration time, so substitutions must be in place first.
    const alepha = Alepha.create()
      .with({
        provide: A,
        use: A2,
      })
      .with(MyModule);

    // services[] is auto-injected at module registration time;
    // A is substituted by A2, B is instantiated directly. No A constructor call.
    expect(stack).toBe("2B");

    await alepha.start();

    expect(stack).toBe("2B");
    expect(alepha.inject(A).a).toBe("2");
  });

  it("should not instantiate variants, only the substituted one", async ({
    expect,
  }) => {
    let stack = "";

    class Provider {
      kind = "base";
    }
    class MemoryImpl extends Provider {
      constructor() {
        super();
        stack += "M";
      }
      kind = "memory";
    }
    class ProductionImpl extends Provider {
      constructor() {
        super();
        stack += "P";
      }
      kind = "prod";
    }

    const MyModule = $module({
      name: "my.variant.module",
      services: [Provider],
      variants: [MemoryImpl, ProductionImpl],
      register: (alepha) => {
        alepha.with({ provide: Provider, use: MemoryImpl });
      },
    });

    const alepha = Alepha.create().with(MyModule);
    await alepha.start();

    // only MemoryImpl should be constructed, ProductionImpl must never run
    expect(stack).toBe("M");
    expect(alepha.inject(Provider).kind).toBe("memory");
  });

  it("should run register() before imports, then auto-inject services", async ({
    expect,
  }) => {
    const order: string[] = [];

    class Inner {
      constructor() {
        order.push("inner-ctor");
      }
    }
    const InnerModule = $module({
      name: "inner",
      services: [Inner],
    });

    class Own {
      constructor() {
        order.push("own-ctor");
      }
    }
    const OuterModule = $module({
      name: "outer",
      imports: [InnerModule],
      services: [Own],
      register: () => {
        order.push("register");
      },
    });

    const alepha = Alepha.create().with(OuterModule);
    await alepha.start();

    expect(order).toEqual(["register", "inner-ctor", "own-ctor"]);
  });
});
