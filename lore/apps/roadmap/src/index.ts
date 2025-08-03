import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaServerSecurity } from "@alepha/server-security";
import { App } from "./App.ts";

const alepha = Alepha.create();

alepha.with(AlephaServerSecurity);
alepha.with(AlephaReactAuth);
alepha.with(App);

if (import.meta.env.SSR) {
	alepha.with(await import("./api/TaskApi.ts"));
	alepha.with(await import("./services/Security.ts"));
}

run(alepha);
