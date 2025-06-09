import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog";
import { PostController } from "./controllers/PostController.ts";
import { Security } from "./providers/Security.ts";

const alepha = Alepha.create({
	env: {
		LOG_LEVEL: "trace",
		POSTGRES_SYNCHRONIZE: true,
		POSTGRES_SCHEMA: "blog",
	},
});

alepha.with(Blog);
alepha.with(PostController);
alepha.with(Security);

run(alepha);
