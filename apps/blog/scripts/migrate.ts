import { run } from "@alepha/core";
import { Db } from "../src/providers/Db.ts";

run(Db, {
	once: true,
	env: {
		POSTGRES_SYNCHRONIZE: false,
	},
});
