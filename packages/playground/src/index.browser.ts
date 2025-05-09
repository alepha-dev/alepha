import { Alepha, run } from "@alepha/core";
import { ReactAuthModule } from "@alepha/react-auth";
import { App } from "./App.ts";
import { AppUpload } from "./_upload/AppUpload.ts";

const alepha = Alepha.create({});

alepha //
	.with(App)
	.with(AppUpload)
	.with(ReactAuthModule);

run(alepha);
