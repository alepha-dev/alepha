import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { Blog } from "./Blog";

const app = Alepha.create();

app.with(Blog);
app.with(AlephaReactAuth);

run(app);
