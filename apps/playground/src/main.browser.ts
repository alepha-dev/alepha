import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactHead } from "@alepha/react/head";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactHead);
alepha.with(AlephaReactAuth);
alepha.with(AppRouter);

run(alepha);
