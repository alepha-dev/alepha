import { Alepha, run } from "@alepha/core";
import { Database } from "../src/providers/Database.ts";

const app = Alepha.create({
	env: {
		POSTGRES_PUSH_SCHEMA: true,
	},
});

run(app.with(Database), {
	once: true,
});
