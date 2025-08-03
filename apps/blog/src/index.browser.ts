import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AppRouter } from "./AppRouter.ts";

const app = Alepha.create();

app.with(AppRouter);
app.with(AlephaReactAuth);

run(app);
