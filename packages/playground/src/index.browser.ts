import { Alepha, run } from "@alepha/core";
import { ReactAuthModule } from "@alepha/react-auth";
import { App } from "./App.ts";

const alepha = Alepha.create({});

alepha.with(App).with(ReactAuthModule);

run(alepha);
