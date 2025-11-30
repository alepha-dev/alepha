export const mainBrowserTs = () => `
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
`.trim()
