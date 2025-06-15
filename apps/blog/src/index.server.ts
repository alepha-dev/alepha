import { Alepha, run } from "@alepha/core";
import { Blog } from "./Blog.ts";
import { PostController } from "./controllers/PostController.ts";

const app = Alepha.create();

app.with(Blog);
app.with(PostController);

run(app);
