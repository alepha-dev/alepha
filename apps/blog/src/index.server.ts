import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog.ts";
import { PostController } from "./controllers/PostController.ts";
import { Security } from "./providers/Security.ts";

const substitute = <T extends object>(provide: T, use: T) => {
	return {
		provide,
		use,
	};
};

class MySecurity extends Security {
	a() {}
}

run(
	Alepha.create({
		name: "BlogServer",
		description: "Blog server module",
		version: "1.0.0",
		services: [Blog, PostController, substitute(Security, MySecurity)],
	}),
);
