import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
