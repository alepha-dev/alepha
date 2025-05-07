import { Alepha, run } from "@alepha/core";
import { App } from "./App.ts";
import Api from "./controllers/Api.ts";

const alepha = Alepha.create({
	env: {
		...process.env,
		LOG_LEVEL: "info",
		SERVER_SECURITY_ENABLED: true,
		SERVER_LINKS_ENABLED: true,
		POSTGRES_REJECT_UNAUTHORIZED: false,
	},
});

alepha.with(Api).with(App);

run(alepha);
