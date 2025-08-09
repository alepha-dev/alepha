import { expect, test } from "vitest";
import { $inject, $module, Alepha } from "../src";

test("module", () => {
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
	});
});
