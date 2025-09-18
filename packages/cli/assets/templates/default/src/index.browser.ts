import { Alepha, run } from "alepha";
import { AlephaReactHead } from "alepha/react/head";
import AppRouter from "./AppRouter.js";

const alepha = Alepha.create({
	env: {},
});

// alepha is bundled with modules
alepha.with(AlephaReactHead);

// you can add also you own services
alepha.with(AppRouter);

run(alepha);
