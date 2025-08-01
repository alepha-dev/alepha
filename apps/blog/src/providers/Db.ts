import { $repository } from "@alepha/postgres";
import { comment, post, user } from "../entities.ts";

export class Db {
	posts = $repository(post);
	users = $repository(user);
	comments = $repository(comment);
}
