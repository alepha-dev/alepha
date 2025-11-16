import { AlephaReactHead } from "@alepha/react/head";
import { AlephaUI } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AppRouter);
alepha.with(AlephaUI);
alepha.with(AlephaReactHead);

run(alepha);
