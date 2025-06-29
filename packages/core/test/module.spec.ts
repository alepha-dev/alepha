import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";

test("module", () => {
	class VeryRandomService {}
	class RandomService {
		very = $inject(VeryRandomService);
	}
	class CoreModule {
		$services = (alepha: Alepha) => alepha.with(RandomService);
	}
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
		CoreModule: { from: ["ServerModule"], module: "core" },
		VeryRandomService: { from: ["RandomService"], module: "core" },
		RandomService: { from: ["CoreModule"], module: "core" },
		DatabaseModule: { from: ["ServerModule"], module: "database" },
		DatabaseService: { from: ["DatabaseModule"], module: "database" },
		ServerProvider: { from: ["ServerModule"], module: "server" },
	});
});
