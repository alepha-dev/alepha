import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaServerSecurity } from "@alepha/server-security";
import { AppRouter } from "./AppRouter.ts";
import { PostController } from "./controllers/PostController.ts";
import { Sec } from "./providers/Sec.ts";

const app = Alepha.create();

app.with(AlephaReactAuth);
app.with(AlephaServerSecurity);
app.with(AppRouter);
app.with(PostController);
app.with(Sec);

run(app);
