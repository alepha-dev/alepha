import { describe, expect, test } from "vitest";
import { $inject, Alepha, Module } from "../src";

describe("Module", () => {
	test("should create a module with services", () => {
		class VeryRandomService {}
		class RandomService {
			very = $inject(VeryRandomService);
		}

		class CoreModule extends Module {
			services = [RandomService, VeryRandomService];
		}

		class DatabaseService {}

		class DatabaseModule extends Module {
			services = [DatabaseService];
		}

		class ServerProvider {}

		class ServerModule extends Module {
			services = [CoreModule, DatabaseModule, ServerProvider];
		}

		const alepha = Alepha.create().with(ServerModule);

		expect(alepha.graph()).toEqual({
			server: { from: ["Alepha"] },
			core: { from: ["server"] },
			VeryRandomService: { from: ["RandomService", "core"], module: "core" },
			RandomService: { from: ["core"], module: "core" },
			database: { from: ["server"] },
			DatabaseService: { from: ["database"], module: "database" },
			ServerProvider: { from: ["server"], module: "server" },
		});
	});

	test("should auto inject all dependencies", async ({ expect }) => {
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
		class MyModule extends Module {
			name = "my.module";
			services = [A, B];

			register() {
				this.alepha.with(B); // load only B explicitly
			}
		}

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
