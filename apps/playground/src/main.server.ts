import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";
import { AppSecurity } from "./AppSecurity.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);
alepha.with(AppSecurity);

run(alepha);
