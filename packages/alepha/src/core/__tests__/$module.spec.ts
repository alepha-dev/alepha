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
      services: [CoreModule, DatabaseModule, ServerProvider],
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
      KeylessJsonSchemaCodec: {
        from: ["CodecManager"],
        module: "alepha.core",
      },
      CodecManager: {
        from: ["Alepha"],
        module: "alepha.core",
      },
      SchemaValidator: {
        from: ["CodecManager"],
        module: "alepha.core",
      },
    });
  });

  it("should auto inject all dependencies", async ({ expect }) => {
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

    // note: we do not need to import MyModule,
    // it will be registered automatically if A or B is injected
    const MyModule = $module({
      name: "my.module",
      services: [A, B],
      register: (alepha) => {
        alepha.with(B); // load only B explicitly
      },
    });

    const alepha = Alepha.create();

    // substitute A with A2
    alepha.with({
      provide: A,
      use: A2, // A2 will inherit of A's module
    });

    // should not be activated yet
    expect(stack).toBe("");

    // but now, we start, so all substitutions are applied
    await alepha.start();

    expect(stack).toBe("B2");
    expect(alepha.inject(A).a).toBe("2");
  });
});
