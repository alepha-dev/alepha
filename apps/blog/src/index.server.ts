import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog";
import { PostController } from "./controllers/PostController.ts";
import { Security } from "./providers/Security.ts";

const app = Alepha.create({
	env: {
		POSTGRES_SYNCHRONIZE: true,
		POSTGRES_SCHEMA: "blog",
	},
});

app.with(Blog);
app.with(PostController);
app.with(Security);

run(app);
