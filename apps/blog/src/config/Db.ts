import { $repository } from "@alepha/postgres";
import { comment, post, user } from "../entities.ts";

const $connection = (opts: any) => {
	return {};
};

export class Db {
	conn = $connection({
		url: "sqlite:memory",
		synchronize: true,
	});

	posts = $repository(post);
	users = $repository(user);
	comments = $repository(comment);
}
