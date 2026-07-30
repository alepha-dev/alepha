import { Alepha, run } from "alepha";
import { AppRouter } from "./web/AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
