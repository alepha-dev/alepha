import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AppRouter);
alepha.with(AlephaReactHead);

run(alepha);
