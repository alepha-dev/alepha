import { expect, test } from "vitest";
import { $inject, $module, Alepha } from "../src";

test("module", () => {
	class VeryRandomService {}
	class RandomService {
		very = $inject(VeryRandomService);
	}
	const CoreModule = $module({
		name: "core",
		register: (alepha: Alepha) => alepha.with(RandomService),
	});
	class DatabaseService {}
	class DatabaseModule {
		$services = (alepha: Alepha) => alepha.with(DatabaseService);
	}
	class ServerProvider {}
	class ServerModule {
		$services = (alepha: Alepha) =>
			alepha.with(CoreModule).with(DatabaseModule).with(ServerProvider);
	}

	const alepha = Alepha.create().with(ServerModule);

	expect(alepha.graph()).toEqual({
		ServerModule: { from: ["Alepha"], module: "server" },
		core: { from: ["ServerModule"], module: "core" },
		VeryRandomService: { from: ["RandomService"], module: "core" },
		RandomService: { from: ["core"], module: "core" },
		DatabaseModule: { from: ["ServerModule"], module: "database" },
		DatabaseService: { from: ["DatabaseModule"], module: "database" },
		ServerProvider: { from: ["ServerModule"], module: "server" },
	});
});
