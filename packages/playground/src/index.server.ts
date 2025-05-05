import { Alepha, run } from "@alepha/core";
import Api from "./Api.ts";
import { App } from "./App.ts";
import { UserApi } from "./api/UserApi.ts";

const alepha = Alepha.create({
	env: {
		...process.env,
		//APP_NAME: Math.random().toString(36).substring(2, 7),
		LOG_LEVEL: "info",
		SERVER_SECURITY_ENABLED: true,
		SERVER_LINKS_ENABLED: true,
		POSTGRES_REJECT_UNAUTHORIZED: false,
	},
});

alepha.with(Api).with(UserApi).with(App);

run(alepha);
