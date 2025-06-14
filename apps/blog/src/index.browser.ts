import { Alepha, run } from "@alepha/core";
import { ReactAuthModule } from "@alepha/react-auth";
import { Blog } from "./Blog";

const app = Alepha.create();

app.with(Blog);
app.with(ReactAuthModule);

run(app);
