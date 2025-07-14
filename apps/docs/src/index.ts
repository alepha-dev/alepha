import { Alepha, run } from "@alepha/core";
import { AlephaReactHead } from "@alepha/react-head";
import { App } from "./App.tsx";

const alepha = Alepha.create({
	env: {
		LOG_LEVEL: "alepha.react:trace,info",
	},
});

alepha.with(App);
alepha.with(AlephaReactHead);

run(alepha);
