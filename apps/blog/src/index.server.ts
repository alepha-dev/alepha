import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog";
import { PostController } from "./api/PostController.ts";
import { Security } from "./config/Security.ts";

const alepha = Alepha.create({
	env: {
		POSTGRES_SYNCHRONIZE: true,
		POSTGRES_SCHEMA: "blog",
	},
});

alepha.with(Blog);
alepha.with(PostController);
alepha.with(Security);

run(alepha);
