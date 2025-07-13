import { Alepha, run } from "@alepha/core";
import { AlephaReact } from "@alepha/react";
import { AlephaReactHead } from "@alepha/react-head";
import { App } from "./App.tsx";

const alepha = Alepha.create();

alepha.with(AlephaReact);
alepha.with(AlephaReactHead);
alepha.with(App);

run(alepha);
