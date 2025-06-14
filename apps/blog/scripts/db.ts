import { $hook, $inject, run } from "@alepha/core";
import { DrizzleKitProvider, PostgresProvider } from "@alepha/postgres";
import { Database } from "../src/providers/Database.ts";

class App {
	db = $inject(Database);
	pg = $inject(PostgresProvider);
	kit = $inject(DrizzleKitProvider);

	ready = $hook({
		name: "ready",
		handler: async () => {
			if (process.argv.includes("--push")) {
				await this.kit.push(this.pg);
			}

			if (process.argv.includes("--generate")) {
				await this.kit.generate(this.pg);
			}
		},
	});
}

run(App, {
	once: true,
});
