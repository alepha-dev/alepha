import { describe, expect, it } from "vitest";
import { $inject, $module, Alepha } from "../src";

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
      server: { from: ["Alepha"] },
      core: { from: ["server"] },
      VeryRandomService: { from: ["RandomService", "core"], module: "core" },
      RandomService: { from: ["core"], module: "core" },
      database: { from: ["server"] },
      DatabaseService: { from: ["database"], module: "database" },
      ServerProvider: { from: ["server"], module: "server" },
      AlsProvider: {
        from: ["StateManager"],
      },
      EventManager: {
        from: ["StateManager"],
      },
      StateManager: {
        from: ["Alepha"],
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

  it("should be configurable", async ({ expect }) => {
    type MyServiceOptions = {
      name: string;
    };

    class MyService {
      options: MyServiceOptions = {
        name: "default",
      };
      hello() {
        return `Hello, ${this.options.name}`;
      }
    }

    const MyModule = $module<MyServiceOptions>({
      name: "my.module",
      services: [MyService],
      register: (alepha, options) => {
        alepha.with(MyService, options); // load only B explicitly
      },
    });

    const alepha = Alepha.create();
    alepha.with(MyModule, { name: "Alepha" });

    expect(alepha.inject(MyService).hello()).toBe("Hello, Alepha");
  });
});
