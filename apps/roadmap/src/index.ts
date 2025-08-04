import { Alepha, run } from "@alepha/core";
import { AlephaReactAuth } from "@alepha/react-auth";
import { AlephaServerSecurity } from "@alepha/server-security";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaServerSecurity);
alepha.with(AlephaReactAuth);

alepha.with(AppRouter);
alepha.with(await import("./services"));

if (import.meta.env.SSR) {
	alepha.with(await import("./api"));
}

run(alepha);
