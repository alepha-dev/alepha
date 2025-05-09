import { Alepha, run } from "@alepha/core";
import { App } from "./App.ts";
import { AppUpload } from "./_upload/AppUpload.ts";
import { FileCtrl } from "./_upload/controllers/FileController.ts";
import Api from "./controllers/Api.ts";

const alepha = Alepha.create({
	env: {
		...process.env,
		LOG_LEVEL: "info",
		SERVER_SECURITY_ENABLED: true,
		SERVER_LINKS_ENABLED: true,
		POSTGRES_SYNCHRONIZE: true,
		POSTGRES_REJECT_UNAUTHORIZED: false,
		REACT_SERVER_DIST: "dist",
	},
});

alepha //
	.with(AppUpload)
	.with(FileCtrl)
	.with(Api)
	.with(App);

run(alepha);
