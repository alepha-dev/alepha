import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog.ts";
import { PostController } from "./controllers/PostController.ts";
import { Security } from "./providers/Security.ts";

const app = Alepha.create();

app.with(Blog);
app.with(PostController);
app.with(Security);

run(app);
