import { Alepha, run } from "@alepha/core";
import { App } from "./app/App.ts";

const alepha = Alepha.create();

alepha.with(App);

run(alepha);
