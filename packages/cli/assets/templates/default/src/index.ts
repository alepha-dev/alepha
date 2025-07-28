import { Alepha, run } from "alepha";
import { AlephaReactHead } from "alepha/react/head";
import AppRouter from "./AppRouter.js";

const alepha = Alepha.create({
	env: {},
});

// alepha is bundled with some fancy modules
alepha.with(AlephaReactHead);

// you can add also you own services
alepha.with(AppRouter);

// server-side specific imports must be done conditionally
// to avoid bundling them in the client-side code
if (import.meta.env.SSR) {
	alepha.with(await import("./api/TodoApi.js"));
}

run(alepha);
