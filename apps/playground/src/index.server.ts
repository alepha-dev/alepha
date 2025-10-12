import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { Api } from "./Api.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactHead);
alepha.with(AppRouter);
alepha.with(Api);

run(alepha);
