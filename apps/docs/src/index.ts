import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { App } from "./App.tsx";

const alepha = Alepha.create();

alepha.with(App);
alepha.with(AlephaReactHead);

run(alepha);
